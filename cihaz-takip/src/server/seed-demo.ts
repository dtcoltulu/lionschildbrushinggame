import { addDays, todayIstanbul } from "@/lib/dates";
import { seedClinicDefaults } from "./clinic-defaults";
import type { Actor, Ctx } from "./context";
import { forClinic, type Db } from "./db";
import { createDevices } from "./services/devices";
import { createFault, updateFault } from "./services/faults";
import { createLookup } from "./services/lookups";
import { createStaff } from "./services/staff";

/** 0004 geçişinin açtığı ilk klinik. */
export const FIRST_CLINIC_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_CLINIC_B = "00000000-0000-4000-8000-0000000000b2";

/**
 * YALNIZCA geliştirme/önizleme veritabanı için örnek veri. Tüm adlar "Örnek"/"Demo" ile başlar ve
 * ekranda "GELİŞTİRME – örnek veriler" şeridi görünür: gerçek klinik verisi gibi sunulmaz.
 * İki klinik açılır (ayrımı denemek için): ilk klinik ve "Örnek Klinik B"; her birinin ortak personel ve
 * yönetici girişi ile bir de genel yönetici hesabı.
 * SEED_DEMO=users → yalnızca klinikler ve deneme hesapları; SEED_DEMO=0 → hiçbir şey.
 */
export async function seedDemoIfEmpty(db: Db): Promise<void> {
  const [{ n }] = (await db.query<{ n: number }>(`select count(*) as n from app_users`)) as [{ n: number }];
  if (n > 0) return;
  await db.query(
    `insert into app_users (email, email_key, display_name, role) values ('demo-genel@ornek.local', 'demo-genel@ornek.local', 'Demo Genel Yönetici', 'admin')`,
  );
  const shared = async (clinicId: string, role: "admin" | "staff", name: string, email: string) => {
    const [u] = await forClinic(db, clinicId).query<{ id: string }>(
      `insert into app_users (email, email_key, display_name, role, clinic_id, shared) values ($1, $1, $2, $3, $4, true) returning id`,
      [email, name, role, clinicId],
    );
    return u!.id;
  };
  const adminId = await shared(FIRST_CLINIC_ID, "admin", "Demo Yönetici", "demo-yonetici@ornek.local");
  await shared(FIRST_CLINIC_ID, "staff", "Demo Personel", "demo-personel@ornek.local");
  await forClinic(db, DEMO_CLINIC_B).tx(async (q) => {
    await q.query(`insert into clinics (id, name, name_key, sort_order) values ($1, 'Örnek Klinik B', 'ornek klinik b', 20)`, [DEMO_CLINIC_B]);
    await seedClinicDefaults(q);
  });
  const adminB = await shared(DEMO_CLINIC_B, "admin", "Demo B Yönetici", "demo-b-yonetici@ornek.local");
  await shared(DEMO_CLINIC_B, "staff", "Demo B Personel", "demo-b-personel@ornek.local");
  if (process.env.SEED_DEMO === "users") return;

  const today = todayIstanbul();
  const actor = (userId: string, displayName: string, clinicId: string, clinicName: string): Actor => ({
    userId, role: "admin", displayName, email: "", staffId: null, clinicId, clinicName, superAdmin: false, shared: true,
  });
  const ctx: Ctx = { db: forClinic(db, FIRST_CLINIC_ID), today, actor: actor(adminId, "Demo Yönetici", FIRST_CLINIC_ID, "") };
  const ctxB: Ctx = { db: forClinic(db, DEMO_CLINIC_B), today, actor: actor(adminB, "Demo B Yönetici", DEMO_CLINIC_B, "Örnek Klinik B") };
  const typeB = (await ctxB.db.query<{ id: string }>(`select id from device_types where code_prefix = 'AER'`))[0]!.id;
  await createDevices(ctxB, { name: "Aeratör (Klinik B örneği)", typeId: typeB, quantity: 1 });

  const loc = new Map((await ctx.db.query<{ id: string; name: string }>(`select id, name from locations`)).map((r) => [r.name, r.id]));
  const type = new Map((await ctx.db.query<{ id: string; prefix: string }>(`select id, code_prefix as prefix from device_types`)).map((r) => [r.prefix, r.id]));

  const people = [
    ["Örnek Hekim A", "dis_hekimi", ["Ünit 1", "Ünit 2"]],
    ["Örnek Uzman Hekim B", "uzman_dis_hekimi", ["Ünit 2"]],
    ["Örnek Asistan C", "asistan", ["Ünit 1", "Ünit 3"]],
    ["Örnek Asistan D", "asistan", ["Sterilizasyon"]],
    ["Örnek Sekreter E", "sekreter", ["Banko"]],
    ["Örnek Müdür F", "klinik_muduru", []],
  ] as const;
  const staff: Record<string, string> = {};
  for (const [fullName, jobRole, rooms] of people) {
    staff[fullName] = (await createStaff(ctx, { fullName, jobRole, locationIds: rooms.map((r) => loc.get(r)) })).id;
  }
  const vendor = (await createLookup(ctx, "service_vendors", { name: "Örnek Teknik Servis Ltd." })).id;

  const add = async (body: Record<string, unknown>) => (await createDevices(ctx, body)).ids;
  const [aer1, aer2] = await add({ name: "Aeratör (örnek)", typeId: type.get("AER"), brand: "Örnek Marka", model: "Model X", locationId: loc.get("Ünit 1"), responsibleStaffId: staff["Örnek Hekim A"], quantity: 2 });
  const [ang1] = await add({ name: "Anguldruva (örnek)", typeId: type.get("ANG"), brand: "Örnek Marka", model: "Model Y", serialNumber: "ORNEK-123", locationId: loc.get("Ünit 2"), responsibleStaffId: staff["Örnek Uzman Hekim B"] });
  await add({ name: "Mikromotor (örnek)", typeId: type.get("MKM"), locationId: loc.get("Ünit 1"), responsibleStaffId: staff["Örnek Asistan C"] });
  await add({ name: "Otoklav (örnek)", typeId: type.get("OTK"), locationId: loc.get("Sterilizasyon"), responsibleStaffId: staff["Örnek Asistan D"] });
  await add({ name: "Dental ünit 1 (örnek)", typeId: type.get("UNT"), locationId: loc.get("Ünit 1") });

  // Serviste ve beklenen dönüşü geçmiş (Gecikti) arıza
  const f1 = await createFault(ctx, { deviceId: aer1, description: "Örnek: dönüş sırasında ses yapıyor", noticedOn: addDays(today, -20), noticedByStaffId: staff["Örnek Asistan C"], locationId: loc.get("Ünit 1") });
  await updateFault(ctx, f1.id, { ...base(f1), status: "serviste", visit: { vendorId: vendor, sentOn: addDays(today, -18), expectedReturnOn: addDays(today, -3) } });
  // Tamirden gelmiş, kullanıma hazır, maliyeti girilmiş
  const f2 = await createFault(ctx, { deviceId: ang1, description: "Örnek: frez tutmuyor", noticedOn: addDays(today, -45), noticedByStaffId: staff["Örnek Uzman Hekim B"] });
  const f2b = await updateFault(ctx, f2.id, { ...base(f2), status: "serviste", visit: { vendorId: vendor, sentOn: addDays(today, -44) } });
  await updateFault(ctx, f2.id, { ...base(f2b), status: "tamirden_geldi", visit: { returnedOn: addDays(today, -30), workDone: "Örnek: kartuş değişti", costAmount: "1.500", costDate: addDays(today, -30), outcome: "kullanima_hazir" } });
  // Yeni bildirilmiş arıza
  await createFault(ctx, { deviceId: aer2, description: "Örnek: su gelmiyor", noticedOn: today });
}

function base(f: { version: number; description: string; noticedOn: string }) {
  return { version: f.version, description: f.description, noticedOn: f.noticedOn };
}
