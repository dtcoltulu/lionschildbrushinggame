import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addMonths, daysBetween, formatDate, isValidIsoDate, monthRange, todayIstanbul } from "@/lib/dates";
import { deviceAvailability, faultDisplay, isOverdue, serviceDuration } from "@/lib/domain";
import { formatTL, parseMoney } from "@/lib/money";
import { matchesQuery, normalizeKey } from "@/lib/normalize";
import { toCsv } from "@/server/services/export";
import { normalizeCode } from "@/server/services/devices";
import { normalizePrefix } from "@/server/services/lookups";

describe("Türkçe karşılaştırma anahtarı", () => {
  it("büyük/küçük harf, Türkçe karakter ve boşluk farkını yok sayar", () => {
    expect(normalizeKey("AYŞE  Yılmaz")).toBe("ayse yilmaz");
    expect(normalizeKey("ayse yilmaz")).toBe("ayse yilmaz");
    expect(normalizeKey("İsmail IŞIK")).toBe("ismail isik");
    expect(normalizeKey("Ünit 1")).toBe("unit 1");
    expect(normalizeKey("Yağlama / bakım eksikliği")).toBe("yaglama bakim eksikligi");
  });

  it("başlangıç verisindeki name_key değerleri uygulamanın kuralıyla aynı", () => {
    const sql = fs.readFileSync(path.resolve(import.meta.dirname, "../db/migrations/0002_reference_data.sql"), "utf8");
    const pairs = [...sql.matchAll(/\('([^']+)', '([^']+)'/g)];
    expect(pairs.length).toBeGreaterThan(30);
    for (const [, name, key] of pairs) expect(normalizeKey(name!), name).toBe(key);
  });

  it("arama her kelimeyi arar; envanter kodu tiresiz de bulunur", () => {
    expect(matchesQuery("AER-001 Aeratör W&H Synea", "aer001")).toBe(true);
    expect(matchesQuery("AER-001 Aeratör W&H Synea", "aerator synea")).toBe(true);
    expect(matchesQuery("AER-001 Aeratör", "anguldruva")).toBe(false);
  });

  it("kod ve önek normalleştirme", () => {
    expect(normalizeCode(" aer-001 ")).toBe("AER-001");
    expect(normalizeCode("ışk 2")).toBe("ISK-2");
    expect(normalizePrefix("ışk")).toBe("ISK");
  });
});

describe("Tutar", () => {
  it("Türkçe ve İngilizce yazımları doğru okur", () => {
    expect(parseMoney("1.250,50")).toBe(1250.5);
    expect(parseMoney("1250,5")).toBe(1250.5);
    expect(parseMoney("1250.50")).toBe(1250.5);
    expect(parseMoney("1.250")).toBe(1250);
    expect(parseMoney("12.500.000")).toBe(12_500_000);
    expect(parseMoney("1,250.75")).toBe(1250.75);
    expect(parseMoney("₺ 750 TL")).toBe(750);
  });
  it("boş = bilinmiyor (null), 0 = ücretsiz, geçersiz reddedilir", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("  ")).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney("0")).toBe(0);
    expect(parseMoney("12abc")).toBe("invalid");
    expect(parseMoney("-5")).toBe("invalid");
    expect(parseMoney("1,2,3")).toBe("invalid");
    expect(parseMoney("1.23,4.5")).toBe("invalid");
  });
  it("TL biçimi", () => {
    expect(formatTL(1250.5)).toMatch(/1\.250,50/);
    expect(formatTL(null)).toBe("—");
  });
});

describe("Tarih", () => {
  it("bugün İstanbul saatine göredir", () => {
    expect(todayIstanbul(new Date("2026-10-17T21:30:00Z"))).toBe("2026-10-18");
    expect(todayIstanbul(new Date("2026-10-17T20:59:00Z"))).toBe("2026-10-17");
  });
  it("geçerlilik ve aralıklar", () => {
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(daysBetween("2026-10-01", "2026-10-17")).toBe(16);
    expect(addMonths("2026-01", -2)).toBe("2025-11");
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(formatDate("2026-10-17")).toBe("17.10.2026");
  });
});

describe("Durum kuralları", () => {
  const today = "2026-10-17";
  it("tamirden geldi tek başına kullanılabilir demek değildir", () => {
    expect(deviceAvailability("aktif", { id: "x", status: "tamirden_geldi", expectedReturnOn: null, outcome: "sorun_devam" }, today)).toBe("sorun_devam");
    expect(deviceAvailability("aktif", { id: "x", status: "tamirden_geldi", expectedReturnOn: null, outcome: "denenmedi" }, today)).toBe("denenmedi");
    expect(deviceAvailability("aktif", null, today)).toBe("kullanilabilir");
    expect(deviceAvailability("kullanim_disi", null, today)).toBe("kullanim_disi");
  });
  it("gecikme yalnızca gösterilir", () => {
    expect(isOverdue("2026-10-16", today)).toBe(true);
    expect(isOverdue("2026-10-17", today)).toBe(false);
    expect(isOverdue(null, today)).toBe(false);
    expect(faultDisplay("serviste", { outcome: null, expectedReturnOn: "2026-10-10" }, today).label).toBe("Serviste – gecikti (7 gün)");
  });
  it("servis süresi eksik tarihte uydurulmaz", () => {
    expect(serviceDuration({ sentOn: null, returned: true, returnedOn: "2026-10-10" }, today).days).toBeNull();
    expect(serviceDuration({ sentOn: "2026-10-01", returned: true, returnedOn: null }, today)).toEqual({ days: null, note: "Süre hesaplanamadı: gerçek dönüş tarihi girilmemiş" });
    expect(serviceDuration({ sentOn: "2026-10-01", returned: true, returnedOn: "2026-10-11" }, today).days).toBe(10);
  });
});

describe("CSV", () => {
  it("BOM, noktalı virgül, Excel formül enjeksiyonu koruması", () => {
    const csv = toCsv([["a;b", "=HYPERLINK(1)", 1250.5, null]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"a;b";\'=HYPERLINK(1);1250,5;');
  });
});

describe("Ortam güvenliği", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("üretimde (Vercel production) geliştirici girişi ve yerel veritabanı açılamaz", async () => {
    const { authMode, dbConfig } = await import("@/server/env");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("ALLOW_DEV_AUTH", "1");
    vi.stubEnv("ALLOW_LOCAL_DB", "1");
    vi.stubEnv("DATABASE_URL", "");
    expect(() => authMode()).toThrow(/üretim/);
    expect(() => dbConfig()).toThrow(/DATABASE_URL/);
  });
  it("üretim derlemesinde varsayılan giriş Supabase'dir", async () => {
    const { authMode } = await import("@/server/env");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "");
    vi.stubEnv("VERCEL_ENV", "");
    expect(authMode()).toBe("supabase");
    vi.stubEnv("AUTH_MODE", "parolasiz");
    expect(() => authMode()).toThrow(/AUTH_MODE geçersiz/);
  });
});
