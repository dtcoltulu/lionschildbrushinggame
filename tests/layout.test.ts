import { describe, expect, it } from "vitest";
import { WORLD_H, WORLD_W } from "@/game/constants";
import {
  buildPhases,
  INNER_LOWER_TEETH,
  INNER_UPPER_TEETH,
  JAW_DROP,
  LOWER_TEETH,
  MOUTH,
  MOUTH_IN,
  MOUTH_IN_OPEN,
  MOUTH_OPEN,
  TOOTH_GAP,
  toothRank,
  UPPER_TEETH,
  UPPER_EDGE,
  LOWER_EDGE,
} from "@/game/layout";

/** Ön dişlerin "gülüş tasarımı" oranları (altın oran / yinelenen estetik oran ilkesi). */
describe("ön dişler: gülüş tasarımı oranları", () => {
  const centerL = UPPER_TEETH[5]!;

  it("merkez kesici geniş: genişlik / görünen boy ≈ 0.75 (ideal %75–80); dişler uzun anahtar gibi değil", () => {
    const visible = centerL.h - 4; // diş eti zirvesi dişin ilk ≈ 4 biriminin üstüne biner
    const ratio = centerL.w / visible;
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(0.82);
  });

  it("merkezden dışa genişlik azalır: yan kesici merkezin ≈ %78'i, köpek yan kesiciye yakın, sonra küçük azılar ve azı", () => {
    const w = (k: number) => UPPER_TEETH[5 - k]!.w;
    expect(w(1) / w(0)).toBeGreaterThan(0.7);
    expect(w(1) / w(0)).toBeLessThan(0.85); // yan kesici merkezin %70–85'i (saf altın oran 0.618'in yumuşatılmışı)
    expect(w(2)).toBeLessThanOrEqual(w(1) * 1.02); // köpek yan kesiciden geniş değil
    expect(w(3)).toBeLessThan(w(2));
    expect(w(4)).toBeLessThan(w(3));
    expect(w(5)).toBeLessThan(w(4));
    // her diş bir öncekinin yaklaşık %80–100'ü (yan kesici hariç, o daha dar)
    for (const k of [2, 3, 4, 5]) expect(w(k) / w(k - 1)).toBeGreaterThan(0.8 - 0.01);
  });

  it("sol ve sağ yarı birebir simetrik; alt dişler üst dişlerden daha dar ve kısa (merkezde)", () => {
    for (const row of [UPPER_TEETH, LOWER_TEETH]) {
      for (let i = 0; i < 6; i++) {
        expect(row[i]!.w).toBeCloseTo(row[11 - i]!.w, 6);
        expect(row[i]!.h).toBeCloseTo(row[11 - i]!.h, 6);
        expect(row[i]!.y).toBeCloseTo(row[11 - i]!.y, 6);
      }
    }
    expect(LOWER_TEETH[5]!.w).toBeLessThan(UPPER_TEETH[5]!.w * 0.85);
    expect(LOWER_TEETH[5]!.h).toBeLessThan(UPPER_TEETH[5]!.h);
  });

  it("gülüş kavisi: dıştaki dişlerin kesici kenarı merkezdekinden yukarıda; köpek merkezle aynı düzeyde; yan kesici biraz kısa", () => {
    const edgeUp = (t: { y: number; h: number }) => t.y + t.h; // üst dişte kesici kenar altta
    expect(edgeUp(UPPER_TEETH[5]!)).toBeCloseTo(UPPER_EDGE, 6);
    expect(edgeUp(UPPER_TEETH[0]!)).toBeLessThan(UPPER_EDGE - 6); // en dış diş belirgin yukarıda
    expect(Math.abs(edgeUp(UPPER_TEETH[3]!) - UPPER_EDGE)).toBeLessThan(1); // köpek ≈ merkez
    expect(edgeUp(UPPER_TEETH[4]!)).toBeLessThan(UPPER_EDGE); // yan kesici biraz yukarıda (kısa)
    const edgeLo = (t: { y: number }) => t.y; // alt dişte kesici kenar üstte
    expect(edgeLo(LOWER_TEETH[5]!)).toBeCloseTo(LOWER_EDGE, 6);
    expect(edgeLo(LOWER_TEETH[0]!)).toBeLessThan(LOWER_EDGE - 6);
  });

  it("dişler ağız içine sığar, komşular arası boşluk TOOTH_GAP, alt ve üst sıra çakışmaz", () => {
    for (const row of [UPPER_TEETH, LOWER_TEETH]) {
      expect(row[0]!.x).toBeGreaterThan(MOUTH_IN.x + 6);
      expect(row[11]!.x + row[11]!.w).toBeLessThan(MOUTH_IN.x + MOUTH_IN.w - 6);
      for (let i = 0; i < 11; i++) expect(row[i + 1]!.x - (row[i]!.x + row[i]!.w)).toBeCloseTo(TOOTH_GAP, 6);
      for (const t of row) {
        expect(t.y).toBeGreaterThan(MOUTH_IN.y + 14);
        expect(t.y + t.h).toBeLessThan(MOUTH_IN.y + MOUTH_IN.h - 14);
      }
    }
    for (let i = 0; i < 12; i++) {
      const up = UPPER_TEETH[i]!;
      const lo = LOWER_TEETH[i]!;
      expect(up.y + up.h).toBeLessThan(lo.y - 10); // aralarında ağız boşluğu (koyu şerit) var
    }
  });

  it("diş türü sırası ve oyun lekeleri: her dişte bir leke, tüm lekeler kendi dişinin içinde; diş araları lekeleri iki dişin arasında", () => {
    const phases = buildPhases();
    const outer = phases[0]!.patches;
    const teeth = [...UPPER_TEETH, ...LOWER_TEETH];
    expect(outer).toHaveLength(24);
    outer.forEach((p, i) => {
      const t = teeth[i]!;
      expect(p.x).toBeGreaterThan(t.x);
      expect(p.x).toBeLessThan(t.x + t.w);
      expect(p.y).toBeGreaterThan(t.y);
      expect(p.y).toBeLessThan(t.y + t.h);
    });
    const gaps = phases[1]!.patches;
    expect(gaps).toHaveLength(22);
    for (const p of gaps) {
      const row = p.y < (UPPER_EDGE + LOWER_EDGE) / 2 ? UPPER_TEETH : LOWER_TEETH;
      const between = row.some((t, k) => k < 11 && Math.abs(p.x - (t.x + t.w + TOOTH_GAP / 2)) < 0.01);
      expect(between).toBe(true);
    }
    expect(toothRank(5)).toBe(0);
    expect(toothRank(0)).toBe(5);
  });
});

/** İç yüzey aşaması: yüz dönmez, çene iner; üst sıra yerinde, alt sıra çene ile birlikte `JAW_DROP` kadar aşağıdadır. */
describe("iç yüzey aşaması: ağız kocaman açık", () => {
  it("açık ağız yalnızca alt kenardan büyür (üst dudak ve üst çene yerinde); dünyaya sığar", () => {
    expect(MOUTH_OPEN).toEqual({ ...MOUTH, h: MOUTH.h + JAW_DROP });
    expect(MOUTH_IN_OPEN).toEqual({ ...MOUTH_IN, h: MOUTH_IN.h + JAW_DROP });
    expect(MOUTH_OPEN.y).toBe(MOUTH.y);
    expect(MOUTH_OPEN.y + MOUTH_OPEN.h).toBeLessThan(WORLD_H - 20); // alt dudak ekranın altına taşmaz
    expect(JAW_DROP).toBeGreaterThan(40); // gerçekten "kocaman" açık
  });

  it("üst sıra dış yüzdekiyle aynı, alt sıra tam JAW_DROP aşağıda; boyut ve yatay yerleşim aynı (sprite'lar yeniden kullanılır)", () => {
    expect(INNER_UPPER_TEETH).toEqual(UPPER_TEETH);
    expect(INNER_LOWER_TEETH).toHaveLength(12);
    INNER_LOWER_TEETH.forEach((t, i) => {
      const o = LOWER_TEETH[i]!;
      expect(t.x).toBe(o.x);
      expect(t.w).toBe(o.w);
      expect(t.h).toBe(o.h);
      expect(t.y).toBeCloseTo(o.y + JAW_DROP, 9);
    });
  });

  it("açık ağızda dişler ağız içine sığar ve üst ile alt sıra arasında geniş boşluk var (damak, küçük dil, dil görünsün)", () => {
    for (const row of [INNER_UPPER_TEETH, INNER_LOWER_TEETH]) {
      expect(row[0]!.x).toBeGreaterThan(MOUTH_IN_OPEN.x + 6);
      expect(row[11]!.x + row[11]!.w).toBeLessThan(MOUTH_IN_OPEN.x + MOUTH_IN_OPEN.w - 6);
      for (const t of row) {
        expect(t.y).toBeGreaterThan(MOUTH_IN_OPEN.y + 14);
        expect(t.y + t.h).toBeLessThan(MOUTH_IN_OPEN.y + MOUTH_IN_OPEN.h - 14);
      }
    }
    for (let i = 0; i < 12; i++) {
      const gap = INNER_LOWER_TEETH[i]!.y - (INNER_UPPER_TEETH[i]!.y + INNER_UPPER_TEETH[i]!.h);
      expect(gap).toBeGreaterThan(JAW_DROP); // dış yüzdeki boşluğun (≈ 20) üstüne tam çene mesafesi eklenmiş
    }
  });

  it("iç yüzey lekeleri açık ağızdaki dişlerin üstünde: her dişte bir leke, kendi dişinin içinde, ekranın içinde", () => {
    const inner = buildPhases()[2]!;
    expect(inner.kind).toBe("inner");
    expect(inner.patches).toHaveLength(24);
    const teeth = [...INNER_UPPER_TEETH, ...INNER_LOWER_TEETH];
    inner.patches.forEach((p, i) => {
      const t = teeth[i]!;
      expect(p.x).toBeGreaterThan(t.x);
      expect(p.x).toBeLessThan(t.x + t.w);
      expect(p.y).toBeGreaterThan(t.y);
      expect(p.y).toBeLessThan(t.y + t.h);
      expect(p.x - p.r).toBeGreaterThan(0);
      expect(p.x + p.r).toBeLessThan(WORLD_W);
      expect(p.y + p.r).toBeLessThan(WORLD_H - 40); // parmak/fırça alt düğmelerin arkasında kalmaz
    });
    // alt sıra lekeleri dış yüzdekinden ortalama JAW_DROP kadar aşağıda (her aşamanın sapma tohumu farklı, ortalamada sapma sönümlenir)
    const outer = buildPhases()[0]!.patches;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const lowerShift = mean(inner.patches.slice(12).map((p) => p.y)) - mean(outer.slice(12).map((p) => p.y));
    expect(Math.abs(lowerShift - JAW_DROP)).toBeLessThan(6);
    // üst sıra yerinde kalır
    const upperShift = mean(inner.patches.slice(0, 12).map((p) => p.y)) - mean(outer.slice(0, 12).map((p) => p.y));
    expect(Math.abs(upperShift)).toBeLessThan(6);
  });
});
