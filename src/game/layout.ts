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
// "Gülüş tasarımı" oranları (altın oran / yinelenen estetik oran ilkesi; ideal bir gülüş fotoğrafındaki gibi):
//  • Merkezden dışa görünen genişlik 1 : 0.78 : 0.71 : 0.62 : 0.54 : 0.49. Yan kesici en dar kesicidir; her diş bir
//    öncekinin ≈ %80–90'ıdır. (Saf altın oran 1 : 0.618 : 0.382 …; 12 dişin hepsi oynanabilir kalsın diye yumuşatıldı.)
//  • Merkez kesicinin genişlik / görünen boy oranı ≈ 0.75 (ideal %75–80): dişler "uzun anahtar" değil, geniş ve oval-kare.
//  • Gülüş kavisi: kesici kenarlar uçlara doğru yukarı kıvrılır; yan kesici merkez kesiciden biraz kısadır, köpek dişi
//    merkezle aynı düzeydedir (diş eti zirveleri de buna göre: yan kesicinin zirvesi biraz aşağıda — dinamik diş eti hattı).
//  • Alt dişler üst dişlerden ≈ %75 genişlikte ve daha kısadır.
// Merkezden dışa sıra: kesici, yan kesici, köpek, küçük azı 1-2, azı. (Sol-sağ simetrik.)
interface ArchSpec {
  /** Görünen genişlik (dünya birimi). */
  w: number[];
  /** Diş eti zirvesinden kesici/çiğneme kenarına kadar boy. */
  h: number[];
  /** Kesici kenarın merkezdeki kesici kenara göre yukarı kayması (gülüş kavisi). */
  rise: number[];
}
const UPPER_ARCH: ArchSpec = { w: [34, 26.5, 24, 21, 18.5, 16.5], h: [50, 43, 49, 43, 39, 35], rise: [0, 1.5, 0.4, 3, 6, 10] };
const LOWER_ARCH: ArchSpec = { w: [25.5, 23, 23.5, 21, 18.5, 16.5], h: [38, 39, 43, 39, 35, 32], rise: [0, 0.8, 0.2, 2.6, 5.6, 9.4] };
export const TOOTH_GAP = 1.5;
export const TEETH_PER_ROW = 12;

/** Üst ve alt merkez kesicilerin kesici kenarı (y). Aralarındaki koyu şerit ağız boşluğudur. */
export const UPPER_EDGE = 268;
export const LOWER_EDGE = 288;
/** Ağız içi (diş eti bölgeleri dahil) sınırları. */
export const MOUTH = { x: 4, y: 172, w: 352, h: 222 };
export const MOUTH_IN = { x: 14, y: 184, w: 332, h: 198 };

/**
 * Çenedeki sıra numarasından diş türü: 0 kesici, 1 yan kesici, 2 köpek, 3-4 küçük azı, 5 azı
 * (sıra solun ucundan sağın ucuna; merkez dişler 0). Çizim diş şeklini buna göre seçer.
 */
export const toothRank = (i: number): number => (i < 6 ? 5 - i : i - 6);

function archRow(spec: ArchSpec, upper: boolean): Rect[] {
  const idx = Array.from({ length: TEETH_PER_ROW }, (_, i) => toothRank(i));
  const widths = idx.map((k) => spec.w[k]!);
  const total = widths.reduce((a, b) => a + b, 0) + (TEETH_PER_ROW - 1) * TOOTH_GAP;
  let x = (WORLD_W - total) / 2;
  return idx.map((k, i) => {
    const w = widths[i]!;
    const h = spec.h[k]!;
    const rise = spec.rise[k]!;
    // Üst dişler: kesici kenar altta, diş eti zirvesi üstte. Alt dişler: kesici kenar üstte, diş eti altta.
    const r: Rect = upper ? { x, y: UPPER_EDGE - rise - h, w, h } : { x, y: LOWER_EDGE - rise, w, h };
    x += w + TOOTH_GAP;
    return r;
  });
}

export const UPPER_TEETH: Rect[] = archRow(UPPER_ARCH, true);
export const LOWER_TEETH: Rect[] = archRow(LOWER_ARCH, false);

// ---- İç yüzey aşaması: ağız kocaman açık --------------------------------------------
// Yüz dönmez; çene aşağı iner (diş hekiminde "aaa de" gibi). Üst çene ve üst dudak yerinde kalır; alt dişler, dil ve alt dudak
// `JAW_DROP` kadar iner. Aradaki boşlukta damak, küçük dil, bademcikler ve dil görünür; dişlerin arka yüzeyleri fırçalanır.
/** Çene tam açıkken alt çenenin (alt dişler, alt dudak, dil) aşağı indiği mesafe (dünya birimi). */
export const JAW_DROP = 84;
/** Ağız tam açıkken dudak ve ağız içi sınırları: yalnızca alt kenar `JAW_DROP` kadar iner. */
export const MOUTH_OPEN = { ...MOUTH, h: MOUTH.h + JAW_DROP };
export const MOUTH_IN_OPEN = { ...MOUTH_IN, h: MOUTH_IN.h + JAW_DROP };
/** İç yüzey aşamasındaki dişler: üst sıra yerinde, alt sıra çene ile birlikte aşağıda. */
export const INNER_UPPER_TEETH: Rect[] = UPPER_TEETH;
export const INNER_LOWER_TEETH: Rect[] = LOWER_TEETH.map((t) => ({ ...t, y: t.y + JAW_DROP }));

// ---- Çiğneme yüzeyleri: 12 diş (her çenede 6), üstten görünüş -------------------
// Her çenenin iki sırası vardır (sol ve sağ taraf); her sırada öndeki küçük azı + iki azı bitişik dizilir (gerçek çene gibi).
export type CrownKind = "premolar" | "molar4" | "molar5";

/** Sıra merkezleri (y): üst çene 2, alt çene 2 sıra. */
const CHEW_ROW_Y = [117, 213, 339, 435];
/** Soldan sağa: küçük azı, birinci azı, ikinci azı. Yan yana, aralarında yalnızca temas payı. */
const CHEW_COLS = [
  { w: 92, h: 72 },
  { w: 120, h: 86 },
  { w: 104, h: 80 },
];
const CHEW_CONTACT = 3;
const CHEW_X0 = (WORLD_W - (CHEW_COLS.reduce((a, c) => a + c.w, 0) + CHEW_CONTACT * (CHEW_COLS.length - 1))) / 2;

export const CHEW_TILES: Rect[] = CHEW_ROW_Y.flatMap((cy) => {
  let x = CHEW_X0;
  return CHEW_COLS.map((c) => {
    const r: Rect = { x, y: cy - c.h / 2, w: c.w, h: c.h };
    x += c.w + CHEW_CONTACT;
    return r;
  });
});

/** Her çiğneme dişinin anatomisi: üst çenede iki dört tümsekli azı, alt çenede beş tümsekli birinci azı. */
export const CHEW_KINDS: CrownKind[] = [
  "premolar", "molar4", "molar4",
  "premolar", "molar4", "molar4",
  "premolar", "molar5", "molar4",
  "premolar", "molar5", "molar4",
];
/** Her çenenin diş eti levhası (üst ve alt çene ayrı). */
export const CHEW_SLABS: Rect[] = [
  { x: 6, y: 59, w: 348, h: 212 },
  { x: 6, y: 281, w: 348, h: 212 },
];

// ---- Dil ------------------------------------------------------------------------
export const TONGUE = { x: 50, y: 160, w: 260, h: 244 };

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
  return { kind: "inner", patches: [...rowPatches(INNER_UPPER_TEETH, INNER_UP, 60), ...rowPatches(INNER_LOWER_TEETH, INNER_LO, 90)] };
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
      const near = Math.min(a.h, b.h) * (k % 2 ? 0.62 : 0.34);
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
    [180, 212, 27, "coating"],
    [120, 244, 25, "coating"],
    [240, 246, 25, "germ"],
    [180, 278, 28, "coating"],
    [112, 310, 25, "germ"],
    [248, 312, 25, "coating"],
    [180, 342, 26, "coating"],
    [130, 358, 20, "coating"],
    [226, 358, 20, "germ"],
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
