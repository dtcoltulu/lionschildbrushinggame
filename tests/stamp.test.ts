import { describe, expect, it } from "vitest";
import { describeDuration, formatStamp } from "@/lib/stamp";

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

describe("ödül ekranı: kaç dakikada bitirdin", () => {
  it("60 sn altı hepsi 'bir dakikadan kısa' (saniye gösterilmez)", () => {
    for (const ms of [1, 20_000, 27_300, 45_000, 59_400]) {
      expect(describeDuration(ms)).toBe("Bir dakikadan kısa sürede bitirdin!");
    }
  });

  it("60 sn ve üstü en yakın dakikaya yuvarlanır", () => {
    expect(describeDuration(59_500)).toBe("Yaklaşık 1 dakikada bitirdin!");
    expect(describeDuration(60_000)).toBe("Yaklaşık 1 dakikada bitirdin!");
    expect(describeDuration(89_000)).toBe("Yaklaşık 1 dakikada bitirdin!");
    expect(describeDuration(90_000)).toBe("Yaklaşık 2 dakikada bitirdin!");
    expect(describeDuration(125_000)).toBe("Yaklaşık 2 dakikada bitirdin!");
    expect(describeDuration(185_000)).toBe("Yaklaşık 3 dakikada bitirdin!");
  });

  it("skor rekabeti olmasın: cümlede saniye ya da ayrıntılı sayı yok", () => {
    for (const ms of [40_000, 72_000, 118_000]) {
      expect(describeDuration(ms)).not.toMatch(/saniye|sn\b|\d{2}/);
    }
  });

  it("geçersiz ya da sıfır süre → null (satır gizlenir)", () => {
    for (const ms of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(describeDuration(ms)).toBeNull();
    }
  });
});
