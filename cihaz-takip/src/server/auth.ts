import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { UserRole } from "@/lib/labels";
import { isUuid } from "@/lib/validate";
import type { Actor } from "./context";
import { getDb, type Queryable } from "./db";
import { DEV_COOKIE, verifyDevToken } from "./dev-session";
import { authMode } from "./env";
import { AppError, UnauthorizedError } from "./errors";

export type AuthState =
  | { kind: "anonymous" }
  | { kind: "no_access"; email: string; reason?: "clinic_inactive" }
  /** Genel yönetici giriş yaptı ama henüz çalışacağı kliniği seçmedi. */
  | { kind: "choose_clinic"; userId: string; displayName: string }
  | { kind: "ok"; actor: Actor };

/** Seçilen klinik: giriş ekranında hatırlanır; genel yönetici için çalışılan kliniği belirler. */
export const CLINIC_COOKIE = "dentinel_klinik";
export const CLINIC_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 365 * 24 * 3600,
  secure: process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "1",
};

export interface UserRow {
  id: string;
  role: UserRole;
  displayName: string;
  email: string;
  staffId: string | null;
  active: boolean;
  authUserId: string | null;
  clinicId: string | null;
  shared: boolean;
  sessionsValidAfter: string | null;
}

export const USER_COLS = `id, role, display_name as "displayName", email, staff_id as "staffId", active, auth_user_id as "authUserId",
  clinic_id as "clinicId", shared, sessions_valid_after as "sessionsValidAfter"`;

interface ClinicRow {
  id: string;
  name: string;
  active: boolean;
}

async function clinicById(q: Queryable, id: string): Promise<ClinicRow | null> {
  return (await q.query<ClinicRow>(`select id, name, active from clinics where id = $1`, [id]))[0] ?? null;
}

function toActor(u: UserRow, clinic: ClinicRow): Actor {
  return {
    userId: u.id, role: u.role, displayName: u.displayName, email: u.email, staffId: u.staffId,
    clinicId: clinic.id, clinicName: clinic.name, superAdmin: u.clinicId === null, shared: u.shared,
  };
}

/**
 * Bulunan uygulama hesabından oturum durumunu çıkarır.
 *  - Pasif hesap ya da erişimi kapatılmış klinik: erişim yok.
 *  - Şifre değiştikten sonra eski oturumlar geçersizdir (authTime: girişin yapıldığı an, saniye).
 *  - Klinik hesabı yalnızca kendi kliniğinde çalışır; genel yönetici seçtiği klinikte çalışır.
 */
export async function stateForUser(
  q: Queryable,
  row: UserRow | null | undefined,
  opts: { email?: string; selectedClinicId?: string | null; authTime?: number | null } = {},
): Promise<AuthState> {
  if (!row || !row.active) return { kind: "no_access", email: opts.email ?? row?.email ?? "" };
  if (opts.authTime != null && row.sessionsValidAfter && opts.authTime < Math.floor(Date.parse(row.sessionsValidAfter) / 1000)) {
    return { kind: "anonymous" };
  }
  if (row.clinicId) {
    const clinic = await clinicById(q, row.clinicId);
    if (!clinic || !clinic.active) return { kind: "no_access", email: row.email, reason: "clinic_inactive" };
    return { kind: "ok", actor: toActor(row, clinic) };
  }
  const selected = isUuid(opts.selectedClinicId) ? await clinicById(q, opts.selectedClinicId) : null;
  if (!selected) return { kind: "choose_clinic", userId: row.id, displayName: row.displayName };
  return { kind: "ok", actor: toActor(row, selected) };
}

/**
 * Supabase'de doğrulanmış kullanıcıyı uygulama hesabına eşler.
 *  1) auth_user_id ile,
 *  2) yoksa e-postası DOĞRULANMIŞ ise ve hesap henüz bağlanmamışsa e-posta ile (ilk giriş),
 *  3) hiç genel yönetici yoksa ve e-posta BOOTSTRAP_ADMIN_EMAIL ise ilk genel yönetici olarak açılır.
 * Klinik seçilmeden çalışır (giriş anı): `q` klinik kapsamı olmayan bağlantıdır.
 */
export async function findAuthUser(
  q: Queryable,
  user: { id: string; email: string | null | undefined; emailConfirmed: boolean },
): Promise<UserRow | null> {
  const email = (user.email ?? "").toLowerCase();
  let row = (await q.query<UserRow>(`select ${USER_COLS} from app_users where auth_user_id = $1`, [user.id]))[0];
  if (!row && email && user.emailConfirmed) {
    const byEmail = (await q.query<UserRow>(`select ${USER_COLS} from app_users where email_key = $1 and auth_user_id is null`, [email]))[0];
    if (byEmail) {
      await q.query(`update app_users set auth_user_id = $2 where id = $1`, [byEmail.id, user.id]);
      row = { ...byEmail, authUserId: user.id };
    }
  }
  if (!row && email && user.emailConfirmed && email === (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").toLowerCase().trim()) {
    const [{ n }] = (await q.query<{ n: number }>(`select count(*) as n from app_users where role = 'admin' and clinic_id is null`)) as [{ n: number }];
    if (n === 0) {
      const [created] = await q.query<UserRow>(
        `insert into app_users (auth_user_id, email, email_key, display_name, role) values ($1, $2, $2, $3, 'admin') returning ${USER_COLS}`,
        [user.id, email, "Genel yönetici"],
      );
      await q.query(
        `insert into audit_log (actor_user_id, actor_label, entity, entity_id, action, summary) values ($1, 'Sistem', 'user', $1, 'create', $2)`,
        [created!.id, `İlk genel yönetici hesabı oluşturuldu: ${email}`],
      );
      row = created;
    }
  }
  return row ?? null;
}

export async function resolveAuthUser(
  q: Queryable,
  user: { id: string; email: string | null | undefined; emailConfirmed: boolean },
  opts: { selectedClinicId?: string | null; authTime?: number | null } = {},
): Promise<AuthState> {
  const row = await findAuthUser(q, user);
  return stateForUser(q, row, { ...opts, email: (user.email ?? "").toLowerCase() });
}

async function selectedClinic(): Promise<string | null> {
  return (await cookies()).get(CLINIC_COOKIE)?.value ?? null;
}

async function devState(): Promise<AuthState> {
  const store = await cookies();
  const userId = verifyDevToken(store.get(DEV_COOKIE)?.value);
  if (!userId) return { kind: "anonymous" };
  const db = await getDb();
  const row = (await db.query<UserRow>(`select ${USER_COLS} from app_users where id = $1`, [userId]))[0];
  if (!row || !row.active) return { kind: "anonymous" };
  return stateForUser(db, row, { selectedClinicId: await selectedClinic() });
}

/** Oturumun açıldığı an (saniye). Supabase erişim anahtarındaki "amr" kaydından okunur; yenilemelerde değişmez. */
function loginTime(claims: { amr?: unknown } | null | undefined): number | null {
  const amr = Array.isArray(claims?.amr) ? (claims.amr as unknown[]) : [];
  const times = amr.map((e) => (e && typeof e === "object" ? Number((e as { timestamp?: unknown }).timestamp) : NaN)).filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

async function supabaseState(): Promise<AuthState> {
  const { supabaseForRequest } = await import("./supabase");
  const sb = await supabaseForRequest();
  // getUser() oturumu Supabase Auth sunucusunda doğrular (çerezdeki bilgiye körü körüne güvenilmez).
  const { data, error } = await sb.auth.getUser();
  // Yönetici erişimi kapattığında Supabase'de de giriş engellenir ("user_banned").
  if (error?.code === "user_banned") return { kind: "no_access", email: "" };
  if (error || !data.user) return { kind: "anonymous" };
  const claims = (await sb.auth.getClaims()).data?.claims;
  const db = await getDb();
  return resolveAuthUser(
    db,
    { id: data.user.id, email: data.user.email, emailConfirmed: !!data.user.email_confirmed_at },
    { selectedClinicId: await selectedClinic(), authTime: loginTime(claims) },
  );
}

/** İstek başına bir kez hesaplanır. */
export const getAuthState = cache(async (): Promise<AuthState> => (authMode() === "dev" ? devState() : supabaseState()));

export async function getActor(): Promise<Actor | null> {
  const s = await getAuthState();
  return s.kind === "ok" ? s.actor : null;
}

/** API: oturum yoksa 401; genel yönetici klinik seçmediyse 409. */
export async function requireActor(): Promise<Actor> {
  const s = await getAuthState();
  if (s.kind === "ok") return s.actor;
  if (s.kind === "choose_clinic") throw new AppError(409, "choose_clinic", "Önce çalışılacak kliniği seçin.");
  throw new UnauthorizedError();
}

async function currentPath(): Promise<string> {
  const path = (await headers()).get("x-url-path") ?? "/";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

/** Sayfa: oturum yoksa giriş sayfasına yönlendirir; girişten sonra aynı sayfaya dönülür. */
export async function requirePageActor(): Promise<Actor> {
  const s = await getAuthState();
  if (s.kind === "ok") return s.actor;
  const next = await currentPath();
  if (s.kind === "choose_clinic") redirect(`/klinik-sec?${new URLSearchParams({ next })}`);
  const hata = s.kind === "no_access" ? (s.reason === "clinic_inactive" ? "klinik" : "erisim") : null;
  redirect(`/giris?${new URLSearchParams({ next, ...(hata ? { hata } : {}) })}`);
}

/** Yalnızca yöneticinin görebileceği sayfalar. */
export async function requirePageAdmin(): Promise<Actor> {
  const a = await requirePageActor();
  if (a.role !== "admin") redirect("/?yetki=yok");
  return a;
}

/** Yalnızca genel yöneticinin görebileceği sayfalar (klinik yönetimi). */
export async function requirePageSuperAdmin(): Promise<Actor> {
  const a = await requirePageActor();
  if (!a.superAdmin) redirect("/?yetki=yok");
  return a;
}
