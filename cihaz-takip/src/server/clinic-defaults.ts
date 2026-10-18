import type { Queryable } from "./db";

/**
 * Yeni açılan kliniğin başlangıç listeleri (ilk klinik için 0002 geçişindeki listelerin aynısı; testte
 * karşılaştırılır). Klinik bunları kendi Ayarlar → Listeler bölümünden değiştirir. Cihaz, personel veya
 * arıza İÇERMEZ.
 */
export const DEFAULT_LOCATIONS: [name: string, key: string, order: number][] = [
  ["Ünit 1", "unit 1", 10],
  ["Ünit 2", "unit 2", 20],
  ["Ünit 3", "unit 3", 30],
  ["Ünit 4", "unit 4", 40],
  ["Ünit 5", "unit 5", 50],
  ["Sterilizasyon", "sterilizasyon", 60],
  ["Teknik oda", "teknik oda", 70],
  ["Banko", "banko", 80],
  ["Tarama odası", "tarama odasi", 90],
  ["Ortak kullanım", "ortak kullanim", 100],
  ["Depo", "depo", 110],
];

export const DEFAULT_DEVICE_TYPES: [name: string, key: string, prefix: string, digits: number, frequent: boolean, order: number][] = [
  ["Aeratör", "aerator", "AER", 3, true, 10],
  ["Fizyo başlığı", "fizyo basligi", "FZY", 3, true, 20],
  ["Anguldruva", "anguldruva", "ANG", 3, true, 30],
  ["Mikromotor", "mikromotor", "MKM", 3, true, 40],
  ["Piyasemen", "piyasemen", "PYS", 3, true, 50],
  ["Otoklav", "otoklav", "OTK", 3, false, 60],
  ["Distile su cihazı", "distile su cihazi", "DST", 3, false, 70],
  ["Cerrahi aspiratör motoru", "cerrahi aspirator motoru", "ASP", 3, false, 80],
  ["Kompresör", "kompresor", "KMP", 3, false, 90],
  ["Ağız içi tarayıcı", "agiz ici tarayici", "TRY", 3, false, 100],
  ["Beyazlatma cihazı", "beyazlatma cihazi", "BYZ", 3, false, 110],
  ["Işık cihazı", "isik cihazi", "ISK", 3, false, 120],
  ["Endomotor", "endomotor", "END", 3, false, 130],
  ["Dental ünit", "dental unit", "UNT", 2, false, 140],
  ["Bilgisayar / laptop", "bilgisayar laptop", "LPT", 3, false, 150],
  ["Diğer", "diger", "DGR", 3, false, 900],
];

export const DEFAULT_FAULT_CAUSES: [name: string, key: string, systemKey: string | null, order: number][] = [
  ["Belirlenmedi", "belirlenmedi", "belirlenmedi", 0],
  ["Normal aşınma", "normal asinma", null, 10],
  ["Yağlama / bakım eksikliği", "yaglama bakim eksikligi", null, 20],
  ["Sterilizasyon süreci", "sterilizasyon sureci", null, 30],
  ["Düşme / darbe", "dusme darbe", null, 40],
  ["Elektrik / voltaj", "elektrik voltaj", null, 50],
  ["Su / hava hattı", "su hava hatti", null, 60],
  ["Üretim / parça hatası", "uretim parca hatasi", null, 70],
  ["Kullanım hatası", "kullanim hatasi", null, 80],
  ["Diğer", "diger", "diger", 900],
];

/** `q` yeni kliniğin kapsamındaki işlemdir (forClinic): satırlar o kliniğe yazılır. */
export async function seedClinicDefaults(q: Queryable): Promise<void> {
  for (const [name, key, order] of DEFAULT_LOCATIONS) {
    await q.query(`insert into locations (name, name_key, sort_order) values ($1, $2, $3)`, [name, key, order]);
  }
  for (const [name, key, prefix, digits, frequent, order] of DEFAULT_DEVICE_TYPES) {
    await q.query(
      `insert into device_types (name, name_key, code_prefix, code_digits, frequent, sort_order) values ($1, $2, $3, $4, $5, $6)`,
      [name, key, prefix, digits, frequent, order],
    );
  }
  for (const [name, key, systemKey, order] of DEFAULT_FAULT_CAUSES) {
    await q.query(`insert into fault_causes (name, name_key, system_key, sort_order) values ($1, $2, $3, $4)`, [name, key, systemKey, order]);
  }
}
