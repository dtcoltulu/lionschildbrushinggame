/**
 * Kabul testleri (servis katmanı, gerçek SQL şemasıyla). Numaralar kabul listesindeki senaryolardır.
 * Arayüz/HTTP tarafı (14, 15 ve 13'ün HTTP hâli) e2e testlerindedir.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JOB_ROLE_VALUES } from "@/lib/labels";
import { AppError, ForbiddenError } from "@/server/errors";
import { causeStats, costReport, deviceRepairStats, overview } from "@/server/services/analytics";
import { createDevices, getDevice, listDevices, updateDevice } from "@/server/services/devices";
import {
  createFault, deleteFault, getFault, listFaults, purgeFault, requestDeletion, restoreFault, updateFault, updateVisit,
} from "@/server/services/faults";
import { createLookup, updateLookup } from "@/server/services/lookups";
import { createStaff, listStaff, staffRecordCounts, updateStaff } from "@/server/services/staff";
import { createUser, updateUser } from "@/server/services/users";
import { devLoginAdmin } from "@/server/login-admin";
import { at, world, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await world();
});
afterAll(async () => w.db.close());

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

const base = (f: { version: number; description: string; noticedOn: string }) => ({ version: f.version, description: f.description, noticedOn: f.noticedOn });

async function newDevice(name = "Test cihazı", prefix = "MKM") {
  const { ids } = await createDevices(w.admin, { name, typeId: w.type[prefix] });
  return ids[0]!;
}

describe("1. Aynı modelde iki cihaz ayrı takip edilir", () => {
  it("farklı envanter kodlarıyla iki ayrı kart", async () => {
    const a = await createDevices(w.staff, { name: "Aeratör", typeId: w.type.AER, brand: "W&H", model: "Synea TA-98" });
    const b = await createDevices(w.staff, { name: "Aeratör", typeId: w.type.AER, brand: "W&H", model: "Synea TA-98" });
    expect(a.codes[0]).not.toBe(b.codes[0]);
    expect(a.ids[0]).not.toBe(b.ids[0]);
    // Birindeki arıza diğerini etkilemez
    await createFault(w.staff, { deviceId: a.ids[0], description: "Ses yapıyor" });
    expect((await getDevice(w.db, w.admin.today, a.ids[0]!))!.availability).toBe("arizali");
    expect((await getDevice(w.db, w.admin.today, b.ids[0]!))!.availability).toBe("kullanilabilir");
  });

  it("toplu ekleme ardışık kod verir; elle verilen kod tekrar kullanılamaz", async () => {
    const r = await createDevices(w.admin, { name: "Piyasemen", typeId: w.type.PYS, quantity: 3 });
    expect(r.codes).toEqual(["PYS-001", "PYS-002", "PYS-003"]);
    await expectError(createDevices(w.admin, { name: "Piyasemen", typeId: w.type.PYS, inventoryCode: "pys-002" }), 422, "inventoryCode");
    const units = await createDevices(w.admin, { name: "Dental ünit", typeId: w.type.UNT, quantity: 2 });
    expect(units.codes).toEqual(["UNT-01", "UNT-02"]);
  });
});

describe("2. Seri numarası bilinmeden cihaz kaydedilir", () => {
  it("yalnızca ad ve tür yeterli; eksikler sonradan tamamlanır", async () => {
    const { ids } = await createDevices(w.staff, { name: "Otoklav", typeId: w.type.OTK });
    const d = (await getDevice(w.db, w.admin.today, ids[0]!))!;
    expect(d.serialNumber).toBeNull();
    const after = await updateDevice(w.staff, d.id, { ...d, version: d.version, serialNumber: "SN-778", brand: "Melag" });
    expect(after.serialNumber).toBe("SN-778");
    expect(after.version).toBe(d.version + 1);
  });

  it("zorunlu alan eksikse hata alanı belirtir", async () => {
    const e = await expectError(createDevices(w.staff, { typeId: w.type.OTK }), 422, "name");
    expect(e.fieldErrors!.name).toMatch(/Cihaz adı/);
  });
});

describe("3. Tüm görev gruplarından çalışan eklenir ve sorumlu seçilir", () => {
  it("her görev için personel kartı + cihaz sorumlusu", async () => {
    for (const role of JOB_ROLE_VALUES) {
      const s = await createStaff(w.admin, { fullName: `Kişi ${role}`, jobRole: role });
      const { ids } = await createDevices(w.staff, { name: `Cihaz ${role}`, typeId: w.type.DGR, responsibleStaffId: s.id });
      expect((await getDevice(w.db, w.admin.today, ids[0]!))!.responsibleName).toBe(`Kişi ${role}`);
    }
  });

  it("aynı kişi farklı yazımla tekrar eklenemez (açık onay olmadan)", async () => {
    await createStaff(w.admin, { fullName: "Ayşe Yılmaz", jobRole: "asistan" });
    const e = await expectError(createStaff(w.admin, { fullName: "  AYSE   yilmaz ", jobRole: "asistan" }), 409, "fullName");
    expect(e.message).toMatch(/zaten kayıtlı/);
    const twin = await createStaff(w.admin, { fullName: "Ayşe Yılmaz", jobRole: "sekreter", confirmDuplicate: true });
    expect(twin.id).toBeTruthy();
  });

  it("personel kartı yönetimi personel rolüne kapalı", async () => {
    await expectError(createStaff(w.staff, { fullName: "Yetkisiz", jobRole: "diger" }), 403);
  });
});

describe("4. Sadece temel bilgilerle arıza kaydedilir", () => {
  it("cihaz + açıklama yeterli; tarih bugün, neden 'Belirlenmedi', durum 'Arızalı'", async () => {
    const id = await newDevice();
    const f = await createFault(w.staff, { deviceId: id, description: "Çalışmıyor" });
    expect(f.noticedOn).toBe(w.staff.today);
    expect(f.causeName).toBe("Belirlenmedi");
    expect(f.causeVerification).toBe("on_degerlendirme");
    expect(f.status).toBe("arizali");
    expect(f.responsibleStaffId).toBeNull();
  });

  it("fark eden, son kullanıcı ve sorumlu ayrı alanlardır; sorumlu otomatik atanmaz", async () => {
    const id = await newDevice();
    const finder = await createStaff(w.admin, { fullName: "Bulan Kişi", jobRole: "asistan" });
    const user = await createStaff(w.admin, { fullName: "Son Kullanan", jobRole: "dis_hekimi" });
    const f = await createFault(w.staff, { deviceId: id, description: "Isınıyor", noticedByStaffId: finder.id, lastUserStaffId: user.id });
    expect(f.noticedByName).toBe("Bulan Kişi");
    expect(f.lastUserName).toBe("Son Kullanan");
    expect(f.responsibleStaffId).toBeNull();
  });

  it("sorumluluk ataması kanıt ve doğrulayan kişi ister; yalnızca yönetici yapar", async () => {
    const id = await newDevice();
    const p = await createStaff(w.admin, { fullName: "Sorumlu Aday", jobRole: "asistan" });
    const v = await createStaff(w.admin, { fullName: "Doğrulayan Müdür", jobRole: "klinik_muduru" });
    const f = await createFault(w.staff, { deviceId: id, description: "Düştü" });
    await expectError(updateFault(w.admin, f.id, { ...base(f), responsibleStaffId: p.id }), 422, "responsibilityEvidence");
    await expectError(updateFault(w.staff, f.id, { ...base(f), responsibleStaffId: p.id, responsibilityEvidence: "Kamera kaydı", responsibilityVerifiedByStaffId: v.id }), 403);
    const ok = await updateFault(w.admin, f.id, { ...base(f), responsibleStaffId: p.id, responsibilityEvidence: "Kamera kaydı", responsibilityVerifiedByStaffId: v.id });
    expect(ok.responsibleName).toBe("Sorumlu Aday");
  });

  it("gelecek tarihli fark edilme reddedilir ve alan belirtilir", async () => {
    const id = await newDevice();
    const e = await expectError(createFault(w.staff, { deviceId: id, description: "x", noticedOn: "2026-10-18" }), 422, "noticedOn");
    expect(e.fieldErrors!.noticedOn).toMatch(/ileri bir tarih olamaz/);
  });

  it("açık arızası olan cihaza ikinci kayıt açılamaz; mevcut kayda yönlendirilir", async () => {
    const id = await newDevice();
    const f = await createFault(w.staff, { deviceId: id, description: "İlk" });
    const e = await expectError(createFault(w.staff, { deviceId: id, description: "İkinci" }), 409);
    expect(e.code).toBe("open_fault_exists");
    expect(e.data!.faultId).toBe(f.id);
  });

  it("aynı anda iki bildirim gelse de yalnızca biri açılır", async () => {
    const id = await newDevice();
    const results = await Promise.allSettled([
      createFault(w.staff, { deviceId: id, description: "A" }),
      createFault(w.admin, { deviceId: id, description: "B" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const open = await listFaults(w.db, w.admin.today, { deviceId: id, view: "acik" });
    expect(open).toHaveLength(1);
  });
});

describe("5–7. Servis kayıtları", () => {
  it("5. firma ve gönderim tarihi boşken 'Serviste' kaydedilir; sonradan tamamlanır", async () => {
    const id = await newDevice();
    const f = await createFault(w.staff, { deviceId: id, description: "Servis lazım" });
    const s = await updateFault(w.staff, f.id, { ...base(f), status: "serviste", visit: {} });
    expect(s.status).toBe("serviste");
    expect(s.currentVisit!.vendorId).toBeNull();
    expect(s.currentVisit!.sentOn).toBeNull();
    const vendor = await createLookup(w.staff, "service_vendors", { name: "ABC Teknik" });
    const s2 = await updateFault(w.staff, f.id, { ...base(s), status: "serviste", visit: { vendorId: vendor.id, sentOn: "2026-10-17" } });
    expect(s2.currentVisit!.vendorName).toBe("ABC Teknik");
    expect(s2.visits).toHaveLength(1);
  });

  it("doğrudan 'Serviste' olarak bildirim de yapılabilir", async () => {
    const id = await newDevice();
    const f = await createFault(w.staff, { deviceId: id, description: "Gönderildi", status: "serviste", visit: { sentOn: "2026-10-17" } });
    expect(f.status).toBe("serviste");
    expect(f.visits).toHaveLength(1);
  });

  it("6. beklenen dönüş ileri tarih olabilir; gerçekleşen tarihler ileri olamaz", async () => {
    const id = await newDevice();
    const f = await createFault(w.staff, { deviceId: id, description: "x" });
    const s = await updateFault(w.staff, f.id, { ...base(f), status: "serviste", visit: { sentOn: "2026-10-17", expectedReturnOn: "2026-11-30" } });
    expect(s.currentVisit!.expectedReturnOn).toBe("2026-11-30");
    await expectError(updateFault(w.staff, f.id, { ...base(s), status: "serviste", visit: { sentOn: "2026-10-20" } }), 422, "visit.sentOn");
    await expectError(
      updateFault(w.staff, f.id, { ...base(s), status: "tamirden_geldi", visit: { returnedOn: "2026-10-25", outcome: "kullanima_hazir" } }),
      422,
      "visit.returnedOn",
    );
    await expectError(
      updateFault(w.staff, f.id, { ...base(s), status: "tamirden_geldi", visit: { returnedOn: "2026-10-17", costAmount: "100", costDate: "2026-12-01", outcome: "kullanima_hazir" } }),
      422,
      "visit.costDate",
    );
  });

  it("7. beklenen dönüş geçince 'Gecikti' görünür ama kayıt engellenmez", async () => {
    const id = await newDevice();
    const f = await createFault(w.staff, { deviceId: id, description: "x", noticedOn: "2026-10-01" });
    const s = await updateFault(w.staff, f.id, { ...base(f), status: "serviste", visit: { sentOn: "2026-10-02", expectedReturnOn: "2026-10-10" } });
    expect((await getDevice(w.db, "2026-10-17", id))!.availability).toBe("gecikti");
    const late = at(w.staff, "2026-10-17");
    const s2 = await updateFault(late, f.id, { ...base(s), status: "serviste", visit: { serviceNote: "Firma aradı, parça bekleniyor" } });
    expect(s2.currentVisit!.serviceNote).toMatch(/parça/);
    expect((await listFaults(w.db, "2026-10-17", { view: "gecikti" })).some((x) => x.id === f.id)).toBe(true);
  });

  it("çelişen tarihler alanı belirtilerek reddedilir", async () => {
    const id = await newDevice();
    const f = await createFault(w.staff, { deviceId: id, description: "x", noticedOn: "2026-10-10" });
    const e = await expectError(updateFault(w.staff, f.id, { ...base(f), status: "serviste", visit: { sentOn: "2026-10-05" } }), 422, "visit.sentOn");
    expect(e.fieldErrors!["visit.sentOn"]).toMatch(/fark edildiği tarihten/);
    const s = await updateFault(w.staff, f.id, { ...base(f), status: "serviste", visit: { sentOn: "2026-10-12" } });
    await expectError(
      updateFault(w.staff, f.id, { ...base(s), status: "tamirden_geldi", visit: { returnedOn: "2026-10-11", outcome: "sorun_devam" } }),
      422,
      "visit.returnedOn",
    );
  });
});

describe("8. Aynı servis kaydının güncellenmesi tamire gidiş sayısını artırmaz", () => {
  it("defalarca düzenleme = 1 gidiş; tekrar gönderim = 2 gidiş; geri alınan gönderim sayılmaz", async () => {
    const id = await newDevice("Sayım cihazı", "ANG");
    let f = await createFault(w.staff, { deviceId: id, description: "x", noticedOn: "2026-10-01" });
    f = await updateFault(w.staff, f.id, { ...base(f), status: "serviste", visit: { sentOn: "2026-10-02" } });
    for (const note of ["a", "b", "c"]) f = await updateFault(w.staff, f.id, { ...base(f), status: "serviste", visit: { serviceNote: note } });
    f = await updateFault(w.staff, f.id, { ...base(f), status: "tamirden_geldi", visit: { returnedOn: "2026-10-05", outcome: "sorun_devam" } });
    f = await updateFault(w.staff, f.id, { ...base(f), status: "tamirden_geldi", visit: { workDone: "Rulman", outcome: "sorun_devam" } });
    let stats = await deviceRepairStats(w.db, { from: null, to: null });
    expect(stats.rows.find((r) => r.deviceId === id)!.tripCount).toBe(1);
    expect(stats.rows.find((r) => r.deviceId === id)!.faultCount).toBe(1);

    // "Serviste" seçildiğinde niyet sorulur
    await expectError(updateFault(w.staff, f.id, { ...base(f), status: "serviste", visit: {} }), 422, "resend");
    f = await updateFault(w.staff, f.id, { ...base(f), status: "serviste", resend: true, visit: { sentOn: "2026-10-06" } });
    expect(f.visits).toHaveLength(2);
    expect(f.currentVisit!.returned).toBe(false);
    stats = await deviceRepairStats(w.db, { from: null, to: null });
    expect(stats.rows.find((r) => r.deviceId === id)!.tripCount).toBe(2);

    // Yanlışlıkla "Serviste" seçilen yeni arıza: geri alınca gidiş sayılmaz
    const id2 = await newDevice("Geri alma cihazı", "ANG");
    let g = await createFault(w.staff, { deviceId: id2, description: "y" });
    g = await updateFault(w.staff, g.id, { ...base(g), status: "serviste", visit: {} });
    g = await updateFault(w.staff, g.id, { ...base(g), status: "arizali" });
    expect(g.visits).toHaveLength(0);
    stats = await deviceRepairStats(w.db, { from: null, to: null });
    expect(stats.rows.find((r) => r.deviceId === id2)!.tripCount).toBe(0);
    expect(stats.rows.find((r) => r.deviceId === id2)!.faultCount).toBe(1);
  });

  it("servise gitmemiş arıza gidiş sayısını artırmaz", async () => {
    const id = await newDevice();
    await createFault(w.staff, { deviceId: id, description: "Sadece bildirim" });
    const stats = await deviceRepairStats(w.db, { from: null, to: null });
    const row = stats.rows.find((r) => r.deviceId === id)!;
    expect(row.faultCount).toBe(1);
    expect(row.tripCount).toBe(0);
  });
});

describe("9. Tamirden dönen ama sorunu devam eden cihaz kullanılabilir sayılmaz", () => {
  it("sonuç 'Sorun devam ediyor' → arıza açık, cihaz kullanılamaz; 'Kullanıma hazır' → kapanır", async () => {
    const id = await newDevice();
    let f = await createFault(w.staff, { deviceId: id, description: "x", noticedOn: "2026-10-01" });
    f = await updateFault(w.staff, f.id, { ...base(f), status: "serviste", visit: {} });
    await expectError(updateFault(w.staff, f.id, { ...base(f), status: "tamirden_geldi", visit: {} }), 422, "visit.outcome");
    f = await updateFault(w.staff, f.id, { ...base(f), status: "tamirden_geldi", visit: { outcome: "sorun_devam" } });
    expect(f.closedAt).toBeNull();
    expect((await getDevice(w.db, w.admin.today, id))!.availability).toBe("sorun_devam");
    expect((await overview(w.db, w.admin.today)).unusable).toBeGreaterThan(0);
    await expectError(createFault(w.staff, { deviceId: id, description: "yeni" }), 409);
    f = await updateFault(w.staff, f.id, { ...base(f), status: "tamirden_geldi", visit: { outcome: "denenmedi" } });
    expect((await getDevice(w.db, w.admin.today, id))!.availability).toBe("denenmedi");
    f = await updateFault(w.staff, f.id, { ...base(f), status: "tamirden_geldi", visit: { outcome: "kullanima_hazir" } });
    expect(f.closedAt).not.toBeNull();
    expect((await getDevice(w.db, w.admin.today, id))!.availability).toBe("kullanilabilir");
  });

  it("gerçek dönüş tarihi bilinmiyorsa uydurulmaz", async () => {
    const id = await newDevice();
    let f = await createFault(w.staff, { deviceId: id, description: "x" });
    f = await updateFault(w.staff, f.id, { ...base(f), status: "serviste", visit: { sentOn: "2026-10-17" } });
    f = await updateFault(w.staff, f.id, { ...base(f), status: "tamirden_geldi", visit: { outcome: "kullanima_hazir" } });
    expect(f.currentVisit!.returned).toBe(true);
    expect(f.currentVisit!.returnedOn).toBeNull();
  });

  it("serviste olan arıza 'servise gitmeden çözüldü' yapılamaz; arızalı olan yapılabilir", async () => {
    const id = await newDevice();
    let f = await createFault(w.staff, { deviceId: id, description: "x" });
    const solved = await updateFault(w.staff, f.id, { ...base(f), status: "cozuldu", resolutionNote: "Yağlandı" });
    expect(solved.closedAt).not.toBeNull();
    const id2 = await newDevice();
    f = await createFault(w.staff, { deviceId: id2, description: "y" });
    f = await updateFault(w.staff, f.id, { ...base(f), status: "serviste", visit: {} });
    await expectError(updateFault(w.staff, f.id, { ...base(f), status: "cozuldu" }), 422, "status");
  });
});

describe("10. Maliyet doğru aya yazılır; tarihi eksik tutar ayrı gösterilir", () => {
  it("masraf tarihine göre ay; tarihsiz tutar hiçbir aya girmez; tutarsız ≠ ücretsiz", async () => {
    const db = (await world("2026-10-17")).db;
    const local = await world("2026-10-17");
    const ctx = local.staff;
    const mk = async (name: string) => (await createDevices(local.admin, { name, typeId: local.type.KMP })).ids[0]!;
    const back = async (deviceId: string, visit: Record<string, unknown>) => {
      const f = await createFault(ctx, { deviceId, description: "x", noticedOn: "2026-07-01" });
      return updateFault(ctx, f.id, { ...base(f), status: "tamirden_geldi", visit: { outcome: "kullanima_hazir", ...visit } });
    };
    await back(await mk("A"), { returnedOn: "2026-08-30", costAmount: "1.250,50", costDate: "2026-09-02" }); // eylüle yazılır (dönüş ağustos olsa da)
    await back(await mk("B"), { costAmount: "2000", costDate: "2026-10-05" }); // ekim
    await back(await mk("C"), { costAmount: "750" }); // tarihi eksik
    await back(await mk("D"), { costAmount: "0", costDate: "2026-10-06" }); // ücretsiz
    await back(await mk("E"), {}); // tutarı bilinmiyor

    const r = await costReport(local.db, { from: null, to: null }, "2026-10-17");
    const month = (k: string) => r.months.find((m) => m.month === k)!;
    expect(month("2026-08").total).toBe(0);
    expect(month("2026-09").total).toBe(1250.5);
    expect(month("2026-10").total).toBe(2000);
    expect(month("2026-10").freeCount).toBe(1);
    expect(r.thisMonthTotal).toBe(2000);
    expect(r.undated).toHaveLength(1);
    expect(r.undatedTotal).toBe(750);
    expect(r.unknownAmount).toHaveLength(1);
    expect(r.months.reduce((s, m) => s + m.total, 0)).toBe(3250.5);

    const sept = await costReport(local.db, { from: "2026-09-01", to: "2026-09-30" }, "2026-10-17");
    expect(sept.periodTotal).toBe(1250.5);
    expect(sept.byDevice).toHaveLength(1);
    await expectError(back(await mk("F"), { costAmount: "12abc" }), 422, "visit.costAmount");
    await db.close();
    await local.db.close();
  });
});

describe("11. Deneme arızası silinince analizlerden çıkar, cihaz kartı korunur", () => {
  it("silme → sayımlardan çıkar, cihaz durur, yeni arıza açılabilir; geri alma mümkün", async () => {
    const local = await world();
    const { ids } = await createDevices(local.admin, { name: "Deneme cihazı", typeId: local.type.AER });
    const id = ids[0]!;
    let f = await createFault(local.staff, { deviceId: id, description: "Deneme kaydı", causeId: local.cause["dusme darbe"] });
    f = await updateFault(local.staff, f.id, { ...base(f), status: "tamirden_geldi", visit: { costAmount: "500", costDate: "2026-10-01", outcome: "sorun_devam" } });
    expect((await deviceRepairStats(local.db, { from: null, to: null })).rows[0]!.tripCount).toBe(1);

    // Personel silemez, yalnızca talep eder
    await expectError(deleteFault(local.staff, f.id, {}), 403);
    await requestDeletion(local.staff, f.id, { reason: "Deneme amaçlı girildi" });
    expect((await listFaults(local.db, local.admin.today, { view: "silme_talebi" }))).toHaveLength(1);

    await deleteFault(local.admin, f.id, { reason: "Deneme" });
    expect(await getDevice(local.db, local.admin.today, id)).not.toBeNull();
    expect((await getDevice(local.db, local.admin.today, id))!.availability).toBe("kullanilabilir");
    expect((await deviceRepairStats(local.db, { from: null, to: null })).rows).toHaveLength(0);
    expect((await costReport(local.db, { from: null, to: null }, local.admin.today)).thisMonthTotal).toBe(0);
    expect((await causeStats(local.db, { from: null, to: null })).total).toBe(0);
    expect((await overview(local.db, local.admin.today)).openFaults).toBe(0);
    const audit = await local.db.query<{ action: string; actor_label: string }>(`select action, actor_label from audit_log where entity_id = $1 order by id`, [f.id]);
    expect(audit.at(-1)).toMatchObject({ action: "delete", actor_label: "Test Yönetici" });

    // Silinen açık arıza yeni kaydı engellemez
    const g = await createFault(local.staff, { deviceId: id, description: "Gerçek arıza" });
    // Geri alma, cihazda başka açık arıza varken çakışmayı açıkça söyler
    const e = await expectError(restoreFault(local.admin, f.id), 409);
    expect(e.code).toBe("open_fault_exists");
    await updateFault(local.staff, g.id, { ...base(g), status: "cozuldu" });
    await restoreFault(local.admin, f.id);
    expect((await getFault(local.db, f.id))!.deletedAt).toBeNull();
    await expectError(restoreFault(local.staff, f.id), 403);

    // Kalıcı silme yalnızca yöneticide ve önce silinmiş olmalı
    await expectError(purgeFault(local.admin, f.id), 409);
    await deleteFault(local.admin, f.id, {});
    await expectError(purgeFault(local.staff, f.id), 403);
    await purgeFault(local.admin, f.id);
    expect(await getFault(local.db, f.id)).toBeNull();
    await local.db.close();
  });
});

describe("Çalışanın birden fazla odası", () => {
  it("birden fazla oda seçilir, değiştirilir, geçmişe adlarıyla yazılır; pasif oda korunur", async () => {
    const s = await createStaff(w.admin, { fullName: "Çok Odalı Hekim", jobRole: "dis_hekimi", locationIds: [w.loc["Ünit 2"], w.loc["Ünit 1"]] });
    expect(s.locationNames).toEqual(["Ünit 1", "Ünit 2"]);
    const s2 = await updateStaff(w.admin, s.id, { ...s, locationIds: [w.loc["Ünit 2"], w.loc["Ünit 3"], w.loc["Sterilizasyon"]] });
    expect(s2.locationNames).toEqual(["Ünit 2", "Ünit 3", "Sterilizasyon"]);
    const [log] = await w.db.query<{ changes: Record<string, { from: unknown; to: unknown }> }>(
      `select changes from audit_log where entity = 'staff' and entity_id = $1 and action = 'update'`, [s.id],
    );
    expect(log!.changes.locationNames).toMatchObject({ from: ["Ünit 1", "Ünit 2"], to: ["Sterilizasyon", "Ünit 2", "Ünit 3"] });
    // Odasız çalışan
    const s3 = await updateStaff(w.admin, s.id, { ...s2, locationIds: [] });
    expect(s3.locationIds).toEqual([]);
    // Geçersiz oda alanı belirterek reddedilir
    await expectError(updateStaff(w.admin, s.id, { ...s3, locationIds: ["00000000-0000-4000-8000-000000000000"] }), 422, "locationIds");
    // Pasifleştirilen oda atamada kalır
    const room = await createLookup(w.admin, "locations", { name: "Geçici oda" });
    const s4 = await updateStaff(w.admin, s.id, { ...s3, locationIds: [room.id] });
    await updateLookup(w.admin, "locations", room.id, { ...room, active: false });
    expect((await listStaff(w.db, { includeInactive: true })).find((x) => x.id === s4.id)!.locationNames).toEqual(["Geçici oda"]);
  });
});

describe("12. Pasif personelin geçmiş kayıtları korunur", () => {
  it("pasif yapılır, kayıtlarda adı görünmeye devam eder, listeden seçimde çıkmaz", async () => {
    const s = await createStaff(w.admin, { fullName: "Ayrılan Çalışan", jobRole: "asistan" });
    const { ids } = await createDevices(w.staff, { name: "Mikromotor", typeId: w.type.MKM, responsibleStaffId: s.id });
    const f = await createFault(w.staff, { deviceId: ids[0], description: "x", noticedByStaffId: s.id });
    const after = await updateStaff(w.admin, s.id, { ...s, version: s.version, active: false });
    expect(after.active).toBe(false);
    expect((await getDevice(w.db, w.admin.today, ids[0]!))!.responsibleName).toBe("Ayrılan Çalışan");
    expect((await getFault(w.db, f.id))!.noticedByName).toBe("Ayrılan Çalışan");
    expect((await listStaff(w.db)).some((x) => x.id === s.id)).toBe(false);
    expect((await listStaff(w.db, { includeInactive: true })).some((x) => x.id === s.id)).toBe(true);
    expect(await staffRecordCounts(w.db, s.id)).toMatchObject({ responsibleDevices: 1, noticed: 1 });
  });
});

describe("13. Personel hesabı yönetici işlemlerini yapamaz (sunucu tarafı)", () => {
  it("tüm yönetici işlemleri ForbiddenError verir", async () => {
    const id = await newDevice();
    const f = await createFault(w.staff, { deviceId: id, description: "x" });
    const attempts: Promise<unknown>[] = [
      createUser(w.staff, { email: "x@y.z", displayName: "X", role: "admin" }, devLoginAdmin),
      updateUser(w.staff, w.admin.actor.userId, { version: 1, displayName: "X", role: "staff", active: false }, devLoginAdmin),
      createStaff(w.staff, { fullName: "X Y", jobRole: "diger" }),
      createLookup(w.staff, "locations", { name: "Gizli oda" }),
      deleteFault(w.staff, f.id, {}),
      purgeFault(w.staff, f.id),
      restoreFault(w.staff, f.id),
    ];
    for (const p of attempts) await expect(p).rejects.toBeInstanceOf(ForbiddenError);
    const d = (await getDevice(w.db, w.admin.today, id))!;
    await expect(updateDevice(w.staff, id, { ...d, lifecycle: "envanterden_cikarildi" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateDevice(w.staff, id, { ...d, inventoryCode: "XYZ-1" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("son aktif yönetici kendini düşüremez", async () => {
    const local = await world();
    const e = await expectError(updateUser(local.admin, local.admin.actor.userId, { version: 1, displayName: "Yönetici", role: "staff", active: true }, devLoginAdmin), 409);
    expect(e.code).toBe("last_admin");
    await local.db.close();
  });
});

describe("Eşzamanlı düzenleme", () => {
  it("eski sürümle kaydetmek sessizce ezmez", async () => {
    const id = await newDevice();
    const d = (await getDevice(w.db, w.admin.today, id))!;
    await updateDevice(w.staff, id, { ...d, notes: "Birinci kişi" });
    const e = await expectError(updateDevice(w.admin, id, { ...d, notes: "İkinci kişi" }), 409);
    expect(e.code).toBe("version_conflict");
    expect((await getDevice(w.db, w.admin.today, id))!.notes).toBe("Birinci kişi");

    const f = await createFault(w.staff, { deviceId: id, description: "x" });
    await updateFault(w.staff, f.id, { ...base(f), description: "A" });
    await expectError(updateFault(w.admin, f.id, { ...base(f), description: "B" }), 409);

    const loc = await createLookup(w.admin, "locations", { name: "Yeni oda" });
    await updateLookup(w.admin, "locations", loc.id, { ...loc, name: "Yeni oda 2" });
    await expectError(updateLookup(w.admin, "locations", loc.id, { ...loc, name: "Yeni oda 3" }), 409);
  });
});

describe("Konum / sorumlu değişiklik geçmişi", () => {
  it("eski ve yeni değer adlarıyla işlem geçmişine yazılır", async () => {
    const s1 = await createStaff(w.admin, { fullName: "Eski Sorumlu", jobRole: "asistan" });
    const s2 = await createStaff(w.admin, { fullName: "Yeni Sorumlu", jobRole: "asistan" });
    const { ids } = await createDevices(w.staff, { name: "Işık cihazı", typeId: w.type.ISK, locationId: w.loc["Ünit 1"], responsibleStaffId: s1.id });
    const d = (await getDevice(w.db, w.admin.today, ids[0]!))!;
    await updateDevice(w.staff, d.id, { ...d, locationId: w.loc["Ünit 3"], responsibleStaffId: s2.id });
    const rows = await w.db.query<{ summary: string; changes: Record<string, { from: unknown; to: unknown }> }>(
      `select summary, changes from audit_log where device_id = $1 and action = 'update'`, [d.id],
    );
    expect(rows[0]!.summary).toMatch(/konum, sorumlu/);
    expect(rows[0]!.changes.location).toMatchObject({ from: "Ünit 1", to: "Ünit 3" });
    expect(rows[0]!.changes.responsible).toMatchObject({ from: "Eski Sorumlu", to: "Yeni Sorumlu" });
  });
});

describe("Kısmi güncelleme", () => {
  it("gönderilmeyen alanlar korunur (yalnızca gönderilen alan değişir)", async () => {
    const s = await createStaff(w.admin, { fullName: "Kısmi Test", jobRole: "asistan" });
    const { ids } = await createDevices(w.staff, { name: "Kısmi cihaz", typeId: w.type.MKM, brand: "NSK", locationId: w.loc["Ünit 4"], responsibleStaffId: s.id });
    const d = (await getDevice(w.db, w.admin.today, ids[0]!))!;
    const d2 = await updateDevice(w.staff, d.id, { version: d.version, serialNumber: "X-1" });
    expect(d2).toMatchObject({ brand: "NSK", locationName: "Ünit 4", responsibleName: "Kısmi Test", serialNumber: "X-1" });
    const f = await createFault(w.staff, { deviceId: d.id, description: "x", noticedByStaffId: s.id, locationId: w.loc["Ünit 4"] });
    const f2 = await updateFault(w.staff, f.id, { version: f.version, status: "serviste", visit: {} });
    expect(f2).toMatchObject({ noticedByName: "Kısmi Test", locationName: "Ünit 4", description: "x" });
    const f3 = await updateFault(w.staff, f.id, { version: f2.version, noticedByStaffId: "" });
    expect(f3.noticedByStaffId).toBeNull();
  });
});

describe("Önceki gidişin düzeltilmesi", () => {
  it("ilk gidişe sonradan maliyet eklemek yeni gidiş saymaz", async () => {
    const id = await newDevice();
    let f = await createFault(w.staff, { deviceId: id, description: "x", noticedOn: "2026-09-01" });
    f = await updateFault(w.staff, f.id, { ...base(f), status: "tamirden_geldi", visit: { outcome: "sorun_devam" } });
    f = await updateFault(w.staff, f.id, { ...base(f), status: "serviste", resend: true, visit: {} });
    const first = f.visits[0]!;
    f = await updateVisit(w.staff, f.id, first.id, { version: f.version, visit: { costAmount: "300", costDate: "2026-09-10" } });
    expect(f.visits).toHaveLength(2);
    expect(f.visits[0]!.costAmount).toBe(300);
    expect(f.status).toBe("serviste");
  });
});

describe("Neden analizi", () => {
  it("belirlenmemiş ve doğrulanmış nedenler ayrılır", async () => {
    const local = await world();
    const mk = async () => (await createDevices(local.admin, { name: "c", typeId: local.type.AER })).ids[0]!;
    await createFault(local.staff, { deviceId: await mk(), description: "a" });
    await createFault(local.staff, { deviceId: await mk(), description: "b", causeId: local.cause["sterilizasyon sureci"] });
    await createFault(local.staff, { deviceId: await mk(), description: "c", causeId: local.cause["sterilizasyon sureci"], causeVerification: "servis_dogruladi" });
    await createFault(local.staff, { deviceId: await mk(), description: "d", causeId: local.cause["normal asinma"], causeVerification: "klinik_dogruladi", noticedOn: "2026-01-05" });
    const all = await causeStats(local.db, { from: null, to: null });
    expect(all.total).toBe(4);
    expect(all.undetermined).toBe(1);
    expect(all.verified).toBe(2);
    expect(all.rows[0]).toMatchObject({ causeName: "Sterilizasyon süreci", total: 2, preliminary: 1, verifiedByService: 1 });
    expect(all.rows.at(-1)!.undetermined).toBe(true);
    const oct = await causeStats(local.db, { from: "2026-10-01", to: "2026-10-31" });
    expect(oct.total).toBe(3);
    await local.db.close();
  });
});

describe("Cihaz listesi araması", () => {
  it("ad, kod, marka/model, seri no, kişi ve konuma göre Türkçe duyarsız arama", async () => {
    const local = await world();
    const s = await createStaff(local.admin, { fullName: "Şükrü Öztürk", jobRole: "dis_hekimi" });
    await createDevices(local.admin, { name: "Valo ışık cihazı", typeId: local.type.ISK, brand: "Ultradent", model: "Valo Grand", serialNumber: "VG-5521", locationId: local.loc["Tarama odası"], responsibleStaffId: s.id });
    await createDevices(local.admin, { name: "Elipar", typeId: local.type.ISK, brand: "3M", locationId: local.loc["Ünit 2"] });
    const find = async (q: string) => (await listDevices(local.db, local.admin.today, { q })).map((d) => d.name);
    expect(await find("ISIK")).toEqual(["Valo ışık cihazı", "Elipar"]); // tür adı "Işık cihazı"
    expect(await find("valo")).toEqual(["Valo ışık cihazı"]);
    expect(await find("isk-001")).toEqual(["Valo ışık cihazı"]);
    expect(await find("ultradent grand")).toEqual(["Valo ışık cihazı"]);
    expect(await find("vg-5521")).toEqual(["Valo ışık cihazı"]);
    expect(await find("sukru")).toEqual(["Valo ışık cihazı"]);
    expect(await find("tarama")).toEqual(["Valo ışık cihazı"]);
    expect(await find("ünit 2")).toEqual(["Elipar"]);
    await local.db.close();
  });
});
