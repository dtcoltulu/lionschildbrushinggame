import { randomUUID } from "node:crypto";
import { normalizeKey } from "@/lib/normalize";
import { asBody, isUuid, Reader } from "@/lib/validate";
import { audit, diff } from "../audit";
import { seedClinicDefaults } from "../clinic-defaults";
import type { Ctx } from "../context";
import { forClinic, type Db, type Queryable } from "../db";
import { ConflictError, ForbiddenError, isUniqueViolation, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { LoginAdminError, sharedLoginEmail, type LoginAdmin } from "../login-admin";
import { assertCan } from "../permissions";
import { MIN_PASSWORD } from "./users";

/**
 * Klinikler. Her kliniğin verisi ayrıdır (veritabanında RLS ile). Klinikleri genel yönetici ekler ve düzenler.
 * Her kliniğin iki ortak girişi vardır: personel şifresi ve yönetici şifresi. Şifreleri Supabase Auth tutar;
 * uygulama şifre saklamaz.
 *
 * Buradaki fonksiyonlar klinikler arası çalıştığı için `root` (klinik kapsamı olmayan) bağlantı alır;
 * klinik verisine yalnızca forClinic(root, id) ile dokunulur.
 */

export type SharedKind = "staff" | "admin";
export const SHARED_KINDS: { value: SharedKind; label: string; account: string }[] = [
  { value: "staff", label: "Personel şifresi", account: "Ortak personel girişi" },
  { value: "admin", label: "Yönetici şifresi", account: "Ortak yönetici girişi" },
];

export interface LoginStatus {
  /** Bu şifreyle giriş yapılabiliyor mu (hesap var ve şifre belirlenmiş). */
  ready: boolean;
  changedAt: string | null;
}

export interface Clinic {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
  version: number;
  createdAt: string;
  staffLogin: LoginStatus;
  adminLogin: LoginStatus;
}

export interface ClinicChoice {
  id: string;
  name: string;
  active: boolean;
}

const SELECT = `select c.id, c.name, c.active, c.sort_order as "sortOrder", c.version, c.created_at as "createdAt",
  st.id is not null and (st.auth_user_id is not null or $1) as "staffReady", st.sessions_valid_after as "staffChangedAt",
  ad.id is not null and (ad.auth_user_id is not null or $1) as "adminReady", ad.sessions_valid_after as "adminChangedAt"
  from clinics c
  left join app_users st on st.clinic_id = c.id and st.shared and st.role = 'staff' and st.active
  left join app_users ad on ad.clinic_id = c.id and ad.shared and ad.role = 'admin' and ad.active`;

type Row = Omit<Clinic, "staffLogin" | "adminLogin"> & { staffReady: boolean; staffChangedAt: string | null; adminReady: boolean; adminChangedAt: string | null };

const toClinic = ({ staffReady, staffChangedAt, adminReady, adminChangedAt, ...c }: Row): Clinic => ({
  ...c,
  staffLogin: { ready: staffReady, changedAt: staffChangedAt },
  adminLogin: { ready: adminReady, changedAt: adminChangedAt },
});

/** Geliştirme modunda şifre yoktur: ortak hesabın var olması yeterlidir. */
export async function listClinics(root: Queryable, logins: Pick<LoginAdmin, "mode">): Promise<Clinic[]> {
  return (await root.query<Row>(`${SELECT} order by c.active desc, c.sort_order, c.name`, [logins.mode === "dev"])).map(toClinic);
}

export async function getClinic(root: Queryable, id: string, logins: Pick<LoginAdmin, "mode">): Promise<Clinic | null> {
  if (!isUuid(id)) return null;
  const [r] = await root.query<Row>(`${SELECT} where c.id = $2`, [logins.mode === "dev", id]);
  return r ? toClinic(r) : null;
}

/** Giriş ekranındaki klinik listesi (yalnızca açık klinikler, yalnızca ad). */
export async function loginClinics(root: Queryable): Promise<ClinicChoice[]> {
  return root.query<ClinicChoice>(`select id, name, active from clinics where active order by sort_order, name`);
}

/** Genel yöneticinin seçebileceği klinikler (kapalı olanlar da). */
export async function allClinicChoices(root: Queryable): Promise<ClinicChoice[]> {
  return root.query<ClinicChoice>(`select id, name, active from clinics order by active desc, sort_order, name`);
}

function readPassword(body: Record<string, unknown>, field: string, errors: Record<string, string>): string {
  const v = typeof body[field] === "string" ? (body[field] as string) : "";
  if (v.length < MIN_PASSWORD) errors[field] = `Şifre en az ${MIN_PASSWORD} karakter olmalı.`;
  else if (v.length > 72) errors[field] = "Şifre en fazla 72 karakter olabilir.";
  return v;
}

const SAME_PASSWORD = "Personel ve yönetici şifreleri farklı olmalı; aynı olursa personel yönetici olarak girebilir.";

async function insertShared(q: Queryable, clinicId: string, kind: SharedKind, authUserId: string | null): Promise<string> {
  const email = sharedLoginEmail(clinicId, kind);
  const [row] = await q.query<{ id: string }>(
    `insert into app_users (auth_user_id, email, email_key, display_name, role, clinic_id, shared, sessions_valid_after)
     values ($1, $2, $2, $3, $4, $5, true, now()) returning id`,
    [authUserId, email, SHARED_KINDS.find((k) => k.value === kind)!.account, kind, clinicId],
  );
  return row!.id;
}

/** Yeni klinik: başlangıç listeleri ve iki ortak giriş (personel, yönetici) ile birlikte açılır. */
export async function createClinic(ctx: Ctx, root: Db, input: unknown, logins: LoginAdmin): Promise<Clinic> {
  assertCan(ctx.actor, "clinics.manage");
  const body = asBody(input);
  const r = new Reader(body);
  const name = r.text("name", "Klinik adı", { min: 2, max: 120 });
  let staffPassword = "";
  let adminPassword = "";
  if (logins.usesPasswords) {
    staffPassword = readPassword(body, "staffPassword", r.errors);
    adminPassword = readPassword(body, "adminPassword", r.errors);
    if (!r.errors.staffPassword && !r.errors.adminPassword && staffPassword === adminPassword) r.error("adminPassword", SAME_PASSWORD);
  }
  if (!r.ok) throw new ValidationError(r.errors);
  const nameKey = normalizeKey(name);
  if ((await root.query(`select 1 from clinics where name_key = $1`, [nameKey])).length) {
    throw new ValidationError({ name: "Bu adla bir klinik zaten var." });
  }

  const id = randomUUID();
  // Giriş hesapları önce açılır (Supabase); veritabanı işlemi başarısız olursa geri silinir.
  const created: string[] = [];
  const open = async (kind: SharedKind, password: string) => {
    if (!logins.usesPasswords) return null;
    const authId = await logins.createLogin(sharedLoginEmail(id, kind), password);
    if (!authId) throw new LoginAdminError("Giriş hesabı açılamadı (aynı adla hesap var).");
    created.push(authId);
    return authId;
  };
  try {
    const staffAuth = await open("staff", staffPassword);
    const adminAuth = await open("admin", adminPassword);
    await forClinic(root, id).tx(async (q) => {
      await q.query(
        `insert into clinics (id, name, name_key, sort_order) values ($1, $2, $3, (select coalesce(max(sort_order), 0) + 10 from clinics))`,
        [id, name, nameKey],
      );
      await seedClinicDefaults(q);
      await insertShared(q, id, "staff", staffAuth);
      await insertShared(q, id, "admin", adminAuth);
      await audit(q, ctx, { entity: "clinic", entityId: id, action: "create", summary: `Klinik açıldı: ${name}` });
    });
  } catch (e) {
    for (const authId of created) await logins.deleteLogin(authId).catch(() => {});
    if (e instanceof LoginAdminError) throw new ValidationError({ staffPassword: e.message });
    if (isUniqueViolation(e, "clinics_name_key_uq")) throw new ValidationError({ name: "Bu adla bir klinik zaten var." });
    throw e;
  }
  return (await getClinic(root, id, logins))!;
}

/** Ad ve erişim (kapalı klinikte ortak girişler ve kişisel hesaplar giriş yapamaz; veriler korunur). */
export async function updateClinic(ctx: Ctx, root: Db, id: string, input: unknown, logins: Pick<LoginAdmin, "mode">): Promise<Clinic> {
  assertCan(ctx.actor, "clinics.manage");
  const r = new Reader(asBody(input));
  const version = r.version();
  const name = r.text("name", "Klinik adı", { min: 2, max: 120 });
  const active = r.bool("active", true);
  if (!r.ok) throw new ValidationError(r.errors);
  const cur = await getClinic(root, id, logins);
  if (!cur) throw new NotFoundError("Klinik bulunamadı.");
  try {
    await forClinic(root, id).tx(async (q) => {
      const rows = await q.query(
        `update clinics set name = $3, name_key = $4, active = $5, version = version + 1, updated_at = now() where id = $1 and version = $2 returning id`,
        [id, version, name, normalizeKey(name), active],
      );
      if (!rows.length) throw new VersionConflictError({ current: cur });
      const changes = diff(cur, { name, active }, { name: "Klinik adı", active: "Erişim açık" });
      if (Object.keys(changes).length) {
        const summary = changes.active ? `Klinik erişimi ${active ? "açıldı" : "kapatıldı"}: ${name}` : `Klinik güncellendi: ${name}`;
        await audit(q, ctx, { entity: "clinic", entityId: id, action: "update", summary, changes });
      }
    });
  } catch (e) {
    if (isUniqueViolation(e, "clinics_name_key_uq")) throw new ValidationError({ name: "Bu adla bir klinik zaten var." });
    throw e;
  }
  return (await getClinic(root, id, logins))!;
}

/**
 * Kliniğin personel ya da yönetici şifresini belirler/değiştirir. Genel yönetici her klinikte, kliniğin
 * yöneticisi kendi kliniğinde yapabilir. Şifre değişince o girişle açılmış eski oturumlar kapanır.
 */
export async function setClinicPassword(ctx: Ctx, root: Db, clinicId: string, input: unknown, logins: LoginAdmin): Promise<Clinic> {
  const own = ctx.actor.role === "admin" && ctx.actor.clinicId === clinicId;
  if (!ctx.actor.superAdmin && !own) {
    throw new ForbiddenError("Kliniğin giriş şifrelerini yalnızca o kliniğin yöneticisi ya da genel yönetici değiştirebilir.");
  }
  const body = asBody(input);
  const r = new Reader(body);
  const kind = r.oneOf("kind", "Giriş", ["staff", "admin"] as SharedKind[]);
  const password = readPassword(body, "password", r.errors);
  if (!r.ok) throw new ValidationError(r.errors);
  if (logins.mode === "dev") throw new ConflictError("no_passwords", "Geliştirme modunda şifre kullanılmaz.");
  if (logins.mode === "supabase-manual") {
    throw new ConflictError(
      "no_service_key",
      "Şifre belirlemek için sunucuda SUPABASE_SERVICE_ROLE_KEY tanımlı olmalı (Vercel → Settings → Environment Variables).",
    );
  }
  const clinic = await getClinic(root, clinicId, logins);
  if (!clinic) throw new NotFoundError("Klinik bulunamadı.");
  const other: SharedKind = kind === "staff" ? "admin" : "staff";
  if (await logins.passwordMatches(sharedLoginEmail(clinicId, other), password)) throw new ValidationError({ password: SAME_PASSWORD });

  const scoped = forClinic(root, clinicId);
  const [row] = await scoped.query<{ id: string; authUserId: string | null }>(
    `select id, auth_user_id as "authUserId" from app_users where clinic_id = $1 and shared and role = $2`,
    [clinicId, kind],
  );
  let newAuthId: string | null = null;
  try {
    if (row?.authUserId) await logins.setPassword(row.authUserId, password);
    else {
      newAuthId = await logins.createLogin(sharedLoginEmail(clinicId, kind), password);
      if (!newAuthId) throw new LoginAdminError("Giriş hesabı açılamadı (aynı adla hesap var).");
    }
  } catch (e) {
    if (e instanceof LoginAdminError) throw new ValidationError({ password: e.message });
    throw e;
  }
  const label = SHARED_KINDS.find((k) => k.value === kind)!.label;
  try {
    await scoped.tx(async (q) => {
      if (!row) await insertShared(q, clinicId, kind, newAuthId);
      else {
        await q.query(
          `update app_users set auth_user_id = coalesce($2, auth_user_id), active = true, sessions_valid_after = now(),
             version = version + 1, updated_at = now() where id = $1`,
          [row.id, newAuthId],
        );
      }
      await audit(q, ctx, {
        entity: "clinic", entityId: clinicId, action: "set_password",
        summary: `${label} ${row?.authUserId ? "değiştirildi" : "belirlendi"}: ${clinic.name}`,
      });
    });
  } catch (e) {
    if (newAuthId) await logins.deleteLogin(newAuthId).catch(() => {});
    throw e;
  }
  return (await getClinic(root, clinicId, logins))!;
}
