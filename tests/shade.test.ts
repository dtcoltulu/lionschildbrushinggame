import { describe, expect, it } from "vitest";
import { carvePath, createField, forEachPixel, lightField, noise2, quantizeRes, raisePath, stampCarve, stampRaise, stampSoft, type Look } from "@/game/shade";
import { toothField, TUTORIAL_TOOTH_BOX, tutorialToothPixels } from "@/game/tutorialtooth";

const FLAT: Look = {
  light: [-0.42, -0.58, 0.7],
  ambient: 0.6,
  bump: 1,
  specStrength: 0,
  specPower: 20,
  ao: 0,
  aoRadius: 2,
  tint: [0.6, 0.5, 0.4],
  albedo: (_x, _y, _c, _s, out) => {
    out[0] = 200;
    out[1] = 180;
    out[2] = 160;
  },
};

function inside(f: ReturnType<typeof createField>) {
  forEachPixel(f, (_x, _y, i) => (f.sd[i] = 5));
}

describe("ışık motoru (yükseklik haritası)", () => {
  it("düz yüzey tek tip renk verir ve tam opaktır", () => {
    const f = createField(10, 10, 2);
    inside(f);
    const px = lightField(f, FLAT);
    for (let i = 0; i < px.length; i += 4) {
      expect(px[i + 3]).toBe(255);
      expect(px[i]).toBeCloseTo(px[0]!, 0);
    }
    expect(px[0]).toBeGreaterThan(150);
    expect(px[0]).toBeLessThanOrEqual(200);
  });

  it("ışığa (sol üst) bakan eğim, uzağa bakandan daha parlak", () => {
    const f = createField(20, 20, 2);
    inside(f);
    // x yönünde artan bir rampa: sağa yükselen yüzey sola bakar (ışığa dönük) → parlak
    forEachPixel(f, (x, _y, i) => (f.h[i] = x * 0.3));
    const up = lightField(f, FLAT)[(20 * 40 + 20) * 4]!; // ortada
    forEachPixel(f, (x, _y, i) => (f.h[i] = -x * 0.3));
    const down = lightField(f, FLAT)[(20 * 40 + 20) * 4]!;
    expect(up).toBeGreaterThan(down);
  });

  it("alfa: iç opak, dış saydam, kenarda yumuşak geçiş", () => {
    const f = createField(10, 10, 4);
    f.sd.fill(5);
    f.sd[0] = -5;
    f.sd[1] = 0.1; // kenara çok yakın iç piksel: kısmen saydam
    const px = lightField(f, FLAT);
    expect(px[3]).toBe(0);
    expect(px[7]).toBeGreaterThan(0);
    expect(px[7]).toBeLessThan(255);
    expect(px[11]).toBe(255);
  });

  it("damgalar: oyuk en derin merkezde ve simetrik; kabartma toplanır; yumuşak disk merkezde 1, dışta 0", () => {
    // Piksel merkezleri (i + 0.5) / res: 10.25 bir piksel merkezidir (res 2, i = 20)
    const f = createField(20, 20, 2);
    stampCarve(f, 10.25, 10.25, 1.5, 3);
    const at = (x: number, y: number) => f.carve[Math.floor(y * 2) * f.W + Math.floor(x * 2)]!;
    expect(at(10.25, 10.25)).toBeGreaterThan(2.8);
    expect(at(10.25, 10.25)).toBeGreaterThan(at(12.25, 10.25));
    expect(at(12.25, 10.25)).toBeCloseTo(at(8.25, 10.25), 3);
    expect(at(19.25, 19.25)).toBe(0);

    const g = createField(20, 20, 2);
    stampRaise(g, 10.25, 10.25, 1.2, 1);
    stampRaise(g, 10.25, 10.25, 1.2, 1);
    expect(g.h[Math.floor(10.25 * 2) * g.W + Math.floor(10.25 * 2)]).toBeGreaterThan(1.8);

    const s = createField(20, 20, 2);
    stampSoft(s, 10.25, 10.25, 5, 1);
    expect(s.carve[Math.floor(10.25 * 2) * s.W + Math.floor(10.25 * 2)]).toBeCloseTo(1, 3);
    expect(s.carve[Math.floor(16.25 * 2) * s.W + Math.floor(10.25 * 2)]).toBe(0);
  });

  it("yol boyunca oluk/kabartma: uçlarda incelir, ortada en belirgin", () => {
    const f = createField(60, 20, 2);
    carvePath(f, [[5, 10], [30, 10], [55, 10]], 1.2, 2, 0.3);
    const depth = (x: number) => f.carve[Math.round(10 * 2 - 0.5) * f.W + Math.round(x * 2 - 0.5)]!;
    expect(depth(30)).toBeGreaterThan(depth(7));
    expect(depth(30)).toBeGreaterThan(1.7);
    const r = createField(60, 20, 2);
    raisePath(r, [[5, 10], [55, 10]], 1.2, 1.5, 0.3);
    const mid = r.h[Math.round(10 * 2 - 0.5) * r.W + Math.round(30 * 2 - 0.5)]!;
    expect(mid).toBeGreaterThan(1.1);
    expect(mid).toBeLessThan(2);
  });

  it("gürültü 0..1, sürekli ve deterministik; çözünürlük çeyrek adımlara oturur", () => {
    for (let i = 0; i < 200; i++) {
      const v = noise2(i * 0.37, i * 0.11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(noise2(i * 0.37, i * 0.11)).toBe(v);
    }
    expect(Math.abs(noise2(3.2, 4.1) - noise2(3.21, 4.1))).toBeLessThan(0.1);
    expect(quantizeRes(0.5)).toBe(1.5);
    expect(quantizeRes(2.17)).toBe(2);
    expect(quantizeRes(2.4)).toBe(2.5);
    expect(quantizeRes(9)).toBe(3);
    expect(quantizeRes(-1)).toBe(2);
  });
});

describe("öğretici dişi (kökleri olan gerçekçi diş)", () => {
  const res = 1.5;
  const at = (f: { W: number; h: Float32Array }, wx: number, wy: number) => f.h[Math.floor((wy - TUTORIAL_TOOTH_BOX.y) * res) * f.W + Math.floor((wx - TUTORIAL_TOOTH_BOX.x) * res)]!;

  it("taç ortası yüksek, kenara doğru alçalır; kökler taçtan alçak; dişin dışı düz (0)", () => {
    const f = toothField(res);
    const crownCenter = at(f, 180, 250);
    const crownNearEdge = at(f, 180 - 92 * 0.92 + 2, 250);
    const root = at(f, 180 - 52 * 0.92, 300 + 90 * 0.92);
    const outside = at(f, 180, 300 + 100 * 0.92); // iki kökün arası (diş dışı)
    expect(crownCenter).toBeGreaterThan(crownNearEdge + 5);
    expect(crownCenter).toBeGreaterThan(root + 4);
    expect(outside).toBe(0);
  });

  it("piksel dizisi sprite boyutuyla uyumlu ve parlak (fildişi/beyaz)", () => {
    const { pixels, W, H } = tutorialToothPixels(res);
    expect(pixels.length).toBe(W * H * 4);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]! < 255) continue;
      sum += 0.3 * pixels[i]! + 0.59 * pixels[i + 1]! + 0.11 * pixels[i + 2]!;
      n++;
    }
    expect(n).toBeGreaterThan(1000);
    expect(sum / n).toBeGreaterThan(170);
  });
});
