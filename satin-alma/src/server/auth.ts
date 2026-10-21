import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@/lib/labels";
import type { Actor } from "./context";
import { getDb, type Queryable } from "./db";
import { DEV_COOKIE, verifyDevToken } from "./dev-session";
import { authMode } from "./env";
import { UnauthorizedError } from "./errors";
import { can, type Permission } from "./permissions";

export type AuthState =
  | { kind: "anonymous" }
  | { kind: "no_access"; email: string }
  | { kind: "ok"; actor: Actor };

export interface UserRow {
  id: string;
  displayName: string;
  email: string;
  roles: Role[];
  active: boolean;
  authUserId: string | null;
  clinicId: string;
}

export const USER_COLS = `id, display_name as "displayName", email, roles, active, auth_user_id as "authUserId", clinic_id as "clinicId"`;

async function toState(q: Queryable, row: UserRow | null | undefined, email = ""): Promise<AuthState> {
  if (!row || !row.active) return { kind: "no_access", email: email || row?.email || "" };
  const [clinic] = await q.query<{ id: string; name: string; active: boolean }>(`select id, name, active from clinics where id = $1`, [row.clinicId]);
  if (!clinic || !clinic.active) return { kind: "no_access", email: row.email };
  return {
    kind: "ok",
    actor: { userId: row.id, displayName: row.displayName, email: row.email, roles: row.roles, clinicId: clinic.id, clinicName: clinic.name },
  };
}

/**
 * Supabase'de doğrulanmış kullanıcıyı uygulama hesabına eşler.
 *  1) auth_user_id ile,
 *  2) yoksa e-postası DOĞRULANMIŞ ise ve hesap henüz bağlanmamışsa e-posta ile (ilk giriş),
 *  3) hiç finans/klinik yöneticisi yoksa ve e-posta BOOTSTRAP_ADMIN_EMAIL ise ilk yönetici olarak açılır
 *     (roller: yönetim/satın alma + finans/klinik yöneticisi).
 * Giriş anında klinik henüz bilinmez: `q` klinik kapsamı olmayan bağlantıdır (app_users bu durumda okunabilir).
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
    const [{ n }] = (await q.query<{ n: number }>(`select count(*) as n from app_users where 'finans' = any(roles)`)) as [{ n: number }];
    if (n === 0) {
      const [clinic] = await q.query<{ id: string }>(`select id from clinics order by created_at limit 1`);
      if (clinic) {
        const [created] = await q.query<UserRow>(
          `insert into app_users (clinic_id, auth_user_id, email, email_key, display_name, roles)
           values ($1, $2, $3, $3, 'Klinik yöneticisi', array['satinalma','finans']) returning ${USER_COLS}`,
          [clinic.id, user.id, email],
        );
        await q.query(
          `insert into audit_log (clinic_id, actor_user_id, actor_label, entity, entity_id, action, summary) values ($1, $2, 'Sistem', 'user', $2, 'create', $3)`,
          [clinic.id, created!.id, `İlk yönetici hesabı oluşturuldu: ${email}`],
        );
        row = created;
      }
    }
  }
  return row ?? null;
}

export async function resolveAuthUser(q: Queryable, user: { id: string; email: string | null | undefined; emailConfirmed: boolean }): Promise<AuthState> {
  return toState(q, await findAuthUser(q, user), (user.email ?? "").toLowerCase());
}

async function devState(): Promise<AuthState> {
  const store = await cookies();
  const userId = verifyDevToken(store.get(DEV_COOKIE)?.value);
  if (!userId) return { kind: "anonymous" };
  const db = await getDb();
  const row = (await db.query<UserRow>(`select ${USER_COLS} from app_users where id = $1`, [userId]))[0];
  if (!row || !row.active) return { kind: "anonymous" };
  return toState(db, row);
}

async function supabaseState(): Promise<AuthState> {
  const { supabaseForRequest } = await import("./supabase");
  const sb = await supabaseForRequest();
  // getUser() oturumu Supabase Auth sunucusunda doğrular (çerezdeki bilgiye körü körüne güvenilmez).
  const { data, error } = await sb.auth.getUser();
  if (error?.code === "user_banned") return { kind: "no_access", email: "" };
  if (error || !data.user) return { kind: "anonymous" };
  const db = await getDb();
  return resolveAuthUser(db, { id: data.user.id, email: data.user.email, emailConfirmed: !!data.user.email_confirmed_at });
}

/** İstek başına bir kez hesaplanır. */
export const getAuthState = cache(async (): Promise<AuthState> => (authMode() === "dev" ? devState() : supabaseState()));

/** API: oturum yoksa 401. */
export async function requireActor(): Promise<Actor> {
  const s = await getAuthState();
  if (s.kind === "ok") return s.actor;
  throw new UnauthorizedError();
}

async function currentPath(): Promise<string> {
  const path = (await headers()).get("x-url-path") ?? "/";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

/** Sayfa: oturum yoksa giriş sayfasına yönlendirir; girişten sonra aynı sayfaya dönülür. İzin verilmişse yetkiyi de denetler. */
export async function requirePageActor(perm?: Permission | Permission[]): Promise<Actor> {
  const s = await getAuthState();
  if (s.kind !== "ok") {
    const next = await currentPath();
    redirect(`/giris?${new URLSearchParams({ next, ...(s.kind === "no_access" ? { hata: "erisim" } : {}) })}`);
  }
  const perms = perm === undefined ? [] : Array.isArray(perm) ? perm : [perm];
  if (perms.length && !perms.some((p) => can(s.actor, p))) redirect("/?yetki=yok");
  return s.actor;
}
