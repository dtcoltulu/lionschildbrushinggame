import { describe, expect, it } from "vitest";
import { buildPhases, LOWER_TEETH, MOUTH_IN, TOOTH_GAP, toothRank, UPPER_TEETH, UPPER_EDGE, LOWER_EDGE } from "@/game/layout";

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
