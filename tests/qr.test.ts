import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { buildQr, logoBox, qrToRaster, qrToSvg, MAX_LOGO_RATIO } from "@/lib/qr";

const URLS = [
  "https://dis.lions118y.org/oyun",
  "https://lions118y.org/oyun",
  "https://dis-sagligi-oyunu.vercel.app/oyun?k=lions-118y-2026-10-11",
];

describe("QR üretimi", () => {
  for (const url of URLS) {
    it(`logo olmadan geri okunur: ${url}`, () => {
      const m = buildQr(url);
      const img = qrToRaster(m, 8, false);
      expect(jsQR(img.data, img.width, img.height)?.data).toBe(url);
    });
    it(`ortada logo bloğu varken de geri okunur (H düzeyi): ${url}`, () => {
      const m = buildQr(url);
      const img = qrToRaster(m, 8, true);
      expect(jsQR(img.data, img.width, img.height)?.data).toBe(url);
    });
  }

  it("küçük baskı boyutunda (modül başına 3px) okunur", () => {
    const url = URLS[0]!;
    const img = qrToRaster(buildQr(url), 3, true);
    expect(jsQR(img.data, img.width, img.height)?.data).toBe(url);
  });

  it("logo alanı sembolün %22'sini ve alanın %6'sını aşmaz", () => {
    for (const url of URLS) {
      const m = buildQr(url);
      const b = logoBox(m.size);
      expect(b.modules / m.size).toBeLessThanOrEqual(MAX_LOGO_RATIO + 0.01);
      const side = b.modules + 2 * b.pad;
      expect((side * side) / (m.size * m.size)).toBeLessThan(0.09);
      expect(b.modules % 2).toBe(1);
      expect(Number.isInteger(b.start)).toBe(true);
    }
  });

  it("SVG geçerli görünür ve logo yalnızca istenince eklenir", () => {
    const m = buildQr(URLS[0]!);
    const plain = qrToSvg(m);
    expect(plain.startsWith("<svg")).toBe(true);
    expect(plain).not.toContain("<image");
    const withLogo = qrToSvg(m, { logoDataUrl: "data:image/svg+xml;base64,AAAA" });
    expect(withLogo).toContain("<image");
  });

  it("kısa adres küçük bir QR üretir (okunaklı, büyük modüller)", () => {
    expect(buildQr("https://lions118y.org/oyun").size).toBeLessThanOrEqual(33);
  });
});
