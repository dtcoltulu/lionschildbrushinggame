import type { Ctx } from "./draw";
import { bakeToCanvas, carvePath, createField, forEachPixel, lightField, softenHeight, type Field, type Look } from "./shade";

/**
 * Öğretici ekranındaki büyük diş: kökleri olan gerçekçi bir azı dişi (yükseklik haritasından ışık hesabıyla).
 * Silüet, `teeth.ts`teki eski öğretici dişiyle aynı bezier yolundan gelir; yükseklik, silüetin kenara uzaklığından
 * ("şişirme") ve iki tümsekten üretilir. Mesafe hesabı tuvalden geri okuma yapmadan, saf dizilerle yapılır.
 */

/** Yerel koordinatta (0,0 = dünyada (180,300), ölçek 0.92) kapalı yol: başlangıç + kübik Bezier parçaları. */
const START: [number, number] = [0, -94];
const SEGS: [number, number, number, number, number, number][] = [
  [-18, -124, -58, -130, -80, -112],
  [-106, -92, -104, -42, -92, -4],
  [-82, 28, -84, 66, -70, 100],
  [-62, 120, -40, 124, -34, 102],
  [-26, 72, -20, 36, 0, 36],
  [20, 36, 26, 72, 34, 102],
  [40, 124, 62, 120, 70, 100],
  [84, 66, 82, 28, 92, -4],
  [104, -42, 106, -92, 80, -112],
  [58, -130, 18, -124, 0, -94],
];
const CX = 180;
const CY = 300;
const SC = 0.92;
/** Sprite'ın dünyadaki dikdörtgeni. */
const BOX = { x: 74, y: 176, w: 212, h: 246 };

/** Yolu çokgene çevirir (yerel koordinat). */
function polygon(): [number, number][] {
  const pts: [number, number][] = [START];
  let [x0, y0] = START;
  for (const [a, b, c, d, e, f] of SEGS) {
    for (let k = 1; k <= 36; k++) {
      const t = k / 36;
      const u = 1 - t;
      pts.push([u * u * u * x0 + 3 * u * u * t * a + 3 * u * t * t * c + t * t * t * e, u * u * u * y0 + 3 * u * u * t * b + 3 * u * t * t * d + t * t * t * f]);
    }
    x0 = e;
    y0 = f;
  }
  return pts;
}

/** Çokgenin içi (1) / dışı (0) maskesi (satır tarama, çift-tek kuralı) ve iç piksellerin kenara uzaklığı (dünya birimi). */
function insideDistance(F: Field, poly: [number, number][]): Float32Array {
  const { W, H, res } = F;
  const mask = new Uint8Array(W * H);
  // Yerel → sprite pikseli
  const px = poly.map(([lx, ly]): [number, number] => [((CX + lx * SC) - BOX.x) * res, ((CY + ly * SC) - BOX.y) * res]);
  for (let j = 0; j < H; j++) {
    const y = j + 0.5;
    const xs: number[] = [];
    for (let k = 0; k < px.length; k++) {
      const [ax, ay] = px[k]!;
      const [bx, by] = px[(k + 1) % px.length]!;
      if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let i = Math.max(0, Math.ceil(xs[k]! - 0.5)); i < Math.min(W, Math.floor(xs[k + 1]! - 0.5) + 1); i++) mask[j * W + i] = 1;
    }
  }
  // Kenara uzaklık: iki geçişli yaklaşık (3-4) mesafe dönüşümü, dışarıdan başlayarak
  const INF = 1e6;
  const d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const A = 1;
  const B = Math.SQRT2;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (!d[k]) continue;
      let v = d[k]!;
      if (i > 0) v = Math.min(v, d[k - 1]! + A);
      if (j > 0) {
        v = Math.min(v, d[k - W]! + A);
        if (i > 0) v = Math.min(v, d[k - W - 1]! + B);
        if (i < W - 1) v = Math.min(v, d[k - W + 1]! + B);
      }
      d[k] = v;
    }
  }
  for (let j = H - 1; j >= 0; j--) {
    for (let i = W - 1; i >= 0; i--) {
      const k = j * W + i;
      if (!d[k]) continue;
      let v = d[k]!;
      if (i < W - 1) v = Math.min(v, d[k + 1]! + A);
      if (j < H - 1) {
        v = Math.min(v, d[k + W]! + A);
        if (i < W - 1) v = Math.min(v, d[k + W + 1]! + B);
        if (i > 0) v = Math.min(v, d[k + W - 1]! + B);
      }
      d[k] = v;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? d[i]! / res : 0;
  return d;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Saf hesap: öğretici dişinin yükseklik alanı (test ve ölçüm için). */
export function toothField(res: number): Field {
  const F = createField(BOX.w, BOX.h, res);
  const dist = insideDistance(F, polygon());
  // 1) Şişirilmiş taban yüzey: kenardan uzaklaştıkça yükselir. Mesafe dönüşümü basamaklı olduğundan kuvvetle yumuşatılır
  //    (yoksa ışık yatay çizgi şeritleri gösterir).
  forEachPixel(F, (_x, _y, i) => {
    F.sd[i] = 5;
    const d = dist[i]!;
    if (d <= 0) return;
    const t = Math.min(1, d / 52);
    F.h[i] = 30 * (1 - (1 - t) ** 2);
  });
  softenHeight(F, 3.2);
  // 2) Taçta iki tümsek (üstte iki lob); köklere doğru inceltme (kökler taçtan alçak)
  forEachPixel(F, (x, y, i) => {
    if (dist[i]! <= 0) {
      F.h[i] = 0;
      return;
    }
    const lx = (x + BOX.x - CX) / SC;
    const ly = (y + BOX.y - CY) / SC;
    const lobe = (cx: number, cy: number) => {
      const q = ((lx - cx) / 52) ** 2 + ((ly - cy) / 44) ** 2;
      return q < 1 ? 7 * (1 - q) * (1 + 0.15 * q) : 0;
    };
    let h = F.h[i]! + Math.max(lobe(-46, -70), lobe(46, -70)) * smooth(-30, -110, ly) * 1.2;
    h *= 1 - 0.38 * smooth(10, 70, ly);
    F.h[i] = h;
  });
  softenHeight(F, 1);
  // 3) Boyun çizgisi (taç-kök sınırı): hafif kavisli sığ oluk
  const toWorld = (lx: number, ly: number): [number, number] => [CX + lx * SC - BOX.x, CY + ly * SC - BOX.y];
  carvePath(F, [toWorld(-92, 4), toWorld(-46, 14), toWorld(0, 18), toWorld(46, 14), toWorld(92, 4)], 2.2, 1.1, 0.2);
  for (let i = 0; i < F.h.length; i++) F.h[i] = F.h[i]! - F.carve[i]!;
  return F;
}

const LOOK: Look = {
  light: [-0.42, -0.58, 0.7],
  ambient: 0.66,
  bump: 0.85,
  specStrength: 0.6,
  specPower: 30,
  ao: 0.35,
  aoRadius: 5,
  tint: [0.66, 0.56, 0.5],
  albedo: (x, y, carve, _sd, out) => {
    const ly = (y + BOX.y - CY) / SC;
    // Kök: sement sarımsı; taç beyaz; kenarlarda sıcak
    const root = smooth(4, 40, ly);
    let r = 255 + (238 - 255) * root;
    let g = 252 + (218 - 252) * root;
    let b = 246 + (176 - 246) * root;
    // Tümsek uçlarında hafif mavimsi saydamlık
    const tr = smooth(-96, -122, ly) * 0.32;
    r += (208 - r) * tr;
    g += (224 - g) * tr;
    b += (240 - b) * tr;
    const st = Math.min(1, carve / 1.1) * 0.3;
    out[0] = r + (206 - r) * st;
    out[1] = g + (180 - g) * st;
    out[2] = b + (138 - b) * st;
    void x;
  },
};

let sprite: HTMLCanvasElement | null | undefined;
let spriteRes = 0;

function ensure(res: number): HTMLCanvasElement | null {
  if (spriteRes !== res) {
    sprite = undefined;
    spriteRes = res;
  }
  if (sprite === undefined) {
    const F = toothField(res);
    sprite = bakeToCanvas(lightField(F, LOOK), F.W, F.H, (c) => {
      c.setTransform(SC * res, 0, 0, SC * res, (CX - BOX.x) * res, (CY - BOX.y) * res);
      c.beginPath();
      c.moveTo(START[0], START[1]);
      for (const [a, b, cc, d, e, f] of SEGS) c.bezierCurveTo(a, b, cc, d, e, f);
      c.closePath();
      c.fillStyle = "#000";
      c.fill();
    });
  }
  return sprite;
}

/** Öğretici dişini çizer (yumuşak gölgeyle); sprite üretilemezse `fallback` (eski çizgi film dişi). */
export function drawTutorialToothSprite(ctx: Ctx, res: number, fallback: () => void): void {
  const s = ensure(res);
  if (!s) {
    fallback();
    return;
  }
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.38)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.drawImage(s, BOX.x, BOX.y, s.width / res, s.height / res);
  ctx.restore();
}

export function warmTutorialTooth(res: number): boolean {
  if (spriteRes === res && sprite !== undefined) return true;
  ensure(res);
  return false;
}

export const TUTORIAL_TOOTH_BOX = BOX;

/** Saf hesap: aydınlatılmış RGBA pikselleri. */
export function tutorialToothPixels(res: number): { pixels: Uint8ClampedArray; W: number; H: number } {
  const F = toothField(res);
  return { pixels: lightField(F, LOOK), W: F.W, H: F.H };
}
