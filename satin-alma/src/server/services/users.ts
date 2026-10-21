import { ROLES, type Role } from "@/lib/labels";
import { asBody, Reader } from "@/lib/validate";
import { audit, diff } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { ConflictError, isUniqueViolation, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { LoginAdminError, type LoginAdmin } from "../login-admin";
import { assertCan } from "../permissions";

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  roles: Role[];
  active: boolean;
  hasAuthLogin: boolean;
  lastLoginAt: string | null;
  version: number;
  createdAt: string;
}

const SELECT = `select id, email, display_name as "displayName", roles, active, (auth_user_id is not null) as "hasAuthLogin",
  last_login_at as "lastLoginAt", version, created_at as "createdAt" from app_users`;

export async function listUsers(ctx: Ctx): Promise<AppUser[]> {
  assertCan(ctx.actor, "users.manage");
  return ctx.db.query<AppUser>(`${SELECT} where clinic_id = $1 order by active desc, display_name`, [ctx.actor.clinicId]);
}

async function getUser(q: Queryable, clinicId: string, id: string): Promise<AppUser | null> {
  return (await q.query<AppUser>(`${SELECT} where id = $1 and clinic_id = $2`, [id, clinicId]))[0] ?? null;
}

/** Teslimat sorumlusu olarak atanabilecek kişiler (teslimat veya satın alma rolü olan aktif kullanıcılar). */
export async function receiverOptions(q: Queryable): Promise<{ value: string; label: string }[]> {
  const rows = await q.query<{ id: string; displayName: string; roles: Role[] }>(
    `select id, display_name as "displayName", roles from app_users where active and (roles && array['teslimat','satinalma']) order by display_name`,
  );
  return rows.map((r) => ({ value: r.id, label: `${r.displayName} (${r.roles.map((x) => ROLES.label(x)).join(", ")})` }));
}

export const MIN_PASSWORD = 10;

function readPassword(body: Record<string, unknown>, errors: Record<string, string>, field = "password"): string {
  const v = typeof body[field] === "string" ? (body[field] as string) : "";
  if (v.length < MIN_PASSWORD) errors[field] = `Parola en az ${MIN_PASSWORD} karakter olmalı.`;
  else if (v.length > 72) errors[field] = "Parola en fazla 72 karakter olabilir.";
  return v;
}

function readRoles(r: Reader): Role[] {
  const v = r.raw("roles");
  const list = Array.isArray(v) ? [...new Set(v.filter((x): x is Role => typeof x === "string" && (ROLES.values as string[]).includes(x)))] : [];
  if (!list.length) r.error("roles", "En az bir rol seçin.");
  return list;
}

async function activeFinanceCount(q: Queryable): Promise<number> {
  const [r] = await q.query<{ n: number }>(`select count(*) as n from app_users where active and 'finans' = any(roles)`);
  return r!.n;
}

const rolesText = (roles: Role[]) => roles.map((x) => ROLES.label(x)).join(", ");

/** Finans/klinik yöneticisi kullanıcı hesabı açar. İlk parolayı kişiye yüz yüze iletir; kişi sonra değiştirir. */
export async function createUser(ctx: Ctx, input: unknown, logins: LoginAdmin): Promise<{ user: AppUser; loginExisted: boolean }> {
  assertCan(ctx.actor, "users.manage");
  const body = asBody(input);
  const r = new Reader(body);
  const email = r.optEmail("email", "E-posta (giriş adı)");
  if (!email && !r.errors.email) r.error("email", "E-posta (giriş adı) boş bırakılamaz.");
  const displayName = r.text("displayName", "Ad soyad", { min: 2, max: 120 });
  const roles = readRoles(r);
  const pw = logins.usesPasswords ? readPassword(body, r.errors) : "";
  if (!r.ok) throw new ValidationError(r.errors);
  const emailKey = email!.toLowerCase();
  if ((await ctx.db.query(`select 1 from app_users where email_key = $1`, [emailKey])).length) {
    throw new ValidationError({ email: "Bu e-posta ile bir kullanıcı zaten var." });
  }
  let authUserId: string | null = null;
  try {
    authUserId = logins.usesPasswords ? await logins.createLogin(emailKey, pw) : null;
  } catch (e) {
    if (e instanceof LoginAdminError) throw new ValidationError({ password: e.message });
    throw e;
  }
  try {
    const user = await ctx.db.tx(async (q) => {
      const [row] = await q.query<{ id: string }>(
        `insert into app_users (auth_user_id, email, email_key, display_name, roles) values ($1, $2, $3, $4, $5) returning id`,
        [authUserId, email, emailKey, displayName, roles],
      );
      await audit(q, ctx, { entity: "user", entityId: row!.id, action: "create", summary: `Kullanıcı hesabı açıldı: ${displayName} <${email}> (${rolesText(roles)})` });
      return (await getUser(q, ctx.actor.clinicId, row!.id))!;
    });
    return { user, loginExisted: logins.usesPasswords && authUserId === null };
  } catch (e) {
    if (authUserId) await logins.deleteLogin(authUserId).catch(() => {});
    if (isUniqueViolation(e)) throw new ValidationError({ email: "Bu e-posta ile bir kullanıcı zaten var." });
    throw e;
  }
}

export async function updateUser(ctx: Ctx, id: string, input: unknown, logins: LoginAdmin): Promise<AppUser> {
  assertCan(ctx.actor, "users.manage");
  const body = asBody(input);
  const r = new Reader(body);
  const version = r.version();
  const displayName = r.text("displayName", "Ad soyad", { min: 2, max: 120 });
  const roles = readRoles(r);
  const active = r.bool("active", true);
  if (!r.ok) throw new ValidationError(r.errors);
  const result = await ctx.db.tx(async (q) => {
    const cur = await getUser(q, ctx.actor.clinicId, id);
    if (!cur) throw new NotFoundError("Kullanıcı bulunamadı.");
    const losingFinance = cur.roles.includes("finans") && cur.active && (!roles.includes("finans") || !active);
    if (losingFinance && (await activeFinanceCount(q)) <= 1) {
      throw new ConflictError("last_admin", "En az bir aktif finans / klinik yöneticisi kalmalı (kullanıcıları o yönetir). Önce başka birine bu rolü verin.");
    }
    const rows = await q.query(
      `update app_users set display_name = $3, roles = $4, active = $5, version = version + 1, updated_at = now()
       where id = $1 and version = $2 returning id`,
      [id, version, displayName, roles, active],
    );
    if (!rows.length) throw new VersionConflictError({ current: cur });
    const after = (await getUser(q, ctx.actor.clinicId, id))!;
    const changes = diff(cur, after, { displayName: "Ad soyad", roles: "Roller", active: "Erişim açık" });
    if (Object.keys(changes).length) {
      const summary = changes.active ? `Kullanıcı erişimi ${active ? "açıldı" : "kapatıldı"}: ${after.displayName}` : `Kullanıcı güncellendi: ${after.displayName}`;
      await audit(q, ctx, { entity: "user", entityId: id, action: "update", summary, changes });
    }
    return { cur, after };
  });
  const [a] = await ctx.db.query<{ authUserId: string | null }>(`select auth_user_id as "authUserId" from app_users where id = $1`, [id]);
  if (a?.authUserId && result.cur.active !== active) await logins.setBlocked(a.authUserId, !active);
  return result.after;
}

/** Parolasını unutan kişiye yeni geçici parola. */
export async function resetPassword(ctx: Ctx, id: string, input: unknown, logins: LoginAdmin): Promise<void> {
  assertCan(ctx.actor, "users.manage");
  if (logins.mode === "dev") throw new ConflictError("no_passwords", "Geliştirme modunda parola kullanılmaz.");
  const errors: Record<string, string> = {};
  const pw = readPassword(asBody(input), errors);
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const user = await getUser(ctx.db, ctx.actor.clinicId, id);
  if (!user) throw new NotFoundError("Kullanıcı bulunamadı.");
  const [a] = await ctx.db.query<{ authUserId: string | null }>(`select auth_user_id as "authUserId" from app_users where id = $1`, [id]);
  if (!a?.authUserId) throw new ConflictError("no_login", "Bu kullanıcının giriş hesabı henüz bağlanmamış. Supabase panelinden parolasını belirleyin.");
  try {
    await logins.setPassword(a.authUserId, pw);
  } catch (e) {
    if (e instanceof LoginAdminError) throw new ValidationError({ password: e.message });
    throw e;
  }
  await audit(ctx.db, ctx, { entity: "user", entityId: id, action: "reset_password", summary: `Parola sıfırlandı: ${user.displayName}` });
}
