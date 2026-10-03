import { describe, expect, it } from "vitest";
import { brushVerdict, formatDuration, formatStamp, IDEAL_BRUSH_MS } from "@/lib/stamp";

describe("ödül ekranı tarih-saat şeridi", () => {
  it("kampanya saat diliminde tarih ve saat verir (saniye YOK)", () => {
    // 11:32:09 UTC = 14:32:09 İstanbul (UTC+3)
    const s = formatStamp(new Date("2026-10-11T11:32:09Z"), "Europe/Istanbul");
    expect(s).toBe("11 Ekim · 14:32");
    expect(s).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("saniye değişince yazı değişmez; dakika değişince değişir (sayaç gibi akmaz)", () => {
    const tz = "Europe/Istanbul";
    const a = formatStamp(new Date("2026-10-11T11:32:01Z"), tz);
    const b = formatStamp(new Date("2026-10-11T11:32:59Z"), tz);
    const c = formatStamp(new Date("2026-10-11T11:33:00Z"), tz);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it("gece yarısını geçince Türkiye gününe göre tarihi değiştirir", () => {
    // 21:05 UTC = 00:05 ertesi gün İstanbul
    expect(formatStamp(new Date("2026-10-11T21:05:00Z"), "Europe/Istanbul")).toBe("12 Ekim · 00:05");
  });

  it("geçersiz saat diliminde çökmez, cihaz saatine düşer", () => {
    const s = formatStamp(new Date("2026-10-11T11:32:09Z"), "Mars/Olympus");
    expect(s).toMatch(/^\d{1,2} \p{L}+ · \d{2}:\d{2}$/u);
  });
});

describe("ödül ekranı: oyun süresi", () => {
  it("süreyi dk/sn olarak yazar", () => {
    expect(formatDuration(45_000)).toBe("45 sn");
    expect(formatDuration(72_000)).toBe("1 dk 12 sn");
    expect(formatDuration(120_000)).toBe("2 dk");
    expect(formatDuration(125_400)).toBe("2 dk 5 sn");
    expect(formatDuration(200)).toBe("1 sn");
  });

  it("geçersiz ya da sıfır süre → null (satır gizlenir)", () => {
    for (const ms of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatDuration(ms)).toBeNull();
      expect(brushVerdict(ms)).toBeNull();
    }
  });
});

describe("ödül ekranı: 2 dakika geri bildirimi", () => {
  it("2 dakikadan kısa → quick (mikroplar kalmış olabilir uyarısı)", () => {
    expect(IDEAL_BRUSH_MS).toBe(120_000);
    for (const ms of [1, 27_000, 56_000, 90_000, 119_999]) expect(brushVerdict(ms)).toBe("quick");
  });

  it("2 dakika ve üzeri → ideal (tebrik)", () => {
    for (const ms of [120_000, 125_000, 300_000]) expect(brushVerdict(ms)).toBe("ideal");
  });
});
