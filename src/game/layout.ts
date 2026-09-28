import { WORLD_W } from "./constants";
import type { DebrisKind, Patch, PhaseSpec } from "./types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Deterministik sahte rastgele (tohumlu) – her oyunda aynı yerleşim. */
export function rand(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---- Ön / iç görünüş: üst çene 12 + alt çene 12 = 24 diş ------------------------
// Merkezden dışa: kesici, yan kesici, köpek, küçük azı 1-2, azı. (Sol-sağ simetrik.)
const HALF_W = [28, 25, 26, 22, 21, 20];
const HALF_H_UP = [72, 68, 72, 64, 60, 56];
const HALF_H_LO = [64, 62, 66, 60, 56, 52];
export const TOOTH_GAP = 3;
export const TEETH_PER_ROW = 12;

/** Üst dişlerin üst çizgisi ve alt dişlerin alt çizgisi (merkezde). */
export const UPPER_LINE = 204;
export const LOWER_LINE = 356;
/** Ağız içi (diş eti bölgeleri dahil) sınırları. */
export const MOUTH = { x: 4, y: 150, w: 352, h: 264 };
export const MOUTH_IN = { x: 14, y: 162, w: 332, h: 240 };

function archRow(halfH: number[], line: number, upper: boolean): Rect[] {
  const idx = Array.from({ length: TEETH_PER_ROW }, (_, i) => (i < 6 ? 5 - i : i - 6));
  const widths = idx.map((k) => HALF_W[k]!);
  const total = widths.reduce((a, b) => a + b, 0) + (TEETH_PER_ROW - 1) * TOOTH_GAP;
  let x = (WORLD_W - total) / 2;
  return idx.map((k, i) => {
    const t = Math.abs(i - 5.5) / 5.5;
    const lift = t * t * 10; // uçlar biraz yukarıda: gülümseme eğrisi
    const w = widths[i]!;
    const h = halfH[k]!;
    const r: Rect = upper ? { x, y: line - lift, w, h } : { x, y: line - lift - h, w, h };
    x += w + TOOTH_GAP;
    return r;
  });
}

export const UPPER_TEETH: Rect[] = archRow(HALF_H_UP, UPPER_LINE, true);
export const LOWER_TEETH: Rect[] = archRow(HALF_H_LO, LOWER_LINE, false);

// ---- Çiğneme yüzeyleri: 12 diş (her çenede 6), üstten görünüş -------------------
export const CHEW_TILES: Rect[] = [0, 1, 2, 3].flatMap((r) =>
  [0, 1, 2].map((c) => ({ x: 24 + c * 110, y: 74 + r * 96 + (r >= 2 ? 22 : 0), w: 100, h: 86 })),
);
export const CHEW_PANEL = { x: 6, y: 58, w: 348, h: 408 };
export const CHEW_DIVIDER_Y = 74 + 2 * 96 + 11 - 6;

// ---- Dil ------------------------------------------------------------------------
export const TONGUE = { x: 50, y: 150, w: 260, h: 268 };

// ---- Yama (artık) yerleşimi -----------------------------------------------------
function patchIn(rect: Rect, i: number, r: number, kind: DebrisKind, dx = 0, dy = 0): Patch {
  const jx = (rand(i * 3.1) - 0.5) * (rect.w * 0.2);
  const jy = (rand(i * 5.7) - 0.5) * (rect.h * 0.3);
  return {
    x: rect.x + rect.w / 2 + jx + dx,
    y: rect.y + rect.h / 2 + jy + dy,
    r,
    kind,
    seed: rand(i * 9.3),
  };
}

const toothR = (t: Rect) => Math.min(15, t.w * 0.58);

// 12'şerli artık dizileri: çikolata, cips, plak ve mikrop karışık.
const OUTER_UP: DebrisKind[] = ["chocolate", "plaque", "germ", "chips", "plaque", "chocolate", "chips", "germ", "plaque", "chocolate", "chips", "plaque"];
const OUTER_LO: DebrisKind[] = ["plaque", "chips", "chocolate", "germ", "plaque", "chips", "chocolate", "plaque", "germ", "chips", "plaque", "chocolate"];
const INNER_UP: DebrisKind[] = ["plaque", "germ", "chocolate", "plaque", "chips", "germ", "plaque", "chocolate", "germ", "plaque", "chips", "plaque"];
const INNER_LO: DebrisKind[] = ["chips", "plaque", "germ", "chocolate", "plaque", "germ", "chips", "plaque", "chocolate", "germ", "plaque", "chips"];

function rowPatches(teeth: Rect[], kinds: DebrisKind[], base: number): Patch[] {
  return teeth.map((t, i) => patchIn(t, base + i, toothR(t), kinds[i]!));
}

function outer(): PhaseSpec {
  return { kind: "outer", patches: [...rowPatches(UPPER_TEETH, OUTER_UP, 1), ...rowPatches(LOWER_TEETH, OUTER_LO, 30)] };
}

function inner(): PhaseSpec {
  return { kind: "inner", patches: [...rowPatches(UPPER_TEETH, INNER_UP, 60), ...rowPatches(LOWER_TEETH, INNER_LO, 90)] };
}

/** Diş araları (ve diş eti kenarı): her iki komşu dişin arasındaki boşlukta artık. */
function gapPatches(kindSeed: number, small: boolean): Patch[] {
  const out: Patch[] = [];
  const rows: [Rect[], boolean][] = [
    [UPPER_TEETH, true],
    [LOWER_TEETH, false],
  ];
  for (const [teeth, upper] of rows) {
    for (let k = 0; k < teeth.length - 1; k++) {
      const a = teeth[k]!;
      const b = teeth[k + 1]!;
      const x = a.x + a.w + TOOTH_GAP / 2;
      // Diş eti çizgisine yakın (üstte üst, altta alt) ve dişin ortasına doğru dönüşümlü
      const near = 16 + (k % 2) * 16;
      const y = upper ? Math.min(a.y, b.y) + near : Math.max(a.y + a.h, b.y + b.h) - near;
      const kind: DebrisKind = (k + kindSeed) % 3 === 0 ? "germ" : (k + kindSeed) % 3 === 1 ? "plaque" : "chips";
      out.push({
        x,
        y,
        r: small ? 10 : 11,
        kind: small && kind === "germ" ? "plaque" : kind,
        seed: rand((kindSeed + k) * 4.7 + (upper ? 1 : 2)),
      });
    }
  }
  return out;
}

function gaps(): PhaseSpec {
  return { kind: "gaps", patches: gapPatches(1, false) };
}

function chewing(): PhaseSpec {
  const kinds: DebrisKind[] = ["chips", "chocolate", "plaque", "germ", "chips", "chocolate", "plaque", "chips", "germ", "chocolate", "chips", "plaque"];
  return {
    kind: "chewing",
    patches: CHEW_TILES.map((t, i) => patchIn(t, 120 + i, 22, kinds[i]!, (i % 2 ? 8 : -8), 0)),
  };
}

function tongue(): PhaseSpec {
  const spots: [number, number, number, DebrisKind][] = [
    [180, 200, 30, "coating"],
    [118, 246, 28, "coating"],
    [244, 250, 28, "germ"],
    [180, 288, 32, "coating"],
    [112, 330, 28, "germ"],
    [248, 334, 28, "coating"],
    [180, 372, 30, "coating"],
    [136, 396, 24, "coating"],
    [226, 398, 24, "germ"],
  ];
  return {
    kind: "tongue",
    patches: spots.map(([x, y, r, kind], i) => ({ x, y, r, kind, seed: rand(200 + i * 1.7) })),
  };
}

/** Diş ipi: aralara son bir temizlik. Daha az swipe: son adım akıcı bitsin. */
function floss(): PhaseSpec {
  return { kind: "floss", patches: gapPatches(2, true), swipes: 2 };
}

/** Oyun sırası: dış yüzey → diş araları → iç yüzey → çiğneme → dil → diş ipi. */
export function buildPhases(): PhaseSpec[] {
  return [outer(), gaps(), inner(), chewing(), tongue(), floss()];
}

export function buildTutorialPhase(): PhaseSpec {
  return { kind: "tutorial", patches: [{ x: 180, y: 268, r: 50, kind: "germ", seed: 0.42 }] };
}
