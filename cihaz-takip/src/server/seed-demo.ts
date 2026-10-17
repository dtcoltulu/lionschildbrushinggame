import { addDays, todayIstanbul } from "@/lib/dates";
import type { Ctx } from "./context";
import type { Db } from "./db";
import { createDevices } from "./services/devices";
import { createFault, updateFault } from "./services/faults";
import { createLookup } from "./services/lookups";
import { createStaff } from "./services/staff";

/**
 * YALNIZCA geliştirme veritabanı (PGlite) için örnek veri. Tüm adlar "Örnek"/"Demo" ile başlar ve
 * ekranda "GELİŞTİRME – örnek veriler" şeridi görünür: gerçek klinik verisi gibi sunulmaz.
 * SEED_DEMO=users → yalnızca iki deneme hesabı; SEED_DEMO=0 → hiçbir şey.
 */
export async function seedDemoIfEmpty(db: Db): Promise<void> {
  const [{ n }] = (await db.query<{ n: number }>(`select count(*) as n from app_users`)) as [{ n: number }];
  if (n > 0) return;
  const [admin] = await db.query<{ id: string }>(
    `insert into app_users (email, email_key, display_name, role) values ('demo-yonetici@ornek.local', 'demo-yonetici@ornek.local', 'Demo Yönetici', 'admin') returning id`,
  );
  await db.query(
    `insert into app_users (email, email_key, display_name, role) values ('demo-personel@ornek.local', 'demo-personel@ornek.local', 'Demo Personel', 'staff')`,
  );
  if (process.env.SEED_DEMO === "users") return;

  const today = todayIstanbul();
  const ctx: Ctx = { db, today, actor: { userId: admin!.id, role: "admin", displayName: "Demo Yönetici", email: "demo-yonetici@ornek.local", staffId: null } };
  const loc = new Map((await db.query<{ id: string; name: string }>(`select id, name from locations`)).map((r) => [r.name, r.id]));
  const type = new Map((await db.query<{ id: string; prefix: string }>(`select id, code_prefix as prefix from device_types`)).map((r) => [r.prefix, r.id]));

  const people = [
    ["Örnek Hekim A", "dis_hekimi", "Ünit 1"],
    ["Örnek Uzman Hekim B", "uzman_dis_hekimi", "Ünit 2"],
    ["Örnek Asistan C", "asistan", "Ünit 1"],
    ["Örnek Asistan D", "asistan", "Sterilizasyon"],
    ["Örnek Sekreter E", "sekreter", "Banko"],
    ["Örnek Müdür F", "klinik_muduru", null],
  ] as const;
  const staff: Record<string, string> = {};
  for (const [fullName, jobRole, l] of people) {
    staff[fullName] = (await createStaff(ctx, { fullName, jobRole, locationId: l ? loc.get(l) : null })).id;
  }
  await db.query(`update app_users set staff_id = $1 where email_key = 'demo-yonetici@ornek.local'`, [staff["Örnek Müdür F"]]);
  await db.query(`update app_users set staff_id = $1 where email_key = 'demo-personel@ornek.local'`, [staff["Örnek Asistan C"]]);
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
