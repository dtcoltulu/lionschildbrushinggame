import { USER_ROLES, type UserRole } from "@/lib/labels";
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
  role: UserRole;
  staffId: string | null;
  staffName: string | null;
  active: boolean;
  hasAuthLogin: boolean;
  lastLoginAt: string | null;
  version: number;
  createdAt: string;
}

const SELECT = `select u.id, u.email, u.display_name as "displayName", u.role, u.staff_id as "staffId", s.full_name as "staffName",
  u.active, (u.auth_user_id is not null) as "hasAuthLogin", u.last_login_at as "lastLoginAt", u.version, u.created_at as "createdAt"
  from app_users u left join staff s on s.id = u.staff_id`;

export async function listUsers(q: Queryable): Promise<AppUser[]> {
  return q.query<AppUser>(`${SELECT} order by u.active desc, u.display_name`);
}

export async function getUser(q: Queryable, id: string): Promise<AppUser | null> {
  return (await q.query<AppUser>(`${SELECT} where u.id = $1`, [id]))[0] ?? null;
}

export const MIN_PASSWORD = 10;

function readPassword(body: Record<string, unknown>, errors: Record<string, string>, field = "password"): string {
  const v = typeof body[field] === "string" ? (body[field] as string) : "";
  if (v.length < MIN_PASSWORD) errors[field] = `Parola en az ${MIN_PASSWORD} karakter olmalı.`;
  else if (v.length > 72) errors[field] = "Parola en fazla 72 karakter olabilir.";
  return v;
}

const ROLE_VALUES = USER_ROLES.map((r) => r.value) as UserRole[];

async function activeAdminCount(q: Queryable): Promise<number> {
  const [r] = await q.query<{ n: number }>(`select count(*) as n from app_users where role = 'admin' and active`);
  return r!.n;
}

/** Yönetici, çalışana kendi giriş hesabını açar. İlk parolayı çalışana yüz yüze iletir; çalışan sonra değiştirir. */
export async function createUser(ctx: Ctx, input: unknown, logins: LoginAdmin): Promise<{ user: AppUser; loginExisted: boolean }> {
  assertCan(ctx.actor, "users.manage");
  const body = asBody(input);
  const r = new Reader(body);
  const email = r.optEmail("email", "E-posta (giriş adı)");
  if (!email && !r.errors.email) r.error("email", "E-posta (giriş adı) boş bırakılamaz.");
  const displayName = r.text("displayName", "Görünen ad", { min: 2, max: 120 });
  const role = r.oneOf("role", "Rol", ROLE_VALUES, "staff");
  const staffId = r.optId("staffId", "Bağlı personel kartı");
  const pw = logins.usesPasswords ? readPassword(body, r.errors) : "";
  if (!r.ok) throw new ValidationError(r.errors);
  const emailKey = email!.toLowerCase();
  if ((await ctx.db.query(`select 1 from app_users where email_key = $1`, [emailKey])).length) {
    throw new ValidationError({ email: "Bu e-posta ile bir kullanıcı zaten var." });
  }
  if (staffId && !(await ctx.db.query(`select 1 from staff where id = $1`, [staffId])).length) {
    throw new ValidationError({ staffId: "Personel kartı bulunamadı." });
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
        `insert into app_users (auth_user_id, email, email_key, display_name, role, staff_id) values ($1, $2, $3, $4, $5, $6) returning id`,
        [authUserId, email, emailKey, displayName, role, staffId],
      );
      await audit(q, ctx, { entity: "user", entityId: row!.id, action: "create", summary: `Kullanıcı hesabı açıldı: ${displayName} <${email}> (${role === "admin" ? "Yönetici" : "Personel"})` });
      return (await getUser(q, row!.id))!;
    });
    return { user, loginExisted: logins.usesPasswords && authUserId === null };
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError({ email: "Bu e-posta ile bir kullanıcı zaten var." });
    throw e;
  }
}

export async function updateUser(ctx: Ctx, id: string, input: unknown, logins: LoginAdmin): Promise<AppUser> {
  assertCan(ctx.actor, "users.manage");
  const body = asBody(input);
  const r = new Reader(body);
  const version = r.version();
  const displayName = r.text("displayName", "Görünen ad", { min: 2, max: 120 });
  const role = r.oneOf("role", "Rol", ROLE_VALUES);
  const staffId = r.optId("staffId", "Bağlı personel kartı");
  const active = r.bool("active", true);
  if (!r.ok) throw new ValidationError(r.errors);
  const result = await ctx.db.tx(async (q) => {
    const cur = await getUser(q, id);
    if (!cur) throw new NotFoundError("Kullanıcı bulunamadı.");
    const losingAdmin = cur.role === "admin" && cur.active && (role !== "admin" || !active);
    if (losingAdmin && (await activeAdminCount(q)) <= 1) {
      throw new ConflictError("last_admin", "En az bir aktif yönetici kalmalı. Önce başka bir kullanıcıyı yönetici yapın.");
    }
    if (staffId && !(await q.query(`select 1 from staff where id = $1`, [staffId])).length) {
      throw new ValidationError({ staffId: "Personel kartı bulunamadı." });
    }
    const rows = await q.query(
      `update app_users set display_name = $3, role = $4, staff_id = $5, active = $6, version = version + 1, updated_at = now()
       where id = $1 and version = $2 returning id`,
      [id, version, displayName, role, staffId, active],
    );
    if (!rows.length) throw new VersionConflictError({ current: cur });
    const after = (await getUser(q, id))!;
    const changes = diff(cur, after, { displayName: "Görünen ad", role: "Rol", staffName: "Bağlı personel", active: "Erişim açık" });
    if (Object.keys(changes).length) {
      const summary = changes.active ? `Kullanıcı erişimi ${active ? "açıldı" : "kapatıldı"}: ${after.displayName}` : `Kullanıcı güncellendi: ${after.displayName}`;
      await audit(q, ctx, { entity: "user", entityId: id, action: "update", summary, changes });
    }
    return { cur, after };
  });
  const authId = await authUserIdOf(ctx.db, id);
  if (authId && result.cur.active !== active) await logins.setBlocked(authId, !active);
  return result.after;
}

async function authUserIdOf(q: Queryable, id: string): Promise<string | null> {
  const [r] = await q.query<{ authUserId: string | null }>(`select auth_user_id as "authUserId" from app_users where id = $1`, [id]);
  return r?.authUserId ?? null;
}

/** Yönetici, parolasını unutan çalışana yeni geçici parola verir. */
export async function resetPassword(ctx: Ctx, id: string, input: unknown, logins: LoginAdmin): Promise<void> {
  assertCan(ctx.actor, "users.manage");
  if (!logins.usesPasswords) throw new ConflictError("no_passwords", "Geliştirme modunda parola kullanılmaz.");
  const body = asBody(input);
  const errors: Record<string, string> = {};
  const pw = readPassword(body, errors);
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const user = await getUser(ctx.db, id);
  if (!user) throw new NotFoundError("Kullanıcı bulunamadı.");
  const authId = await authUserIdOf(ctx.db, id);
  if (!authId) throw new ConflictError("no_login", "Bu kullanıcı henüz hiç giriş yapmamış ve giriş hesabı bağlanmamış. Supabase panelinden parolasını sıfırlayın.");
  try {
    await logins.setPassword(authId, pw);
  } catch (e) {
    if (e instanceof LoginAdminError) throw new ValidationError({ password: e.message });
    throw e;
  }
  await audit(ctx.db, ctx, { entity: "user", entityId: id, action: "reset_password", summary: `Parola sıfırlandı: ${user.displayName}` });
}
