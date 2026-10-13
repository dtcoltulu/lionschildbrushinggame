import type { Ctx, Pt } from "./draw";
import type { Rect } from "./layout";
import { bakeToCanvas, carvePath, createField, forEachPixel, lightField, noise2, raisePath, softenHeight, stampRaise, stampSoft, type Field, type Look } from "./shade";
import { rand } from "./layout";
import { drawGumBand, gumBandPath, gumMarginCubics, traceCubics, type Cubic, type GumPalette } from "./teeth";

/**
 * Diş eti, damak ve dil: dişlerle aynı yükseklik-haritası ışık motoruyla çizilir (ıslak parlama, ince doku,
 * yuvarlak diş eti kenarı, damak kıvrımları, dil papillaları). Sahne önbelleği içinde bir kez çizilir.
 */

export type GumKind = "front" | "palate" | "floor";

const PAD = 2;
/** İç görünüşte alt çenenin diş eti şeridi kalınlığı (dişlerin diş etinin altında kalan payını örtmeli). */
export const FLOOR_THIN = 34;
const MARGIN_RADIUS = 6.5;

interface Colors {
  /** Kenara yakın (açık) ve uzak (koyu) renk. */
  near: [number, number, number];
  far: [number, number, number];
}
const COLORS: Record<GumKind, Colors> = {
  front: { near: [250, 160, 178], far: [238, 100, 128] },
  palate: { near: [246, 160, 176], far: [208, 98, 124] },
  floor: { near: [255, 150, 170], far: [238, 96, 124] },
};

const bezierAt = (c: Cubic, t: number): Pt => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return [a * c[0] + b * c[2] + d * c[4] + e * c[6], a * c[1] + b * c[3] + d * c[5] + e * c[7]];
};

interface Band {
  F: Field;
  /** Sprite sol-üstünün dünya konumu. */
  bx: number;
  by: number;
  cubics: Cubic[];
  farY: number;
}

function bandField(kind: GumKind, teeth: Rect[], upper: boolean, mouth: Rect, res: number, thin: number): Band {
  const cubics = gumMarginCubics(teeth, upper, mouth);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of cubics) for (const k of [1, 3, 5, 7]) {
    minY = Math.min(minY, c[k]!);
    maxY = Math.max(maxY, c[k]!);
  }
  const farY = upper ? mouth.y - 8 : mouth.y + mouth.h + 8;
  const bx = mouth.x - 6 - PAD;
  const bw = mouth.w + 12 + 2 * PAD;
  // `thin` > 0: yalnızca kenardan `thin` birim kalınlıkta ince şerit (iç görünüşte alt çene: arkasında dil var)
  const by = upper ? mouth.y - 8 - PAD : (thin > 0 ? minY - PAD : minY - PAD);
  const bottom = upper ? maxY + PAD : (thin > 0 ? maxY + thin + PAD : farY + PAD);
  const F = createField(bw, bottom - by, res);
  const lx = (x: number) => x - bx;
  const ly = (y: number) => y - by;

  // Kenara yakınlık (0..1) → F.carve: kenar boyunca örneklenen noktalardan yumuşak damgalar
  for (const c of cubics) {
    for (let k = 0; k < 24; k++) {
      const [x, y] = bezierAt(c, k / 24);
      stampSoft(F, lx(x), ly(y), MARGIN_RADIUS, 1);
    }
  }
  forEachPixel(F, (x, y, i) => {
    F.sd[i] = 5;
    const ridge = F.carve[i]!;
    // Çok ince, hafif "portakal kabuğu" dokusu (gerçek diş eti neredeyse pürüzsüzdür)
    const n1 = noise2(x * 0.42 + 3.1, y * 0.42 + 7.7);
    const n2 = noise2(x * 0.95 + 9.3, y * 0.95 + 1.9);
    F.h[i] = 1.25 * ridge + 0.13 * (n1 - 0.5) + 0.06 * (n2 - 0.5);
  });
  // Kenar yakınlığı ayrık damgalardan geldiği için küçük dalgalanmalar olur; ışık bunları çizgi gibi gösterir → yumuşat
  softenHeight(F, 1);

  if (kind === "palate") {
    // Damak: orta çizgi (rafe), kesici papilla ve enine kıvrımlar (rugae)
    const cx = lx(mouth.x + mouth.w / 2);
    const top = ly(mouth.y + 6);
    raisePath(F, [[cx, top + 2], [cx + 0.6, top + 22], [cx, top + 40]], 1.1, 0.8, 0.3);
    stampRaise(F, cx, ly(maxY) - 24, 3.4, 1.7);
    for (let r = 0; r < 4; r++) {
      const y = top + 8 + r * 7;
      for (const sgn of [-1, 1]) {
        raisePath(
          F,
          [
            [cx + sgn * 7, y + 3],
            [cx + sgn * (28 + r * 6), y - 5 + r * 0.8],
            [cx + sgn * (62 + r * 16), y + 1 + r],
            [cx + sgn * (92 + r * 24), y + 9 + r * 1.5],
          ],
          1.45,
          1.5,
          0.3,
        );
      }
    }
  }
  return { F, bx, by, cubics, farY };
}

function gumLook(kind: GumKind, upper: boolean, band: Band): Look {
  const col = COLORS[kind];
  const bh = band.F.H / band.F.res;
  return {
    light: [-0.42, -0.58, 0.7],
    ambient: 0.7,
    bump: 1.15,
    specStrength: kind === "front" ? 0.34 : 0.5,
    specPower: 34,
    ao: 0.3,
    aoRadius: 3,
    tint: [0.62, 0.26, 0.3],
    albedo: (_x, y, ridge, _sd, out) => {
      const farness = Math.pow(Math.max(0, Math.min(1, upper ? 1 - y / bh : y / bh)), 1.15);
      const t = Math.max(0, Math.min(1, ridge));
      const near = Math.max(t, 1 - farness);
      out[0] = col.far[0] + (col.near[0] - col.far[0]) * near;
      out[1] = col.far[1] + (col.near[1] - col.far[1]) * near;
      out[2] = col.far[2] + (col.near[2] - col.far[2]) * near;
    },
  };
}

const sprites = new Map<string, HTMLCanvasElement | null>();
let spritesRes = 0;

function ensureBand(kind: GumKind, teeth: Rect[], upper: boolean, mouth: Rect, res: number, thin: number): { sprite: HTMLCanvasElement | null; band: { bx: number; by: number } } {
  const key = `${kind}|${upper ? 1 : 0}|${thin}`;
  // Yalnızca sprite ve konumu saklanır (büyük yükseklik dizileri hesap bitince atılır)
  let entry = bandMeta.get(key);
  if (res !== spritesRes) {
    sprites.clear();
    bandMeta.clear();
    spritesRes = res;
    entry = undefined;
  }
  if (!entry) {
    const band = bandField(kind, teeth, upper, mouth, res, thin);
    const sprite = bakeToCanvas(lightField(band.F, gumLook(kind, upper, band)), band.F.W, band.F.H, (c) => {
      c.setTransform(res, 0, 0, res, -band.bx * res, -band.by * res);
      if (thin > 0) {
        thinBandPath(c, band.cubics, thin);
        // Alt kenar dile doğru yumuşakça kaybolur (sert, kıvrımlı bir şerit kenarı olmasın)
        let top = Infinity;
        let bot = -Infinity;
        for (const cu of band.cubics) for (const k of [1, 3, 5, 7]) {
          top = Math.min(top, cu[k]!);
          bot = Math.max(bot, cu[k]!);
        }
        // Dişlerin diş etinin altında kalan boynu (≈ 12 birim) tamamen örtülür; ondan sonra dile doğru kaybolur
        const g = c.createLinearGradient(0, top, 0, bot + thin);
        const solid = Math.min(0.9, (bot - top + 19) / (bot - top + thin));
        g.addColorStop(0, "rgba(0,0,0,1)");
        g.addColorStop(solid, "rgba(0,0,0,1)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = g;
        c.fill();
        // Yanlara doğru da yumuşakça kaybolur (dikey kenarlı dikdörtgen görünmesin)
        const ex0 = band.cubics[0]![0];
        const ex1 = band.cubics[band.cubics.length - 1]![6];
        const fx0 = band.cubics[1]![0];
        const fx1 = band.cubics[band.cubics.length - 2]![6];
        const hx = c.createLinearGradient(ex0, 0, ex1, 0);
        hx.addColorStop(0, "rgba(0,0,0,0)");
        hx.addColorStop(Math.min(0.45, (fx0 - 1 - ex0) / (ex1 - ex0)), "rgba(0,0,0,1)");
        hx.addColorStop(Math.max(0.55, (fx1 + 1 - ex0) / (ex1 - ex0)), "rgba(0,0,0,1)");
        hx.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = hx;
        c.fillRect(ex0 - 2, top - 6, ex1 - ex0 + 4, bot + thin - top + 12);
        return;
      } else {
        gumBandPath(c, teeth, upper, mouth);
        c.fillStyle = "#000";
      }
      c.fill();
    });
    sprites.set(key, sprite);
    entry = { band: { bx: band.bx, by: band.by } };
    bandMeta.set(key, entry);
  }
  return { sprite: sprites.get(key) ?? null, band: entry.band };
}
const bandMeta = new Map<string, { band: { bx: number; by: number } }>();

/** Kenar ile ondan `thin` birim uzaktaki paralel kenar arasındaki ince şerit (iç görünüşte alt çene). */
function thinBandPath(ctx: Ctx, cubics: Cubic[], thin: number): void {
  const dy = thin; // alt çenede diş eti aşağıda: kenarın altına doğru kalınlık
  traceCubics(ctx, cubics);
  const rev = cubics
    .slice()
    .reverse()
    .map((c): Cubic => [c[6], c[7] + dy, c[4], c[5] + dy, c[2], c[3] + dy, c[0], c[1] + dy]);
  const last = cubics[cubics.length - 1]!;
  ctx.lineTo(last[6], last[7] + dy);
  for (const c of rev) ctx.bezierCurveTo(c[2], c[3], c[4], c[5], c[6], c[7]);
  ctx.closePath();
}

/**
 * Diş eti şeridini sprite olarak çizer (dişlerin üstüne biner); kenar çizgisi ve parlak iç çizgi vektördür.
 * `thin`: yalnızca iç görünüşte alt çene için ince şerit kalınlığı. Sprite üretilemezse basit çizim kullanılır.
 */
export function drawGumSprite(ctx: Ctx, kind: GumKind, teeth: Rect[], upper: boolean, mouth: Rect, res: number, pal: GumPalette, thin = 0): void {
  const { sprite, band } = ensureBand(kind, teeth, upper, mouth, res, thin);
  if (!sprite) {
    drawGumBand(ctx, teeth, upper, mouth, pal);
    return;
  }
  ctx.drawImage(sprite, band.bx, band.by, sprite.width / res, sprite.height / res);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const margin = gumMarginCubics(teeth, upper, mouth);
  traceCubics(ctx, thin > 0 ? margin.slice(1, -1) : margin);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = pal.margin;
  ctx.stroke();
  ctx.restore();
}

/** Diş eti sprite'larını arka planda hazırlar (ön görünüş: üst+alt, iç görünüş: damak + alt şerit). */
export function warmGums(upperTeeth: Rect[], lowerTeeth: Rect[], mouth: Rect, res: number, budgetMs: number): boolean {
  if (typeof performance === "undefined") return true;
  const t0 = performance.now();
  const jobs: [GumKind, Rect[], boolean, number][] = [
    ["front", upperTeeth, true, 0],
    ["front", lowerTeeth, false, 0],
    ["palate", upperTeeth, true, 0],
    ["floor", lowerTeeth, false, FLOOR_THIN],
  ];
  for (const [kind, teeth, upper, thin] of jobs) {
    if (res === spritesRes && sprites.has(`${kind}|${upper ? 1 : 0}|${thin}`)) continue;
    ensureBand(kind, teeth, upper, mouth, res, thin);
    if (performance.now() - t0 >= budgetMs) return false;
  }
  return warmTongue(res);
}

// ---- Dil -----------------------------------------------------------------------------------------

/** İki dil kullanımı: iç görünüşte alt dişlerin arkasındaki dil ve "dil" aşamasının büyük dili. */
export type TongueId = "inner" | "scene";

interface TongueSpec {
  area: { cx: number; cy: number; rx: number; ry: number };
  box: Rect;
  /** Orta oluk (dünya koordinatı). */
  groove: [number, number][];
}

const TONGUES: Record<TongueId, TongueSpec> = {
  inner: {
    area: { cx: 180, cy: 394, rx: 204, ry: 106 },
    box: { x: 6, y: 284, w: 348, h: 110 },
    groove: [[180, 304], [180.8, 336], [179.6, 370], [180, 394]],
  },
  scene: {
    area: { cx: 180, cy: 286, rx: 132, ry: 150 },
    box: { x: 40, y: 170, w: 280, h: 232 },
    groove: [[180, 188], [180.8, 250], [179.6, 330], [180, 394]],
  },
};

/** Dil: geniş oval; ortada boyuna olukla, yüzeyi ince papillalarla kaplı, ıslak parlak. */
function tongueField(spec: TongueSpec, res: number): Field {
  const { cx, cy, rx, ry } = spec.area;
  const box = spec.box;
  const F = createField(box.w, box.h, res);
  const lx = cx - box.x;
  const ly = cy - box.y;
  forEachPixel(F, (x, y, i) => {
    const e = Math.sqrt(((x - lx) / rx) ** 2 + ((y - ly) / ry) ** 2);
    F.sd[i] = 5;
    if (e >= 1) return;
    const roll = Math.min(1, (1 - e) / 0.14);
    F.h[i] = 6 * Math.sqrt(Math.max(0, 1 - e * e)) * (roll * roll * (3 - 2 * roll)) ** 0.6;
  });
  // Papillalar: gevşek ızgara üzerinde, rastgele kaymış küçük tümsekler
  const step = 2.4;
  for (let gy = 2; gy < box.h; gy += step) {
    for (let gx = 2; gx < box.w; gx += step) {
      const jx = (rand(gx * 1.31 + gy * 7.7) - 0.5) * step * 0.9;
      const jy = (rand(gx * 5.9 + gy * 2.3) - 0.5) * step * 0.9;
      const x = gx + jx;
      const y = gy + jy;
      const e = Math.sqrt(((x - lx) / rx) ** 2 + ((y - ly) / ry) ** 2);
      if (e > 0.96) continue;
      const a = 0.5 + 0.5 * rand(gx * 3.7 + gy * 1.9);
      stampRaise(F, x, y, 0.62 + 0.3 * rand(gx * 9.1 + gy * 4.3), 0.34 * a * (1 - 0.35 * e));
    }
  }
  // Orta oluk (median sulkus)
  carvePath(
    F,
    spec.groove.map(([x, y]): [number, number] => [x - box.x, y - box.y]),
    2.3,
    1.15,
    0.22,
  );
  for (let i = 0; i < F.h.length; i++) F.h[i] = F.h[i]! - F.carve[i]!;
  return F;
}

const tongueLook = (spec: TongueSpec): Look => ({
  light: [-0.42, -0.58, 0.7],
  ambient: 0.66,
  bump: 0.95,
  specStrength: 0.5,
  specPower: 36,
  ao: 0.4,
  aoRadius: 2.2,
  tint: [0.52, 0.24, 0.3],
  albedo: (x, y, carve, _sd, out) => {
    const { cx, cy, rx, ry } = spec.area;
    const e = Math.min(1, Math.sqrt(((x + spec.box.x - cx) / rx) ** 2 + ((y + spec.box.y - cy) / ry) ** 2));
    const t = e * e; // kenara doğru koyulaşır
    const groove = Math.min(1, carve / 1.2) * 0.32;
    out[0] = (246 + (206 - 246) * t) * (1 - groove) + 170 * groove;
    out[1] = (142 + (82 - 142) * t) * (1 - groove) + 70 * groove;
    out[2] = (160 + (108 - 160) * t) * (1 - groove) + 92 * groove;
  },
});

const tongueSprites = new Map<TongueId, HTMLCanvasElement | null>();
let tongueRes = 0;

function ensureTongue(id: TongueId, res: number): HTMLCanvasElement | null {
  if (tongueRes !== res) {
    tongueSprites.clear();
    tongueRes = res;
  }
  let sprite = tongueSprites.get(id);
  if (sprite === undefined) {
    const spec = TONGUES[id];
    const F = tongueField(spec, res);
    sprite = bakeToCanvas(lightField(F, tongueLook(spec)), F.W, F.H, (c) => {
      c.setTransform(res, 0, 0, res, -spec.box.x * res, -spec.box.y * res);
      c.beginPath();
      c.ellipse(spec.area.cx, spec.area.cy, spec.area.rx, spec.area.ry, 0, 0, Math.PI * 2);
      c.fillStyle = "#000";
      c.fill();
    });
    tongueSprites.set(id, sprite);
  }
  return sprite;
}

/** Dili çizer. Sprite üretilemezse `fallback` (düz şekil) çizer. */
export function drawTongueSprite(ctx: Ctx, id: TongueId, res: number, fallback: () => void): void {
  const sprite = ensureTongue(id, res);
  if (!sprite) {
    fallback();
    return;
  }
  const box = TONGUES[id].box;
  ctx.drawImage(sprite, box.x, box.y, sprite.width / res, sprite.height / res);
}

export function warmTongue(res: number): boolean {
  for (const id of ["inner", "scene"] as const) {
    if (tongueRes === res && tongueSprites.has(id)) continue;
    ensureTongue(id, res);
    return false;
  }
  return true;
}
