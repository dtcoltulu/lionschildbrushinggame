import { rrect, type Ctx } from "./draw";
import type { Rect } from "./layout";

/**
 * Diş çizimleri. Yalnızca görünüm: vuruş alanları ve yamalar `layout.ts`teki dikdörtgenlerden gelir, buradaki
 * şekiller o dikdörtgenlerin içinde (üstte diş etinin altında kalan küçük bir pay hariç) çizilir.
 *
 * Yerel koordinat: u = soldan sağa (0..1), v = diş etinden (0) kesici/çiğneme kenarına (1).
 * Üst dişlerde diş eti yukarıdadır, alt dişlerde aşağıda; şekiller aynıdır, yalnızca ters çevrilir.
 */

type Pt = [number, number];
type Seg = [number, number, number, number, number, number];

/** Boyun (diş eti hizası) taç genişliğinden dardır: dişler arası gerçekçi üçgen boşluk ve sevimli "damla" biçim verir. */
export const NECK_L = 0.13;
export const NECK_R = 0.87;
/** Dişin diş etinin altında kalan (görünmeyen) payı, diş boyunun oranı. */
export const HIDDEN = 0.18;

interface Profile {
  /** Mezyal (orta hatta bakan, u=0) ve distal (u=1) yan çizginin tacın en geniş yerine vardığı yükseklik (v). */
  sM: number;
  sD: number;
  /** Boynun mezyal / distal yandan içeri girintisi (taç genişliği oranı). */
  neckM: number;
  neckD: number;
  /** Mezyal omuzdan distal omuza kesici/çiğneme kenarı (kübik Bezier parçaları, başlangıç noktası mezyal omuz). */
  edge: Seg[];
}

/**
 * Güzel gülüşün diş formları (mezyal = orta hatta bakan taraf, u=0; distal = u=1):
 * kesicilerde mezyal köşe daha keskin, distal köşe daha yuvarlak; yan kesici daha yuvarlak; köpek dişinde tepe mezyale kayık,
 * distal yamaç uzun; hepsi oval-kare, yumuşak köşeli (porselen kaplama görünümü).
 */
const CENTRAL: Profile = {
  sM: 0.84,
  sD: 0.78,
  neckM: 0.11,
  neckD: 0.15,
  edge: [
    [0, 0.95, 0.02, 1, 0.11, 1],
    [0.3, 1.012, 0.7, 1.012, 0.78, 1],
    [0.93, 1, 1, 0.92, 1, 0.78],
  ],
};
const LATERAL: Profile = {
  sM: 0.8,
  sD: 0.72,
  neckM: 0.12,
  neckD: 0.17,
  edge: [
    [0, 0.93, 0.04, 1, 0.19, 1],
    [0.4, 1.016, 0.6, 1.016, 0.7, 1],
    [0.91, 1, 1, 0.88, 1, 0.72],
  ],
};
/** Köpek dişi: tepesi mezyale kayık, yumuşak yuvarlak uçlu (korkutucu değil); distal yamaç mezyalden uzun. */
const CANINE: Profile = {
  sM: 0.7,
  sD: 0.58,
  neckM: 0.14,
  neckD: 0.17,
  edge: [
    [0, 0.82, 0.16, 0.95, 0.33, 0.992],
    [0.4, 1.026, 0.5, 1.03, 0.58, 0.985],
    [0.78, 0.9, 1, 0.76, 1, 0.58],
  ],
};
/** Küçük azılar: orta yerinde hafif tepeli geniş yay. */
const PREMOLAR: Profile = {
  sM: 0.78,
  sD: 0.72,
  neckM: 0.14,
  neckD: 0.16,
  edge: [
    [0, 0.91, 0.18, 1, 0.46, 1],
    [0.78, 1, 1, 0.9, 1, 0.72],
  ],
};
/** Azı: iki yumuşak tepeli çiğneme kenarı. */
const MOLAR: Profile = {
  sM: 0.78,
  sD: 0.76,
  neckM: 0.15,
  neckD: 0.15,
  edge: [
    [0, 0.93, 0.07, 1, 0.26, 1],
    [0.38, 1, 0.43, 0.955, 0.5, 0.955],
    [0.57, 0.955, 0.62, 1, 0.74, 1],
    [0.93, 1, 1, 0.93, 1, 0.76],
  ],
};
const PROFILES: Profile[] = [CENTRAL, LATERAL, CANINE, PREMOLAR, PREMOLAR, MOLAR];

/** Yan çizginin ortalama omuz yüksekliği (sprite gölgelemesinin silüet genişliğini kestirmesi için). */
export function shoulderOf(rank: number): number {
  const p = profileOf(rank);
  return (p.sM + p.sD) / 2;
}

function profileOf(rank: number): Profile {
  return PROFILES[Math.max(0, Math.min(PROFILES.length - 1, Math.round(rank)))]!;
}

/**
 * Yerel (u,v) → dünya. `side`: dişin ağızdaki tarafı; +1 sağ yarı (orta hat solda: mezyal sol), −1 sol yarı (orta hat sağda:
 * mezyal sağ). Böylece asimetrik profiller iki yarıda da orta hatta doğru bakar.
 */
function mapper(t: Rect, upper: boolean, side: number) {
  return (u: number, v: number): Pt => [t.x + (side >= 0 ? u : 1 - u) * t.w, upper ? t.y + v * t.h : t.y + t.h - v * t.h];
}

/** Tek dişin dış çizgisi (taç + diş etinin altında kalan boyun). */
export function toothPath(ctx: Ctx, t: Rect, upper: boolean, rank: number, side = 1): void {
  const P = mapper(t, upper, side);
  const { sM, sD, neckM, neckD, edge } = profileOf(rank);
  ctx.beginPath();
  ctx.moveTo(...P(neckM, -HIDDEN));
  ctx.lineTo(...P(neckM, 0));
  ctx.bezierCurveTo(...P(neckM - 0.1, sM * 0.36), ...P(0, sM * 0.58), ...P(0, sM));
  for (const [a, b, c, d, e, f] of edge) ctx.bezierCurveTo(...P(a, b), ...P(c, d), ...P(e, f));
  ctx.bezierCurveTo(...P(1, sD * 0.58), ...P(1 - neckD + 0.1, sD * 0.36), ...P(1 - neckD, 0));
  ctx.lineTo(...P(1 - neckD, -HIDDEN));
  ctx.closePath();
}

export interface ToothPalette {
  /** Soldan sağa gövde: kenar gölgesi, ışık, orta ışık, ışık, kenar gölgesi. */
  body: [string, string, string, string, string];
  /** Dış çizgi. */
  line: string;
  /** Diş eti hizasındaki yumuşak gölge (renk, saydamlığı kodda sıfıra iner). */
  neck: string;
  neckClear: string;
  /** Parlama (üst renk; aşağıya doğru saydamlaşır). */
  shine: string;
  shineClear: string;
}

export const FRONT_TOOTH: ToothPalette = {
  body: ["#E9DCC2", "#FFF8EA", "#FFFFFF", "#FFF6E4", "#E6D8BD"],
  line: "#C9BA9C",
  neck: "rgba(238,132,156,0.38)",
  neckClear: "rgba(238,132,156,0)",
  shine: "rgba(255,255,255,0.95)",
  shineClear: "rgba(255,255,255,0)",
};

/** Dişlerin iç (dil tarafı) görünüşü: hafif mor tonlu. */
export const INNER_TOOTH: ToothPalette = {
  body: ["#D3C8EA", "#EEE9FA", "#F8F5FF", "#ECE6F8", "#CFC3E6"],
  line: "#A99CCB",
  neck: "rgba(180,110,170,0.34)",
  neckClear: "rgba(180,110,170,0)",
  shine: "rgba(255,255,255,0.8)",
  shineClear: "rgba(255,255,255,0)",
};

/** Yedek (degrade) diş çizimi: piksel gölgelendirmeli sprite üretilemezse kullanılır. */
export function drawTooth(ctx: Ctx, t: Rect, rank: number, upper: boolean, pal: ToothPalette, inner = false, side = 1): void {
  ctx.save();
  toothPath(ctx, t, upper, rank, side);
  const body = ctx.createLinearGradient(t.x, 0, t.x + t.w, 0);
  body.addColorStop(0, pal.body[0]);
  body.addColorStop(0.2, pal.body[1]);
  body.addColorStop(0.52, pal.body[2]);
  body.addColorStop(0.82, pal.body[3]);
  body.addColorStop(1, pal.body[4]);
  ctx.fillStyle = body;
  ctx.fill();

  // İçerideki gölge/parlama dişin dışına taşmasın
  ctx.clip();
  const gumY = upper ? t.y : t.y + t.h;
  const farY = upper ? t.y + t.h * 0.62 : t.y + t.h * 0.38;
  const neck = ctx.createLinearGradient(0, gumY, 0, farY);
  neck.addColorStop(0, pal.neck);
  neck.addColorStop(1, pal.neckClear);
  ctx.fillStyle = neck;
  ctx.fillRect(t.x - 2, Math.min(gumY, farY) - t.h * HIDDEN, t.w + 4, Math.abs(farY - gumY) + t.h * HIDDEN);

  if (inner) {
    // Dil tarafı: içe çukur (kepçe) gölgesi
    const cx = t.x + t.w / 2;
    const cy = upper ? t.y + t.h * 0.58 : t.y + t.h * 0.42;
    const scoop = ctx.createRadialGradient(cx, cy, 1, cx, cy, Math.max(t.w, t.h * 0.55));
    scoop.addColorStop(0, "rgba(120,98,176,0.30)");
    scoop.addColorStop(0.7, "rgba(120,98,176,0.10)");
    scoop.addColorStop(1, "rgba(120,98,176,0)");
    ctx.fillStyle = scoop;
    ctx.fillRect(t.x - 2, t.y - t.h * HIDDEN, t.w + 4, t.h * (1 + 2 * HIDDEN));
  } else {
    // Parlak ışık çizgisi (sol üstten), aşağıya doğru sönümlenir
    const sx = t.x + t.w * 0.2;
    const sw = Math.max(3, t.w * 0.15);
    const sy = upper ? t.y + t.h * 0.22 : t.y + t.h * 0.12;
    const sh = Math.min(t.h * 0.44, 32);
    const shine = ctx.createLinearGradient(0, sy, 0, sy + sh);
    shine.addColorStop(0, pal.shine);
    shine.addColorStop(1, pal.shineClear);
    ctx.fillStyle = shine;
    rrect(ctx, sx, sy, sw, sh, sw / 2);
    ctx.fill();
  }
  ctx.restore();

  toothPath(ctx, t, upper, rank, side);
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = pal.line;
  ctx.stroke();
}

// ---- Diş eti ------------------------------------------------------------------------------

export interface GumPalette {
  /** Dudağa yakın taraf (koyu). */
  base: string;
  /** Diş kenarındaki (parlak) taraf. */
  light: string;
  /** Diş eti kenar çizgisi. */
  margin: string;
}

export const GUM: GumPalette = { base: "#F9788F", light: "#FFA3B5", margin: "#DB5873" };
/** İç görünüşte üst çene: damak. */
export const PALATE: GumPalette = { base: "#D9708A", light: "#EE95AA", margin: "#BF5772" };

/** Bir kübik Bezier: [x0,y0, c1x,c1y, c2x,c2y, x1,y1]. */
export type Cubic = [number, number, number, number, number, number, number, number];

const GUM_APEX = 4; // tepe noktası dişin içinde
const GUM_TIP = 13; // papilla ucu daha derinde

/**
 * Diş etinin dişlerle buluştuğu kıvrımlı kenar (üst çenede aşağı, alt çenede yukarı bakan papillalar). Uçlar ağız
 * kenarlarına uzanır. `dy`: tüm kenarın dikey kayması (parlak iç çizgi için).
 */
export function gumMarginCubics(teeth: Rect[], upper: boolean, mouth: Rect, dy = 0): Cubic[] {
  if (teeth.length === 0) return [];
  const dir = upper ? 1 : -1; // diş etinden dişe doğru yön (üstte aşağı, altta yukarı)
  const edge = (t: Rect) => (upper ? t.y : t.y + t.h);
  const x0 = mouth.x - 6;
  const x1 = mouth.x + mouth.w + 6;
  const first = teeth[0]!;
  const last = teeth[teeth.length - 1]!;
  const out: Cubic[] = [];
  const line = (ax: number, ay: number, bx: number, by: number) =>
    out.push([ax, ay, ax + (bx - ax) / 3, ay + (by - ay) / 3, ax + (2 * (bx - ax)) / 3, ay + (2 * (by - ay)) / 3, bx, by]);
  line(x0, edge(first) + dir * GUM_TIP + dy, first.x - 1.5, edge(first) + dir * GUM_TIP + dy);
  teeth.forEach((t, i) => {
    const L = t.x - 1.5; // sol papilla (komşu dişle ortak boşluğun ortası)
    const R = t.x + t.w + 1.5;
    const next = teeth[i + 1];
    const yl = (i === 0 ? edge(t) : (edge(teeth[i - 1]!) + edge(t)) / 2) + dir * GUM_TIP + dy;
    const yr = (next ? (edge(t) + edge(next)) / 2 : edge(t)) + dir * GUM_TIP + dy;
    const ya = edge(t) + dir * GUM_APEX + dy;
    const cx = (L + R) / 2;
    const w = R - L;
    out.push([L, yl, L + w * 0.03, yl - dir * (GUM_TIP - GUM_APEX) * 0.7, cx - w * 0.3, ya, cx, ya]);
    out.push([cx, ya, cx + w * 0.3, ya, R - w * 0.03, yr - dir * (GUM_TIP - GUM_APEX) * 0.7, R, yr]);
  });
  line(last.x + last.w + 1.5, out[out.length - 1]![7], x1, edge(last) + dir * GUM_TIP + dy);
  return out;
}

/** Kenarı çizer (yolu `beginPath` ile başlatır, kapatmaz). */
export function traceCubics(ctx: Ctx, cubics: Cubic[]): void {
  ctx.beginPath();
  if (cubics.length === 0) return;
  ctx.moveTo(cubics[0]![0], cubics[0]![1]);
  for (const c of cubics) ctx.bezierCurveTo(c[2], c[3], c[4], c[5], c[6], c[7]);
}

/** Diş eti şeridinin kapalı yolu: kenar + ağız tabanına/tavanına kadar uzanan taraf. */
export function gumBandPath(ctx: Ctx, teeth: Rect[], upper: boolean, mouth: Rect): void {
  const c = gumMarginCubics(teeth, upper, mouth);
  traceCubics(ctx, c);
  if (c.length === 0) return;
  const farY = upper ? mouth.y - 8 : mouth.y + mouth.h + 8;
  ctx.lineTo(mouth.x + mouth.w + 6, farY);
  ctx.lineTo(mouth.x - 6, farY);
  ctx.closePath();
}

/** Dişlerin boynunu saran, dişler arasında üçgen "papilla" yapan kıvrımlı diş eti şeridi (basit/yedek çizim). */
export function drawGumBand(ctx: Ctx, teeth: Rect[], upper: boolean, mouth: Rect, pal: GumPalette): void {
  if (teeth.length === 0) return;
  const dir = upper ? 1 : -1;
  const farY = upper ? mouth.y - 8 : mouth.y + mouth.h + 8;
  ctx.save();
  gumBandPath(ctx, teeth, upper, mouth);
  const marginY = upper ? teeth[0]!.y : teeth[0]!.y + teeth[0]!.h;
  const fill = ctx.createLinearGradient(0, farY, 0, marginY + dir * GUM_TIP);
  fill.addColorStop(0, pal.base);
  fill.addColorStop(1, pal.light);
  ctx.fillStyle = fill;
  ctx.fill();

  // Yuvarlak, parlak diş eti kenarı: biraz içeriden açık bir çizgi
  traceCubics(ctx, gumMarginCubics(teeth, upper, mouth, -dir * 3.4));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = "rgba(255,255,255,0.34)";
  ctx.stroke();

  traceCubics(ctx, gumMarginCubics(teeth, upper, mouth));
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = pal.margin;
  ctx.stroke();
  ctx.restore();
}

// ---- Öğretici: tek büyük diş ---------------------------------------------------------------

/** Klasik azı dişi simgesi: iki tümsekli taç ve iki kök. (180,300) çevresinde, taç merkezi ≈ (180,264). */
export function drawTutorialTooth(ctx: Ctx): void {
  ctx.save();
  ctx.translate(180, 300);
  ctx.scale(0.92, 0.92);
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(0, -94);
    ctx.bezierCurveTo(-18, -124, -58, -130, -80, -112);
    ctx.bezierCurveTo(-106, -92, -104, -42, -92, -4);
    ctx.bezierCurveTo(-82, 28, -84, 66, -70, 100);
    ctx.bezierCurveTo(-62, 120, -40, 124, -34, 102);
    ctx.bezierCurveTo(-26, 72, -20, 36, 0, 36);
    ctx.bezierCurveTo(20, 36, 26, 72, 34, 102);
    ctx.bezierCurveTo(40, 124, 62, 120, 70, 100);
    ctx.bezierCurveTo(84, 66, 82, 28, 92, -4);
    ctx.bezierCurveTo(104, -42, 106, -92, 80, -112);
    ctx.bezierCurveTo(58, -130, 18, -124, 0, -94);
    ctx.closePath();
  };
  path();
  // yumuşak gölge (yere/zemine)
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "#EFE5CE";
  ctx.fill();
  ctx.restore();

  const body = ctx.createLinearGradient(-104, 0, 104, 0);
  body.addColorStop(0, "#E9DCC2");
  body.addColorStop(0.22, "#FFF8EA");
  body.addColorStop(0.52, "#FFFFFF");
  body.addColorStop(0.82, "#FFF6E4");
  body.addColorStop(1, "#E4D6BA");
  path();
  ctx.fillStyle = body;
  ctx.fill();

  ctx.save();
  path();
  ctx.clip();
  // köklere doğru hafif gölge (diş eti tarafı)
  const roots = ctx.createLinearGradient(0, 20, 0, 118);
  roots.addColorStop(0, "rgba(200,170,120,0)");
  roots.addColorStop(1, "rgba(200,170,120,0.40)");
  ctx.fillStyle = roots;
  ctx.fillRect(-110, 20, 220, 110);
  // sol üst taçta yumuşak, kıvrık parlama
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineCap = "round";
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(-80, -52);
  ctx.bezierCurveTo(-82, -78, -74, -94, -56, -102);
  ctx.stroke();
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(-84, -26);
  ctx.lineTo(-83, -34);
  ctx.stroke();
  ctx.restore();

  path();
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#C9BA9C";
  ctx.stroke();
  ctx.restore();
}
