import { describe, expect, it } from "vitest";
import { formatStamp } from "@/lib/stamp";

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
