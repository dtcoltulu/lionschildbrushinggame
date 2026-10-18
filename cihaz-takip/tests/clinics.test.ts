/**
 * Birden fazla klinik: kliniklerin verisi birbirinden ayrıdır (veritabanında RLS), klinikleri yalnızca genel
 * yönetici yönetir, klinik şifreleri ortak giriş hesaplarıyla (Supabase Auth) çalışır.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { stateForUser, USER_COLS, type UserRow } from "@/server/auth";
import { DEFAULT_DEVICE_TYPES, DEFAULT_FAULT_CAUSES, DEFAULT_LOCATIONS } from "@/server/clinic-defaults";
import type { Ctx } from "@/server/context";
import { forClinic, openDb, migrate, type Db } from "@/server/db";
import { ConfigError } from "@/server/env";
import { AppError } from "@/server/errors";
import { devLoginAdmin, sharedLoginEmail, type LoginAdmin } from "@/server/login-admin";
import { causeStats, deviceRepairStats, overview, ALL_TIME } from "@/server/services/analytics";
import { createClinic, listClinics, loginClinics, setClinicPassword, updateClinic } from "@/server/services/clinics";
import { createDevices, findDeviceByCode, getDevice, listDevices, updateDevice } from "@/server/services/devices";
import { exportCsv } from "@/server/services/export";
import { createFault, listFaults } from "@/server/services/faults";
import { createLookup, listLookup } from "@/server/services/lookups";
import { createStaff, listStaff, updateStaff } from "@/server/services/staff";
import { createUser, listUsers, updateUser } from "@/server/services/users";
import { recentAudit } from "@/server/audit";
import { actorOf, FIRST_CLINIC, TODAY, world, type World } from "./helpers";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));

async function expectError(p: Promise<unknown>, status: number, field?: string): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    const err = e as AppError;
    expect(err.status, err.message).toBe(status);
    if (field) expect(Object.keys(err.fieldErrors ?? {}), JSON.stringify(err.fieldErrors)).toContain(field);
    return err;
  }
  throw new Error("Hata bekleniyordu ama işlem başarılı oldu.");
}

/** Supabase Auth'u taklit eder: hesapları ve parolaları bellekte tutar. */
function fakeLogins() {
  const accounts = new Map<string, { email: string; password: string }>();
  const logins: LoginAdmin & { accounts: typeof accounts } = {
    mode: "supabase",
    usesPasswords: true,
    accounts,
    async createLogin(email, password) {
      if ([...accounts.values()].some((a) => a.email === email)) return null;
      const id = randomUUID();
      accounts.set(id, { email, password });
      return id;
    },
    async setPassword(id, password) {
      accounts.get(id)!.password = password;
    },
    async setBlocked() {},
    async deleteLogin(id) {
      accounts.delete(id);
    },
    async passwordMatches(email, password) {
      return [...accounts.values()].some((a) => a.email === email && a.password === password);
    },
  };
  return logins;
}

let A: World; // ilk klinik (Koşuyolu Park)
let B: World; // genel yöneticinin açtığı ikinci klinik
let superCtx: Ctx; // genel yönetici, A'da çalışıyor
let root: Db;

beforeAll(async () => {
  A = await world();
  root = A.db;
  const [g] = await root.query<{ id: string }>(
    `insert into app_users (email, email_key, display_name, role) values ('genel@test', 'genel@test', 'Genel Yönetici', 'admin') returning id`,
  );
  superCtx = { db: forClinic(root, FIRST_CLINIC), today: TODAY, actor: actorOf(g!.id, "admin", "Genel Yönetici", "genel@test", FIRST_CLINIC, { superAdmin: true }) };
  const clinic = await createClinic(superCtx, root, { name: "Deneme Kliniği" }, devLoginAdmin);
  B = await world(TODAY, { db: root, clinicId: clinic.id, tag: "-b" });
});
afterAll(async () => root.close());

describe("Klinik açma", () => {
  it("yeni klinik başlangıç listeleriyle ve iki ortak girişle açılır; listeler ilk klinikle aynıdır", async () => {
    const names = async (w: World, sql: string) => (await w.admin.db.query<{ v: string }>(sql)).map((r) => r.v).sort();
    for (const sql of [
      `select name || '|' || sort_order as v from locations`,
      `select name || '|' || code_prefix || '|' || code_digits || '|' || frequent as v from device_types`,
      `select name || '|' || coalesce(system_key, '') as v from fault_causes`,
    ]) {
      expect(await names(B, sql)).toEqual(await names(A, sql));
    }
    expect(Object.keys(B.loc)).toHaveLength(DEFAULT_LOCATIONS.length);
    expect(Object.keys(B.type)).toHaveLength(DEFAULT_DEVICE_TYPES.length);
    expect(Object.keys(B.cause)).toHaveLength(DEFAULT_FAULT_CAUSES.length);
    const shared = await root.query<{ role: string }>(`select role from app_users where clinic_id = $1 and shared order by role`, [B.clinicId]);
    expect(shared.map((r) => r.role)).toEqual(["admin", "staff"]);
    const all = await listClinics(root, devLoginAdmin);
    expect(all.find((c) => c.id === B.clinicId)).toMatchObject({ name: "Deneme Kliniği", staffLogin: { ready: true }, adminLogin: { ready: true } });
  });

  it("klinikleri yalnızca genel yönetici açar ve düzenler; aynı ad iki kez kullanılamaz", async () => {
    await expectError(createClinic(A.admin, root, { name: "Yetkisiz Klinik" }, devLoginAdmin), 403);
    await expectError(updateClinic(A.admin, root, B.clinicId, { version: 1, name: "X Klinik", active: true }, devLoginAdmin), 403);
    await expectError(createClinic(superCtx, root, { name: "deneme  KLİNİĞİ" }, devLoginAdmin), 422, "name");
  });

  it("şifreli kurulumda iki şifre zorunlu ve farklı olmalı; hesaplar Supabase'de açılır", async () => {
    const logins = fakeLogins();
    await expectError(createClinic(superCtx, root, { name: "Şifreli Klinik", staffPassword: "kisa" }, logins), 422, "staffPassword");
    await expectError(createClinic(superCtx, root, { name: "Şifreli Klinik", staffPassword: "ayni-sifre-123", adminPassword: "ayni-sifre-123" }, logins), 422, "adminPassword");
    expect(logins.accounts.size).toBe(0);
    const c = await createClinic(superCtx, root, { name: "Şifreli Klinik", staffPassword: "personel-123", adminPassword: "yonetici-456" }, logins);
    expect([...logins.accounts.values()].map((a) => a.email).sort()).toEqual([sharedLoginEmail(c.id, "staff"), sharedLoginEmail(c.id, "admin")].sort());
    expect(c.staffLogin.ready && c.adminLogin.ready).toBe(true);
  });
});

describe("Kliniklerin verisi birbirinden ayrı", () => {
  let aDevice: string;
  let aStaff: string;
  beforeAll(async () => {
    aStaff = (await createStaff(A.admin, { fullName: "Ayşe Yılmaz", jobRole: "asistan", locationIds: [A.loc["Ünit 1"]] })).id;
    aDevice = (await createDevices(A.admin, { name: "Aeratör", typeId: A.type.AER, responsibleStaffId: aStaff })).ids[0]!;
    await createFault(A.staff, { deviceId: aDevice, description: "A kliniğinde arıza", noticedOn: TODAY });
    await createLookup(A.admin, "service_vendors", { name: "A Servis" });
  });

  it("bir klinik diğerinin cihazını, arızasını, çalışanını, listesini göremez", async () => {
    expect(await listDevices(B.admin.db, TODAY)).toEqual([]);
    expect(await getDevice(B.admin.db, TODAY, aDevice)).toBeNull();
    expect(await findDeviceByCode(B.admin.db, "AER-001")).toBeNull();
    expect(await listFaults(B.admin.db, TODAY)).toEqual([]);
    expect(await listStaff(B.admin.db, { includeInactive: true })).toEqual([]);
    expect((await listLookup(B.admin.db, "service_vendors", { includeInactive: true })).map((v) => v.name)).not.toContain("A Servis");
    expect((await recentAudit(B.admin.db)).some((r) => r.summary.includes("A kliniğinde") || r.entityId === aDevice)).toBe(false);
    // A kendi verisini görür
    expect((await listDevices(A.admin.db, TODAY)).map((d) => d.inventoryCode)).toContain("AER-001");
  });

  it("envanter kodu ve çalışan adı klinik içinde benzersizdir (iki klinikte de AER-001 olabilir)", async () => {
    const { codes } = await createDevices(B.admin, { name: "Aeratör", typeId: B.type.AER });
    expect(codes).toEqual(["AER-001"]);
    await createStaff(B.admin, { fullName: "Ayşe Yılmaz", jobRole: "asistan" });
    expect(await findDeviceByCode(B.admin.db, "AER-001")).not.toBe(aDevice);
  });

  it("başka kliniğin kaydı kimliği bilinse de değiştirilemez ve bağlanamaz", async () => {
    await expectError(updateDevice(B.admin, aDevice, { version: 1, name: "Ele geçirme" }), 404);
    await expectError(updateStaff(B.admin, aStaff, { version: 1, fullName: "Ele Geçirme", jobRole: "asistan" }), 404);
    await expectError(createFault(B.staff, { deviceId: aDevice, description: "x", noticedOn: TODAY }), 422, "deviceId");
    await expectError(createDevices(B.admin, { name: "X", typeId: A.type.AER }), 422, "typeId");
    await expectError(createDevices(B.admin, { name: "X", typeId: B.type.AER, locationId: A.loc["Ünit 1"] }), 422, "locationId");
    await expectError(createDevices(B.admin, { name: "X", typeId: B.type.AER, responsibleStaffId: aStaff }), 422, "responsibleStaffId");
    await expectError(createStaff(B.admin, { fullName: "Yeni Kişi", jobRole: "asistan", locationIds: [A.loc["Ünit 1"]] }), 422, "locationIds");
    expect((await getDevice(A.admin.db, TODAY, aDevice))!.name).toBe("Aeratör");
  });

  it("analizler, genel bakış ve Excel çıktısı yalnızca kliniğin kendi verisini içerir", async () => {
    expect((await overview(B.admin.db, TODAY)).openFaults).toBe(0);
    expect((await overview(A.admin.db, TODAY)).openFaults).toBe(1);
    expect((await causeStats(B.admin.db, ALL_TIME)).total).toBe(0);
    expect((await deviceRepairStats(B.admin.db, ALL_TIME)).rows.every((r) => r.deviceId !== aDevice)).toBe(true);
    const csv = (await exportCsv(B.admin, "arizalar")).body;
    expect(csv).not.toContain("A kliniğinde");
    expect((await exportCsv(A.admin, "arizalar")).body).toContain("A kliniğinde");
  });

  it("veritabanı da ayrımı uygular: başka kliniğe satır eklenemez, klinik seçilmeden hiçbir satır görünmez", async () => {
    await expect(
      B.admin.db.query(`insert into locations (name, name_key, clinic_id) values ('Sızma', 'sizma', $1)`, [FIRST_CLINIC]),
    ).rejects.toThrow(/row-level security/);
    const rows = await root.tx(async (q) => {
      await q.query(`select set_config('role', 'dentinel_tenant', true)`);
      return q.query(`select id from devices`);
    });
    expect(rows).toEqual([]);
    expect(await B.admin.db.query(`select id from faults where device_id = $1`, [aDevice])).toEqual([]);
  });

  it("kişisel hesaplar da klinik içindedir", async () => {
    const { user } = await createUser(A.admin, { email: "kisi@a.test", displayName: "A Kişisi", role: "staff" }, devLoginAdmin);
    expect((await listUsers(B.admin.db, B.clinicId)).map((u) => u.email)).not.toContain("kisi@a.test");
    expect((await listUsers(A.admin.db, A.clinicId)).map((u) => u.email)).toContain("kisi@a.test");
    await expectError(updateUser(B.admin, user.id, { version: 1, displayName: "Ele Geçirme", role: "admin", active: true }, devLoginAdmin), 404);
  });
});

describe("Klinik girişi ve oturum", () => {
  const logins = fakeLogins(); // bu bölümdeki testler aynı (taklit) Supabase hesaplarını kullanır
  const row = async (sql: string, params: unknown[]) => (await root.query<UserRow>(`select ${USER_COLS} from app_users where ${sql}`, params))[0];

  it("ortak giriş yalnızca kendi kliniğinde çalışır; genel yönetici seçtiği klinikte çalışır", async () => {
    const shared = await row(`clinic_id = $1 and shared and role = 'staff'`, [B.clinicId]);
    const s = await stateForUser(root, shared, { selectedClinicId: FIRST_CLINIC });
    expect(s.kind === "ok" && [s.actor.clinicId, s.actor.shared, s.actor.superAdmin, s.actor.role]).toEqual([B.clinicId, true, false, "staff"]);
    const g = await row(`email_key = 'genel@test'`, []);
    expect((await stateForUser(root, g, {})).kind).toBe("choose_clinic");
    expect((await stateForUser(root, g, { selectedClinicId: "00000000-0000-4000-8000-00000000dead" })).kind).toBe("choose_clinic");
    const inB = await stateForUser(root, g, { selectedClinicId: B.clinicId });
    expect(inB.kind === "ok" && [inB.actor.clinicId, inB.actor.superAdmin]).toEqual([B.clinicId, true]);
  });

  it("erişimi kapatılan klinikte klinik hesapları giriş yapamaz; genel yönetici girebilir; veriler korunur", async () => {
    const [c] = (await listClinics(root, devLoginAdmin)).filter((x) => x.id === B.clinicId);
    await updateClinic(superCtx, root, B.clinicId, { version: c!.version, name: c!.name, active: false }, devLoginAdmin);
    expect((await loginClinics(root)).map((x) => x.id)).not.toContain(B.clinicId);
    const shared = await row(`clinic_id = $1 and shared and role = 'admin'`, [B.clinicId]);
    expect(await stateForUser(root, shared, {})).toMatchObject({ kind: "no_access", reason: "clinic_inactive" });
    const g = await row(`email_key = 'genel@test'`, []);
    expect((await stateForUser(root, g, { selectedClinicId: B.clinicId })).kind).toBe("ok");
    expect((await listDevices(B.admin.db, TODAY)).length).toBeGreaterThan(0);
    await updateClinic(superCtx, root, B.clinicId, { version: c!.version + 1, name: c!.name, active: true }, devLoginAdmin);
  });

  it("şifre değişince o girişle önceden açılmış oturumlar geçersiz olur", async () => {
    const before = Math.floor(Date.now() / 1000) - 60;
    const c = await setClinicPassword(superCtx, root, B.clinicId, { kind: "staff", password: "yeni-personel-1" }, logins);
    expect(c.staffLogin.ready).toBe(true);
    const shared = await row(`clinic_id = $1 and shared and role = 'staff'`, [B.clinicId]);
    expect(shared!.authUserId).not.toBeNull();
    expect((await stateForUser(root, shared, { authTime: before })).kind).toBe("anonymous");
    expect((await stateForUser(root, shared, { authTime: Math.floor(Date.now() / 1000) + 1 })).kind).toBe("ok");
  });

  it("klinik şifresini kliniğin yöneticisi ya da genel yönetici değiştirir; personel ve başka klinik değiştiremez", async () => {
    await expectError(setClinicPassword(B.staff, root, B.clinicId, { kind: "staff", password: "personel-xyz-1" }, logins), 403);
    await expectError(setClinicPassword(A.admin, root, B.clinicId, { kind: "staff", password: "personel-xyz-1" }, logins), 403);
    await setClinicPassword(B.admin, root, B.clinicId, { kind: "admin", password: "yonetici-xyz-1" }, logins);
    await setClinicPassword(B.admin, root, B.clinicId, { kind: "staff", password: "personel-xyz-1" }, logins);
    // Personel şifresi yönetici şifresiyle aynı olamaz (aynı olursa personel yönetici olarak girebilirdi).
    await expectError(setClinicPassword(B.admin, root, B.clinicId, { kind: "staff", password: "yonetici-xyz-1" }, logins), 422, "password");
    await expectError(setClinicPassword(B.admin, root, B.clinicId, { kind: "staff", password: "kisa" }, logins), 422, "password");
    const history = await recentAudit(B.admin.db, { entity: "clinic" });
    expect(history.some((h) => h.action === "set_password")).toBe(true);
    expect(JSON.stringify(history)).not.toContain("yonetici-xyz-1");
  });

  it("gizli anahtar yokken şifre belirleme açık bir mesajla durur", async () => {
    const manual: LoginAdmin = { ...devLoginAdmin, mode: "supabase-manual" };
    const e = await expectError(setClinicPassword(superCtx, root, B.clinicId, { kind: "staff", password: "personel-xyz-9" }, manual), 409);
    expect(e.message).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});

describe("Güvenlik ağı", () => {
  it("uygulama rolü RLS'i atlayabiliyorsa klinik işlemi reddedilir", async () => {
    const db = await openDb({ kind: "pglite", dir: "memory://" });
    await migrate(db);
    await expect(forClinic(db, FIRST_CLINIC).query(`select 1`)).rejects.toBeInstanceOf(ConfigError);
    await db.close();
  });

});

/**
 * Üretimdeki gibi: uygulama, RLS'i atlayamayan ve tablo sahibi olmayan kendi rolüyle bağlanır (rol değiştirmez).
 * Yalnızca gerçek PostgreSQL ile (TEST_DATABASE_URL) çalışır.
 */
describe.runIf(!!process.env.TEST_DATABASE_URL)("Üretimdeki gibi kısıtlı uygulama rolü", () => {
  it("klinik ayrımı rol değiştirmeden de geçerli; klinik seçilmeyen bağlantı hiçbir satır görmez", async () => {
    await root.exec(`do $$ begin
      create role cihaz_app_test login password 'test' nobypassrls;
    exception when duplicate_object or unique_violation then null; end $$;`);
    await root.exec(`grant usage on schema public to cihaz_app_test;
      grant select, insert, update, delete on all tables in schema public to cihaz_app_test;
      grant usage, select on all sequences in schema public to cihaz_app_test;`);
    const [{ name }] = (await root.query<{ name: string }>(`select current_database() as name`)) as [{ name: string }];
    const u = new URL(process.env.TEST_DATABASE_URL!);
    u.username = "cihaz_app_test";
    u.password = "test";
    u.pathname = `/${name}`;
    const app = await openDb({ kind: "pg", url: u.toString() });
    try {
      const count = async (db: Db) => (await db.query<{ n: number }>(`select count(*) as n from devices`))[0]!.n;
      const total = (await root.query<{ n: number }>(`select count(*) as n from devices`))[0]!.n;
      const inA = await count(forClinic(app, FIRST_CLINIC));
      const inB = await count(forClinic(app, B.clinicId));
      expect(inA).toBeGreaterThan(0);
      expect(inB).toBeGreaterThan(0);
      expect(inA + inB).toBeLessThanOrEqual(total);
      expect(await count(app)).toBe(0);
      await expect(
        forClinic(app, B.clinicId).query(`update devices set name = 'Ele geçirme' where clinic_id = $1 returning id`, [FIRST_CLINIC]),
      ).resolves.toEqual([]);
      // Giriş anında (klinik seçilmeden) hesaplar ve klinik listesi okunabilir.
      expect((await app.query(`select id from app_users`)).length).toBeGreaterThan(0);
      expect((await loginClinics(app)).length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
