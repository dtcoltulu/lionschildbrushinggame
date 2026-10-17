import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { UserRole } from "@/lib/labels";
import type { Actor } from "./context";
import { getDb, type Queryable } from "./db";
import { DEV_COOKIE, verifyDevToken } from "./dev-session";
import { authMode } from "./env";
import { UnauthorizedError } from "./errors";

export type AuthState =
  | { kind: "anonymous" }
  | { kind: "no_access"; email: string }
  | { kind: "ok"; actor: Actor };

interface UserRow {
  id: string;
  role: UserRole;
  displayName: string;
  email: string;
  staffId: string | null;
  active: boolean;
  authUserId: string | null;
}

const USER_COLS = `id, role, display_name as "displayName", email, staff_id as "staffId", active, auth_user_id as "authUserId"`;

function toActor(u: UserRow): Actor {
  return { userId: u.id, role: u.role, displayName: u.displayName, email: u.email, staffId: u.staffId };
}

/**
 * Supabase'de doğrulanmış kullanıcıyı uygulama hesabına eşler.
 *  1) auth_user_id ile,
 *  2) yoksa e-postası DOĞRULANMIŞ ise ve hesap henüz bağlanmamışsa e-posta ile (ilk giriş),
 *  3) hiç yönetici yoksa ve e-posta BOOTSTRAP_ADMIN_EMAIL ise ilk yönetici olarak açılır.
 * Pasif (erişimi kapatılmış) hesap giriş yapamaz.
 */
export async function resolveAuthUser(
  q: Queryable,
  user: { id: string; email: string | null | undefined; emailConfirmed: boolean },
): Promise<AuthState> {
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
    const [{ n }] = (await q.query<{ n: number }>(`select count(*) as n from app_users where role = 'admin'`)) as [{ n: number }];
    if (n === 0) {
      const [created] = await q.query<UserRow>(
        `insert into app_users (auth_user_id, email, email_key, display_name, role) values ($1, $2, $2, $3, 'admin') returning ${USER_COLS}`,
        [user.id, email, "Klinik yöneticisi"],
      );
      await q.query(
        `insert into audit_log (actor_user_id, actor_label, entity, entity_id, action, summary) values ($1, 'Sistem', 'user', $1, 'create', $2)`,
        [created!.id, `İlk yönetici hesabı oluşturuldu: ${email}`],
      );
      row = created;
    }
  }
  if (!row || !row.active) return { kind: "no_access", email };
  return { kind: "ok", actor: toActor(row) };
}

async function devState(): Promise<AuthState> {
  const store = await cookies();
  const userId = verifyDevToken(store.get(DEV_COOKIE)?.value);
  if (!userId) return { kind: "anonymous" };
  const db = await getDb();
  const row = (await db.query<UserRow>(`select ${USER_COLS} from app_users where id = $1`, [userId]))[0];
  if (!row || !row.active) return { kind: "anonymous" };
  return { kind: "ok", actor: toActor(row) };
}

async function supabaseState(): Promise<AuthState> {
  const { supabaseForRequest } = await import("./supabase");
  const sb = await supabaseForRequest();
  // getUser() oturumu Supabase Auth sunucusunda doğrular (çerezdeki bilgiye körü körüne güvenilmez).
  const { data, error } = await sb.auth.getUser();
  // Yönetici erişimi kapattığında Supabase'de de giriş engellenir ("user_banned").
  if (error?.code === "user_banned") return { kind: "no_access", email: "" };
  if (error || !data.user) return { kind: "anonymous" };
  const db = await getDb();
  return resolveAuthUser(db, { id: data.user.id, email: data.user.email, emailConfirmed: !!data.user.email_confirmed_at });
}

/** İstek başına bir kez hesaplanır. */
export const getAuthState = cache(async (): Promise<AuthState> => (authMode() === "dev" ? devState() : supabaseState()));

export async function getActor(): Promise<Actor | null> {
  const s = await getAuthState();
  return s.kind === "ok" ? s.actor : null;
}

/** API: oturum yoksa 401. */
export async function requireActor(): Promise<Actor> {
  const a = await getActor();
  if (!a) throw new UnauthorizedError();
  return a;
}

/** Sayfa: oturum yoksa giriş sayfasına yönlendirir; girişten sonra aynı sayfaya dönülür. */
export async function requirePageActor(): Promise<Actor> {
  const s = await getAuthState();
  if (s.kind === "ok") return s.actor;
  const path = (await headers()).get("x-url-path") ?? "/";
  const next = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  redirect(`/giris?${new URLSearchParams({ next, ...(s.kind === "no_access" ? { hata: "erisim" } : {}) })}`);
}

/** Yalnızca yöneticinin görebileceği sayfalar. */
export async function requirePageAdmin(): Promise<Actor> {
  const a = await requirePageActor();
  if (a.role !== "admin") redirect("/?yetki=yok");
  return a;
}
