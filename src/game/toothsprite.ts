import type { Ctx } from "./draw";
import { rand, toothRank, type Rect } from "./layout";
import { bakeToCanvas, carvePath, createField, forEachPixel, lightField, type Field, type Look } from "./shade";
import { HIDDEN, NECK_L, shoulderOf, toothPath } from "./teeth";

/**
 * Ön ve iç (dil tarafı) diş yüzeyleri: yükseklik haritasından ışık/gölge/parlama hesaplanan sprite'lar.
 * Yalnızca görünüm; vuruş alanları `layout.ts`teki dikdörtgenlerdir. Silüet `teeth.ts`teki diş yolundan gelir
 * ("destination-in" ile uygulanır, kenar yumuşatmasını tarayıcı yapar).
 *
 * Yerel koordinat: u = dişin genişliği boyunca (0..1), v = diş etinden (0) kesici/çiğneme kenarına (1);
 * v < 0 diş etinin altında kalan boyun. Üst dişlerde diş eti yukarıda, alt dişlerde aşağıdadır.
 */

export type ToothView = "front" | "inner";

const M = 3;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bell = (x: number, c: number, s: number) => {
  const d = (x - c) / s;
  return d * d > 9 ? 0 : Math.exp(-d * d);
};

interface Params {
  /** Yatay kabarıklık (dünya birimi). */
  bulge: number;
  /** Ortada dikey sırt (köpek, küçük azı). */
  ridge: number;
  /** Ön yüzde iki ince gelişim çukuru (mamelon çizgileri). */
  grooves: number;
  /** Kesici kenarda saydamlık (0..1). */
  trans: number;
}
const FRONT: Params[] = [
  { bulge: 5.4, ridge: 0, grooves: 0.3, trans: 0.95 }, // kesici
  { bulge: 5, ridge: 0, grooves: 0.25, trans: 0.85 }, // yan kesici
  { bulge: 5.6, ridge: 1.3, grooves: 0.28, trans: 0.6 }, // köpek
  { bulge: 5.2, ridge: 0.8, grooves: 0.15, trans: 0.25 }, // küçük azı
  { bulge: 5.2, ridge: 0.8, grooves: 0.15, trans: 0.25 },
  { bulge: 4.8, ridge: 0.35, grooves: 0.15, trans: 0 }, // azı
];

interface Geo {
  w: number;
  h: number;
  upper: boolean;
  rank: number;
  x0: number;
  y0: number;
}

/** Sprite uzayındaki (x,y) → dişin yerel (u, v). `uu` = silüetin o yükseklikteki genişliğine göre normalize konum. */
function localOf(g: Geo, x: number, y: number): { u: number; v: number; uu: number } {
  const u = (x - g.x0) / g.w;
  const vr = (y - g.y0) / g.h;
  const v = g.upper ? vr : 1 - vr;
  const s = shoulderOf(g.rank);
  const uL = NECK_L * (1 - smooth(0, 0.7 * s, Math.max(0, v)));
  const span = 1 - 2 * uL;
  return { u, v, uu: (u - uL) / span };
}

function spriteField(g: Geo, res: number): Field {
  const hid = HIDDEN * g.h;
  return createField(g.w + 2 * M, g.h + hid + 2 * M, res);
}

const cylinder = (uu: number) => {
  const t = 2 * uu - 1;
  return Math.sqrt(Math.max(0, 1 - t * t));
};

/** Ön (dudak/yanak) yüzeyi: silindirik kabarıklık, kesici kenarda yuvarlanma, ince gelişim çukurları, köpek/azıda sırt. */
function frontField(g: Geo, res: number): Field {
  const P = FRONT[g.rank]!;
  const F = spriteField(g, res);
  forEachPixel(F, (x, y, i) => {
    const { u, v, uu } = localOf(g, x, y);
    F.sd[i] = 5;
    const cyl = cylinder(uu);
    const vert = smooth(-0.22, 0.2, v) * (1 - 0.34 * smooth(0.6, 1, v)) * (1 - 0.6 * smooth(0.92, 1.02, v));
    let hh = P.bulge * Math.min(1.3, g.w / 26) * cyl * (1 + 0.2 * (1 - cyl)) * vert;
    if (P.ridge > 0) hh += P.ridge * bell(u, 0.5, 0.13) * smooth(0.08, 0.4, v) * (1 - smooth(0.82, 1, v));
    F.h[i] = hh;
  });
  if (P.grooves > 0 && g.rank < 5) {
    for (const gu of [0.34, 0.67]) {
      const yy = (v: number) => g.y0 + (g.upper ? v : 1 - v) * g.h;
      carvePath(F, [[g.x0 + gu * g.w, yy(0.34)], [g.x0 + gu * g.w + (gu < 0.5 ? -0.4 : 0.4), yy(0.62)], [g.x0 + gu * g.w, yy(0.9)]], 0.9, P.grooves, 0.3);
    }
  }
  for (let i = 0; i < F.h.length; i++) F.h[i] = F.h[i]! - F.carve[i]!;
  return F;
}

/** İç yüzey (dil/damak tarafı): marjinal sırtlar, orta çukur (fossa), boyunda singulum, köpekte orta sırt. */
function innerField(g: Geo, res: number): Field {
  const F = spriteField(g, res);
  const front = g.rank <= 2;
  const k = g.upper ? 1 : 0.55; // alt dişlerin iç yüzü daha düz
  forEachPixel(F, (x, y, i) => {
    const { v, uu } = localOf(g, x, y);
    F.sd[i] = 5;
    const cyl = cylinder(uu);
    const vert = smooth(-0.22, 0.18, v) * (1 - 0.3 * smooth(0.66, 1, v)) * (1 - 0.6 * smooth(0.92, 1.02, v));
    let hh = 3.4 * Math.min(1.3, g.w / 26) * cyl * (1 + 0.2 * (1 - cyl)) * vert;
    if (front) {
      // Kenar sırtları boyuna doğru içeri kıvrılıp singulumla birleşir ("V"); orta çukur gözyaşı biçimli
      const lean = 0.2 * (1 - smooth(0.05, 0.5, v));
      const ridges = bell(uu, 0.12 + lean, 0.1) + bell(uu, 0.88 - lean, 0.1);
      hh += (g.rank === 2 ? 0.9 : 1.3) * k * ridges * smooth(-0.05, 0.25, v) * (1 - smooth(0.9, 1.02, v));
      if (g.rank === 2) hh += 1.6 * k * bell(uu, 0.5, 0.12) * smooth(0.1, 0.4, v) * (1 - smooth(0.86, 1, v));
      else hh -= 1.9 * k * bell(uu, 0.5, 0.13 + 0.17 * smooth(0.2, 0.8, v)) * bell(v, 0.62, 0.24);
      hh += 2.2 * k * bell(uu, 0.5, 0.26) * bell(v, 0.12, 0.15); // singulum
      hh += 0.9 * bell(v, 0.96, 0.035) * cyl; // kesici kenarın ince sırtı
    } else {
      hh += 0.9 * bell(uu, 0.5, 0.16) * smooth(0.1, 0.5, v) * (1 - smooth(0.85, 1, v));
    }
    F.h[i] = hh;
  });
  if (!front && g.rank >= 3) {
    const yy = (v: number) => g.y0 + (g.upper ? v : 1 - v) * g.h;
    carvePath(F, [[g.x0 + 0.5 * g.w, yy(0.22)], [g.x0 + 0.5 * g.w, yy(0.56)], [g.x0 + 0.5 * g.w, yy(0.86)]], 0.9, 0.9, 0.3);
  }
  for (let i = 0; i < F.h.length; i++) F.h[i] = F.h[i]! - F.carve[i]!;
  return F;
}

const lookFor = (g: Geo, view: ToothView, tone: number): Look => {
  const P = FRONT[g.rank]!;
  const phase = tone * 9;
  const inner = view === "inner";
  return {
    light: [-0.42, -0.58, 0.7],
    ambient: inner ? 0.64 : 0.63,
    bump: inner ? 1.05 : 1.25,
    specStrength: inner ? 0.34 : 0.62,
    specPower: inner ? 30 : 24,
    ao: inner ? 0.4 : 0.22,
    aoRadius: 3,
    tint: inner ? [0.62, 0.5, 0.44] : [0.72, 0.62, 0.55],
    albedo: (x, y, carve, _sd, out) => {
      const { u, v, uu } = localOf(g, x, y);
      // Taban: hafif sıcak fildişi; her dişte küçük ton farkı
      let r = 255 + tone * 4;
      let gg = (inner ? 248 : 253) + tone * 5;
      let b = (inner ? 236 : 249) + tone * 8;
      // Boyun: dentin görünür, daha sarı/sıcak
      const cerv = (1 - smooth(0.0, 0.42, v)) * 0.4;
      r += (240 - r) * cerv;
      gg += (222 - gg) * cerv;
      b += (206 - b) * cerv;
      // Kesici kenar: mavi-gri saydamlık (üç mamelon kıvrımı ile dalgalı sınır)
      if (!inner && P.trans > 0) {
        const wave = 0.022 * Math.sin(u * Math.PI * 6 + phase);
        const tr = smooth(0.8 + wave, 0.97 + wave, v) * P.trans * 0.5;
        r += (204 - r) * tr;
        gg += (222 - gg) * tr;
        b += (240 - b) * tr;
      }
      // Yan kenarlar: mine incelir, biraz koyu/sıcak
      const edge = (1 - smooth(0, 0.18, Math.min(uu, 1 - uu))) * 0.34;
      r += (236 - r) * edge;
      gg += (226 - gg) * edge;
      b += (206 - b) * edge;
      // Çukurlardaki hafif leke
      const st = Math.min(1, carve / 0.7) * 0.3;
      out[0] = r + (206 - r) * st;
      out[1] = gg + (180 - gg) * st;
      out[2] = b + (138 - b) * st;
    },
  };
};

export function toothPixels(view: ToothView, rank: number, w: number, h: number, upper: boolean, index: number, res: number): { pixels: Uint8ClampedArray; W: number; H: number; geo: Geo } {
  const hid = HIDDEN * h;
  const geo: Geo = { w, h, upper, rank, x0: M, y0: upper ? M + hid : M };
  const F = view === "front" ? frontField(geo, res) : innerField(geo, res);
  const tone = rand(index * 3.7 + (upper ? 1.3 : 2.9)) - 0.5;
  return { pixels: lightField(F, lookFor(geo, view, tone)), W: F.W, H: F.H, geo };
}

const sprites = new Map<string, HTMLCanvasElement | null>();
let spritesRes = 0;

function ensureSprite(view: ToothView, upper: boolean, index: number, t: Rect, res: number): HTMLCanvasElement | null {
  if (res !== spritesRes) {
    sprites.clear();
    spritesRes = res;
  }
  const key = `${view}|${upper ? 1 : 0}|${index}`;
  let sprite = sprites.get(key);
  if (sprite === undefined) {
    const rank = toothRank(index);
    const px = toothPixels(view, rank, t.w, t.h, upper, index, res);
    const geo = px.geo;
    const side = index < 6 ? -1 : 1;
    sprite = bakeToCanvas(px.pixels, px.W, px.H, (c) => {
      c.setTransform(res, 0, 0, res, 0, 0);
      toothPath(c, { x: geo.x0, y: geo.y0, w: geo.w, h: geo.h }, upper, rank, side);
      c.fillStyle = "#000";
      c.fill();
    });
    sprites.set(key, sprite);
  }
  return sprite;
}

/** Bir çenenin 12 dişini sprite olarak çizer. Sprite üretilemezse `fallback` (basit çizim) kullanılır. */
export function drawTeethRow(ctx: Ctx, teeth: Rect[], upper: boolean, view: ToothView, res: number, fallback: (t: Rect, i: number) => void): void {
  teeth.forEach((t, i) => {
    const sprite = ensureSprite(view, upper, i, t, res);
    if (!sprite) {
      fallback(t, i);
      return;
    }
    const hid = HIDDEN * t.h;
    ctx.drawImage(sprite, t.x - M, upper ? t.y - hid - M : t.y - M, sprite.width / res, sprite.height / res);
  });
}

/** Diş sprite'larını (önce ön, sonra iç görünüş) arka planda hazırlar: çağrı başına en az bir sprite, `budgetMs` dolana kadar. */
export function warmTeeth(upperTeeth: Rect[], lowerTeeth: Rect[], res: number, budgetMs: number): boolean {
  if (typeof performance === "undefined") return true;
  const t0 = performance.now();
  for (const view of ["front", "inner"] as const) {
    for (const [teeth, upper] of [[upperTeeth, true], [lowerTeeth, false]] as const) {
      for (let i = 0; i < teeth.length; i++) {
        if (res === spritesRes && sprites.has(`${view}|${upper ? 1 : 0}|${i}`)) continue;
        ensureSprite(view, upper, i, teeth[i]!, res);
        if (performance.now() - t0 >= budgetMs) return false;
      }
    }
  }
  return true;
}
