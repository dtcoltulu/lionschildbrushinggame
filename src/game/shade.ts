/**
 * Yükseklik haritasından gölgelenmiş "sprite" üretimi (bump-map aydınlatma).
 *
 * Diş yüzeyleri (tümsek, oluk, kenar sırtı, çukur) bir yükseklik alanı olarak tanımlanır; her pikselin eğiminden normal,
 * Blinn-Phong ışık (sol üstten), parlama ve ortam örtülmesi (vadiler koyu) hesaplanır. Sonuç tuvale tek `drawImage` ile basılır.
 * Böylece degrade yığınlarının "plastik" görüntüsü yerine gerçek bir hacim ve ışık elde edilir. Sahne önbelleği
 * sayesinde yalnızca bir kez (ve ekran boyutu değişince) hesaplanır.
 *
 * Tarayıcıya özgü kısım yalnızca `bakeToCanvas` içindedir; `lightField` saf hesaptır (test edilebilir).
 */

export interface Field {
  /** Piksel boyutları. */
  readonly W: number;
  readonly H: number;
  /** Dünya biriminin kaç piksele denk geldiği. */
  readonly res: number;
  /** Yükseklik (dünya birimi). */
  readonly h: Float32Array;
  /** Oyuk derinliği (olukların boyası/lekesi için ayrıca tutulur; yükseklikten zaten çıkarılmıştır). */
  readonly carve: Float32Array;
  /** İşaretli uzaklık: dünya biriminde, iç = pozitif (kenar = 0). */
  readonly sd: Float32Array;
}

export function createField(wWorld: number, hWorld: number, res: number): Field {
  const W = Math.max(1, Math.ceil(wWorld * res));
  const H = Math.max(1, Math.ceil(hWorld * res));
  return { W, H, res, h: new Float32Array(W * H), carve: new Float32Array(W * H), sd: new Float32Array(W * H).fill(-1e3) };
}

/** Her piksel için (x,y: dünya birimi, sprite sol-üstü 0,0) fonksiyonu çalıştırır. */
export function forEachPixel(f: Field, fn: (x: number, y: number, i: number) => void): void {
  const inv = 1 / f.res;
  for (let j = 0; j < f.H; j++) {
    const y = (j + 0.5) * inv;
    for (let i = 0; i < f.W; i++) fn((i + 0.5) * inv, y, j * f.W + i);
  }
}

/** exp(−x) için 0..GAUSS_MAX aralığında tablo (damga içi pikseller çok; Math.exp yavaş). */
const GAUSS_N = 256;
const GAUSS_MAX = 9;
const GAUSS = (() => {
  const t = new Float32Array(GAUSS_N + 1);
  for (let i = 0; i <= GAUSS_N; i++) t[i] = Math.exp(-(i / GAUSS_N) * GAUSS_MAX);
  return t;
})();

/** Gauss damgası ile oyuk ekler (en derin değer korunur). `depth` dünya birimi, `sigma` dünya birimi. */
export function stampCarve(f: Field, x: number, y: number, sigma: number, depth: number): void {
  const r = Math.ceil(sigma * 3 * f.res);
  const cx = Math.round(x * f.res - 0.5);
  const cy = Math.round(y * f.res - 0.5);
  const inv2 = 1 / (2 * sigma * sigma);
  const lut = GAUSS_N / GAUSS_MAX;
  const inv = 1 / f.res;
  for (let j = Math.max(0, cy - r); j <= Math.min(f.H - 1, cy + r); j++) {
    const dy = (j + 0.5) * inv - y;
    for (let i = Math.max(0, cx - r); i <= Math.min(f.W - 1, cx + r); i++) {
      const dx = (i + 0.5) * inv - x;
      const e = (dx * dx + dy * dy) * inv2;
      if (e >= GAUSS_MAX) continue;
      const v = depth * GAUSS[(e * lut) | 0]!;
      const k = j * f.W + i;
      if (v > f.carve[k]!) f.carve[k] = v;
    }
  }
}

/** Gauss kabartma damgası (toplanır): papilla, kıvrım gibi küçük tümsekler. `sigma`, `amp` dünya birimi. */
export function stampRaise(f: Field, x: number, y: number, sigma: number, amp: number): void {
  const r = Math.ceil(sigma * 2.6 * f.res);
  const cx = Math.round(x * f.res - 0.5);
  const cy = Math.round(y * f.res - 0.5);
  const inv2 = 1 / (2 * sigma * sigma);
  const lut = GAUSS_N / GAUSS_MAX;
  const inv = 1 / f.res;
  for (let j = Math.max(0, cy - r); j <= Math.min(f.H - 1, cy + r); j++) {
    const dy = (j + 0.5) * inv - y;
    for (let i = Math.max(0, cx - r); i <= Math.min(f.W - 1, cx + r); i++) {
      const dx = (i + 0.5) * inv - x;
      const e = (dx * dx + dy * dy) * inv2;
      if (e >= GAUSS_MAX) continue;
      f.h[j * f.W + i] = f.h[j * f.W + i]! + amp * GAUSS[(e * lut) | 0]!;
    }
  }
}

/** Yumuşak disk damgası: merkezde 1, `inner`'dan `radius`'a doğru 0'a iner; `carve` tamponunda en büyük değer korunur (kenara yakınlık için). */
export function stampSoft(f: Field, x: number, y: number, radius: number, inner: number): void {
  const r = Math.ceil(radius * f.res);
  const cx = Math.round(x * f.res - 0.5);
  const cy = Math.round(y * f.res - 0.5);
  const inv = 1 / f.res;
  const span = Math.max(1e-6, radius - inner);
  for (let j = Math.max(0, cy - r); j <= Math.min(f.H - 1, cy + r); j++) {
    const dy = (j + 0.5) * inv - y;
    for (let i = Math.max(0, cx - r); i <= Math.min(f.W - 1, cx + r); i++) {
      const dx = (i + 0.5) * inv - x;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= radius) continue;
      const t = d <= inner ? 0 : (d - inner) / span;
      const v = 1 - t * t * (3 - 2 * t);
      const k = j * f.W + i;
      if (v > f.carve[k]!) f.carve[k] = v;
    }
  }
}

/** Noktalar dizisi boyunca (uçlara doğru incelen) kabartma çizgisi (kıvrım, sırt). */
export function raisePath(f: Field, pts: [number, number][], sigma: number, amp: number, taper = 0.25): void {
  const step = Math.max(0.15, sigma * 0.35);
  let total = 0;
  const lens: number[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const l = Math.hypot(pts[k + 1]![0] - pts[k]![0], pts[k + 1]![1] - pts[k]![1]);
    lens.push(l);
    total += l;
  }
  if (total === 0) return;
  let run = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const n = Math.max(1, Math.ceil(lens[k]! / step));
    for (let q = 0; q < n; q++) {
      const t = (q + 0.5) / n;
      const along = (run + t * lens[k]!) / total;
      const e = Math.sin((Math.max(0, Math.min(1, along / taper, (1 - along) / taper)) * Math.PI) / 2);
      // adım başına amp küçültülür: damgalar üst üste binip toplanır
      stampRaise(f, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, sigma, amp * (0.2 + 0.8 * e) * (step / (sigma * 2.507)));
    }
    run += lens[k]!;
  }
}

/** Noktalar dizisi boyunca (uçlara doğru incelen) oluk çeker. `pts` dünya birimi; `taper` = uçlardaki daralma oranı. */
export function carvePath(f: Field, pts: [number, number][], sigma: number, depth: number, taper = 0.25): void {
  // Kısa adımlarla örnekle (damga yarıçapının dörtte biri)
  const step = Math.max(0.15, sigma * 0.35);
  let total = 0;
  const lens: number[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const l = Math.hypot(pts[k + 1]![0] - pts[k]![0], pts[k + 1]![1] - pts[k]![1]);
    lens.push(l);
    total += l;
  }
  if (total === 0) return;
  let run = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const n = Math.max(1, Math.ceil(lens[k]! / step));
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n;
      const along = (run + t * lens[k]!) / total;
      const w = Math.min(1, along / taper, (1 - along) / taper);
      const e = Math.sin((Math.max(0, w) * Math.PI) / 2); // uçta 0, ortada 1
      stampCarve(f, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, sigma * (0.55 + 0.45 * e), depth * (0.25 + 0.75 * e));
    }
    run += lens[k]!;
  }
}

export interface Look {
  /** Işığa doğru birim vektör (x sağ, y aşağı, z izleyiciye). */
  light: [number, number, number];
  ambient: number;
  /** Eğim ölçeği (büyük = daha dramatik hacim). */
  bump: number;
  specStrength: number;
  specPower: number;
  /** Ortam örtülmesi şiddeti (0..1). */
  ao: number;
  /** Ortam örtülmesinin yarıçapı (dünya birimi). */
  aoRadius: number;
  /** Gölge/vadi renk çarpanı (0..1, sıcak): koyulaşma gri değil bu tonda olur. */
  tint: [number, number, number];
  /** Piksel rengi: out = [r,g,b] (0..255) yazılır. `carve` = oluk derinliği, `sd` = kenara uzaklık (iç pozitif). */
  albedo: (x: number, y: number, carve: number, sd: number, out: number[]) => void;
}

/** x^n (n tam sayı) kare alma ile; Math.pow'dan çok daha hızlı. */
function powInt(x: number, n: number): number {
  let r = 1;
  let b = x;
  let e = Math.max(0, Math.round(n));
  while (e > 0) {
    if (e & 1) r *= b;
    b *= b;
    e >>= 1;
  }
  return r;
}

function boxBlur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = 2 * r + 1;
  for (let j = 0; j < H; j++) {
    let acc = 0;
    const row = j * W;
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(W - 1, Math.max(0, i))]!;
    for (let i = 0; i < W; i++) {
      tmp[row + i] = acc / win;
      acc += src[row + Math.min(W - 1, i + r + 1)]! - src[row + Math.max(0, i - r)]!;
    }
  }
  for (let i = 0; i < W; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += tmp[Math.min(H - 1, Math.max(0, j)) * W + i]!;
    for (let j = 0; j < H; j++) {
      out[j * W + i] = acc / win;
      acc += tmp[Math.min(H - 1, j + r + 1) * W + i]! - tmp[Math.max(0, j - r) * W + i]!;
    }
  }
  return out;
}

/** Yüksekliği hafifçe yumuşatır (kubbelerin birleştiği keskin kırışıkları alır). `radius` dünya birimi. */
export function softenHeight(f: Field, radius: number): void {
  const r = Math.max(1, Math.round(radius * f.res));
  f.h.set(boxBlur(f.h, f.W, f.H, r));
}

/** Aydınlatılmış RGBA piksel dizisi üretir (alfa = kenar yumuşatmalı kapsama). */
export function lightField(f: Field, look: Look): Uint8ClampedArray {
  const { W, H, res } = f;
  const out = new Uint8ClampedArray(W * H * 4);
  const [lx, ly, lz] = look.light;
  // Blinn-Phong yarı vektörü (bakış z yönünde)
  const hx = lx;
  const hy = ly;
  const hz = lz + 1;
  const hl = Math.hypot(hx, hy, hz) || 1;
  const Hx = hx / hl;
  const Hy = hy / hl;
  const Hz = hz / hl;
  const blur = look.ao > 0 ? boxBlur(f.h, W, H, Math.max(1, Math.round(look.aoRadius * res))) : f.h;
  const rgb = [0, 0, 0];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const sd = f.sd[k]!;
      const alpha = Math.max(0, Math.min(1, 0.5 + sd * res));
      if (alpha <= 0) continue;
      const il = f.h[j * W + Math.max(0, i - 1)]!;
      const ir = f.h[j * W + Math.min(W - 1, i + 1)]!;
      const iu = f.h[Math.max(0, j - 1) * W + i]!;
      const id = f.h[Math.min(H - 1, j + 1) * W + i]!;
      const dx = ((ir - il) * res) / 2;
      const dy = ((id - iu) * res) / 2;
      let nx = -dx * look.bump;
      let ny = -dy * look.bump;
      const nl = Math.sqrt(nx * nx + ny * ny + 1);
      nx /= nl;
      ny /= nl;
      const nz = 1 / nl;
      const diffuse = Math.max(0, Math.min(1.3, (nx * lx + ny * ly + nz * lz) / lz));
      const spec = powInt(Math.max(0, nx * Hx + ny * Hy + nz * Hz), look.specPower) * look.specStrength;
      const valley = look.ao > 0 ? look.ao * Math.max(0, Math.min(1, (blur[k]! - f.h[k]!) * 0.9)) : 0;
      const x = (i + 0.5) / res;
      const y = (j + 0.5) / res;
      look.albedo(x, y, f.carve[k]!, sd, rgb);
      // Koyulaşma (0..1): ışığa dönük olmayan yüzeyler + vadiler; sıcak tonla karışır (gri değil)
      const lit = look.ambient + (1 - look.ambient) * Math.min(1, diffuse);
      const dark = Math.max(0, Math.min(1, ((1 - lit) / (1 - look.ambient)) * 0.55 + valley));
      const glow = Math.max(0, diffuse - 1) * 0.5 + spec;
      const o = k * 4;
      out[o] = rgb[0]! * (1 - dark * (1 - look.tint[0])) + glow * 255;
      out[o + 1] = rgb[1]! * (1 - dark * (1 - look.tint[1])) + glow * 255;
      out[o + 2] = rgb[2]! * (1 - dark * (1 - look.tint[2])) + glow * 255;
      out[o + 3] = alpha * 255;
    }
  }
  return out;
}

/**
 * Tarayıcıda: RGBA dizisini (yazma yolu; geri okuma yok) ayrı bir tuvale koyar. `document` yoksa null.
 * `mask` verilirse "destination-in" ile uygulanır: tuval yalnızca çizilen şeklin içinde kalır (kenarı tarayıcı yumuşatır).
 */
export function bakeToCanvas(pixels: Uint8ClampedArray, W: number, H: number, mask?: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext("2d");
    if (!c || typeof c.createImageData !== "function") return null;
    const img = c.createImageData(W, H);
    img.data.set(pixels);
    c.putImageData(img, 0, 0);
    if (mask) {
      c.save();
      c.globalCompositeOperation = "destination-in";
      mask(c);
      c.restore();
    }
    return canvas;
  } catch {
    return null;
  }
}

/** Sprite çözünürlüğü: cihaz ölçeğine yakın (keskin), 1.5–3 aralığında, yarım adımlarla (gereksiz yeniden hesap olmasın). */
export function quantizeRes(deviceScale: number): number {
  const dev = deviceScale > 0 ? deviceScale : 2;
  return Math.round(Math.max(1.5, Math.min(3, dev)) * 2) / 2;
}

let deviceScale = 2;

/** Çizim başında (yüz dönme ölçeği uygulanmadan önce) tuvalin dünya → cihaz pikseli ölçeği; sprite çözünürlüğünü belirler. */
export function setDeviceScale(a: number): void {
  if (a > 0) deviceScale = a;
}

/** Sprite çözünürlüğü (geçerli cihaz ölçeğinden). Yüz dönerken ya da önbellek dışı çizimde de sabit kalır. */
export function spriteResolution(): number {
  return quantizeRes(deviceScale);
}

const hash2 = (ix: number, iy: number): number => {
  let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

/** Pürüzsüz değer gürültüsü (0..1): diş eti/dil dokusu için. */
export function noise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
