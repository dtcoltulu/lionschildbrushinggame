import { rrect, type Ctx } from "./draw";
import { rand, type Rect } from "./layout";

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
const NECK_L = 0.13;
const NECK_R = 0.87;
/** Dişin diş etinin altında kalan (görünmeyen) payı, diş boyunun oranı. */
const HIDDEN = 0.18;

interface Profile {
  /** Yan çizginin tacın en geniş yerine vardığı yükseklik (v). */
  shoulder: number;
  /** Sol omuzdan sağ omuza kesici/çiğneme kenarı (kübik Bezier parçaları, başlangıç noktası sol omuz). */
  edge: Seg[];
}

const CENTRAL: Profile = {
  shoulder: 0.82,
  edge: [
    [0, 0.95, 0.04, 1, 0.17, 1],
    [0.36, 1.016, 0.64, 1.016, 0.83, 1],
    [0.96, 1, 1, 0.95, 1, 0.82],
  ],
};
const LATERAL: Profile = {
  shoulder: 0.8,
  edge: [
    [0, 0.93, 0.06, 1, 0.22, 1],
    [0.38, 1.012, 0.62, 1.012, 0.78, 1],
    [0.94, 1, 1, 0.93, 1, 0.8],
  ],
};
/** Köpek dişi: hafif sivrilen, yumuşak yuvarlak uçlu taç (korkutucu değil, sevimli). */
const CANINE: Profile = {
  shoulder: 0.74,
  edge: [
    [0, 0.86, 0.2, 0.96, 0.36, 0.992],
    [0.44, 1.024, 0.56, 1.024, 0.64, 0.992],
    [0.8, 0.96, 1, 0.86, 1, 0.74],
  ],
};
/** Küçük azılar: orta yerinde hafif tepeli geniş yay. */
const PREMOLAR: Profile = {
  shoulder: 0.76,
  edge: [
    [0, 0.92, 0.2, 1, 0.5, 1],
    [0.8, 1, 1, 0.92, 1, 0.76],
  ],
};
/** Azı: iki yumuşak tepeli çiğneme kenarı. */
const MOLAR: Profile = {
  shoulder: 0.76,
  edge: [
    [0, 0.93, 0.07, 1, 0.26, 1],
    [0.38, 1, 0.43, 0.955, 0.5, 0.955],
    [0.57, 0.955, 0.62, 1, 0.74, 1],
    [0.93, 1, 1, 0.93, 1, 0.76],
  ],
};
const PROFILES: Profile[] = [CENTRAL, LATERAL, CANINE, PREMOLAR, PREMOLAR, MOLAR];

function profileOf(rank: number): Profile {
  return PROFILES[Math.max(0, Math.min(PROFILES.length - 1, Math.round(rank)))]!;
}

function mapper(t: Rect, upper: boolean) {
  return (u: number, v: number): Pt => [t.x + u * t.w, upper ? t.y + v * t.h : t.y + t.h - v * t.h];
}

/** Tek dişin dış çizgisi (taç + diş etinin altında kalan boyun). */
function toothPath(ctx: Ctx, t: Rect, upper: boolean, rank: number): void {
  const P = mapper(t, upper);
  const { shoulder: s, edge } = profileOf(rank);
  ctx.beginPath();
  ctx.moveTo(...P(NECK_L, -HIDDEN));
  ctx.lineTo(...P(NECK_L, 0));
  ctx.bezierCurveTo(...P(NECK_L - 0.1, s * 0.36), ...P(0, s * 0.58), ...P(0, s));
  for (const [a, b, c, d, e, f] of edge) ctx.bezierCurveTo(...P(a, b), ...P(c, d), ...P(e, f));
  ctx.bezierCurveTo(...P(1, s * 0.58), ...P(NECK_R + 0.1, s * 0.36), ...P(NECK_R, 0));
  ctx.lineTo(...P(NECK_R, -HIDDEN));
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

export function drawTooth(ctx: Ctx, t: Rect, rank: number, upper: boolean, pal: ToothPalette, inner = false): void {
  ctx.save();
  toothPath(ctx, t, upper, rank);
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

  toothPath(ctx, t, upper, rank);
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
/** İç görünüşte alt çene: dil ve ağız tabanıyla bütünleşir. */
export const FLOOR: GumPalette = { base: "#F26E88", light: "#FF8FA3", margin: "#D45672" };

/** Dişlerin boynunu saran, dişler arasında üçgen "papilla" yapan kıvrımlı diş eti şeridi. */
export function drawGumBand(ctx: Ctx, teeth: Rect[], upper: boolean, mouth: Rect, pal: GumPalette): void {
  if (teeth.length === 0) return;
  const dir = upper ? 1 : -1; // diş etinden dişe doğru yön (üstte aşağı, altta yukarı)
  const edge = (t: Rect) => (upper ? t.y : t.y + t.h);
  const APEX = 4.5; // tepe noktası dişin içinde
  const TIP = 15; // papilla ucu daha derinde
  const farY = upper ? mouth.y - 8 : mouth.y + mouth.h + 8;
  const x0 = mouth.x - 6;
  const x1 = mouth.x + mouth.w + 6;
  const first = teeth[0]!;
  const last = teeth[teeth.length - 1]!;

  const trace = (dy: number) => {
    ctx.beginPath();
    ctx.moveTo(x0, edge(first) + dir * TIP + dy);
    ctx.lineTo(first.x - 1.5, edge(first) + dir * TIP + dy);
    teeth.forEach((t, i) => {
      const L = t.x - 1.5; // sol papilla (komşu dişle ortak boşluğun ortası)
      const R = t.x + t.w + 1.5;
      const next = teeth[i + 1];
      const yl = (i === 0 ? edge(t) : (edge(teeth[i - 1]!) + edge(t)) / 2) + dir * TIP + dy;
      const yr = (next ? (edge(t) + edge(next)) / 2 : edge(t)) + dir * TIP + dy;
      const ya = edge(t) + dir * APEX + dy;
      const cx = (L + R) / 2;
      const w = R - L;
      ctx.bezierCurveTo(L + w * 0.03, yl - dir * (TIP - APEX) * 0.7, cx - w * 0.3, ya, cx, ya);
      ctx.bezierCurveTo(cx + w * 0.3, ya, R - w * 0.03, yr - dir * (TIP - APEX) * 0.7, R, yr);
    });
    ctx.lineTo(x1, edge(last) + dir * TIP + dy);
  };

  ctx.save();
  trace(0);
  ctx.lineTo(x1, farY);
  ctx.lineTo(x0, farY);
  ctx.closePath();
  const marginY = edge(first);
  const fill = ctx.createLinearGradient(0, farY, 0, marginY + dir * TIP);
  fill.addColorStop(0, pal.base);
  fill.addColorStop(1, pal.light);
  ctx.fillStyle = fill;
  ctx.fill();

  // Yuvarlak, parlak diş eti kenarı: biraz içeriden açık bir çizgi
  trace(-dir * 3.4);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = "rgba(255,255,255,0.34)";
  ctx.stroke();

  trace(0);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = pal.margin;
  ctx.stroke();
  ctx.restore();
}

// ---- Çiğneme yüzeyi (üstten görünüş) --------------------------------------------------------

/** Üstten bakınca azı dişi: parlak taç, dört yuvarlak tepecik (tümsek) ve aralarında yumuşak gölgeli oluklar. */
export function drawMolarTile(ctx: Ctx, m: Rect, i: number): void {
  const cx = m.x + m.w / 2 + (rand(i * 3.3) - 0.5) * 5;
  const cy = m.y + m.h / 2 + (rand(i * 5.1) - 0.5) * 4;

  ctx.save();
  // Diş etine oturan taç: altında yumuşak gölge
  ctx.fillStyle = "rgba(176,46,80,0.30)";
  rrect(ctx, m.x - 1, m.y + 3.5, m.w + 2, m.h + 1, 32);
  ctx.fill();

  // Taç: parlak krem, kenarlara doğru hafif koyulaşır
  const base = ctx.createRadialGradient(m.x + m.w * 0.38, m.y + m.h * 0.3, 4, m.x + m.w / 2, m.y + m.h / 2, m.w * 0.74);
  base.addColorStop(0, "#FFFFFF");
  base.addColorStop(0.62, "#FBF3E2");
  base.addColorStop(1, "#E9DCC0");
  rrect(ctx, m.x, m.y, m.w, m.h, 31);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "#C9BA9C";
  ctx.stroke();

  // Dört yuvarlak tepecik: komşularına yumuşak gölge düşürür, bu gölgeler olukları oluşturur
  ctx.beginPath();
  rrect(ctx, m.x + 2, m.y + 2, m.w - 4, m.h - 4, 29);
  ctx.clip();
  const rx = (m.w - 20) / 4;
  const ry = (m.h - 18) / 4;
  const spots: [number, number][] = [
    [(m.x + 9 + cx) / 2, (m.y + 9 + cy) / 2],
    [(cx + m.x + m.w - 9) / 2, (m.y + 9 + cy) / 2],
    [(m.x + 9 + cx) / 2, (cy + m.y + m.h - 9) / 2],
    [(cx + m.x + m.w - 9) / 2, (cy + m.y + m.h - 9) / 2],
  ];
  ctx.shadowColor = "rgba(120,92,48,0.5)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 1;
  spots.forEach(([x, y], k) => {
    const w = rx * (1 + 0.1 * (rand(i * 7 + k) - 0.5));
    const h = ry * (1 + 0.1 * (rand(i * 11 + k) - 0.5));
    const g = ctx.createRadialGradient(x - w * 0.38, y - h * 0.42, 1, x, y, Math.max(w, h) * 1.2);
    g.addColorStop(0, "#FFFFFF");
    g.addColorStop(0.6, "#FFFCF4");
    g.addColorStop(1, "#F0E6D0");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  // Ortadaki küçük çukur (fissür noktası)
  ctx.fillStyle = "rgba(150,126,86,0.55)";
  ctx.beginPath();
  ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
  ctx.fill();
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
