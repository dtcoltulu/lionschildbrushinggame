import { domeFill, rrect, smoothClosed, splineSamples, taperedStroke, type Ctx, type Pt } from "./draw";
import { CHEW_KINDS, CHEW_TILES, rand, type CrownKind, type Rect } from "./layout";
import { bakeToCanvas, carvePath, createField, forEachPixel, lightField, softenHeight, spriteResolution, stampCarve, type Field, type Look } from "./shade";

/**
 * Çiğneme (üst) yüzeyleri: üstten bakınca gerçek azı/küçük azı dişi. Yalnızca görünüm; vuruş alanı `layout.ts`teki
 * dikdörtgenlerdir. Işık sol üsttendir (ekran uzayında), çene tarafı (`flipY`) yalnızca geometriyi çevirir.
 *
 * Yerel koordinat: u = diş boyunca (−1 öne/sola, +1 arkaya/sağa), v = yanaktan (−1) dile (+1) doğru; (0,0) merkezi çukur.
 */

interface Cusp {
  u: number;
  v: number;
  ru: number;
  rv: number;
}

interface Groove {
  pts: Pt[];
  width: number;
  /** 1 = ana oluk, daha küçük = ince yan fissür. */
  weight: number;
}

interface Anatomy {
  /** Dış hatta kullanılan süper elips üssü (büyük = kare, küçük = oval). */
  squareness: number;
  cusps: Cusp[];
  grooves: Groove[];
  /** Küçük çukurlar (fissür noktaları): [u, v, yarıçap]. */
  pits: [number, number, number][];
}

const ANATOMY: Record<CrownKind, Anatomy> = {
  // Küçük azı: iki tümsek (yanak ve dil), ortada uzunlamasına tek oluk, uçlarda çukur.
  premolar: {
    squareness: 2.5,
    cusps: [
      { u: -0.04, v: -0.44, ru: 0.92, rv: 0.58 },
      { u: 0.06, v: 0.46, ru: 0.8, rv: 0.5 },
    ],
    grooves: [
      { pts: [[-0.78, 0.02], [-0.42, -0.05], [-0.06, 0.03], [0.34, -0.03], [0.76, 0.02]], width: 3.2, weight: 1 },
      { pts: [[-0.74, 0.02], [-0.8, -0.2]], width: 1.6, weight: 0.4 },
      { pts: [[0.72, 0.02], [0.78, 0.2]], width: 1.6, weight: 0.4 },
    ],
    pits: [
      [-0.46, -0.04, 3.2],
      [0.38, -0.02, 3.2],
    ],
  },
  // Üst azı: dört tümsek, "H" biçimli oluklar, ortada fossa.
  molar4: {
    squareness: 3.3,
    cusps: [
      { u: -0.46, v: -0.46, ru: 0.58, rv: 0.58 },
      { u: 0.44, v: -0.48, ru: 0.56, rv: 0.56 },
      { u: -0.44, v: 0.46, ru: 0.58, rv: 0.56 },
      { u: 0.46, v: 0.46, ru: 0.56, rv: 0.56 },
    ],
    grooves: [
      { pts: [[-0.92, 0.04], [-0.55, -0.05], [-0.2, 0.04], [0.04, 0], [0.3, -0.04], [0.62, 0.05], [0.93, 0]], width: 3.4, weight: 1 },
      { pts: [[-0.06, -0.94], [-0.02, -0.62], [0.04, -0.3], [0.04, 0]], width: 3, weight: 0.9 },
      { pts: [[0.06, 0.94], [0.02, 0.62], [-0.04, 0.3], [0.04, 0]], width: 3, weight: 0.9 },
    ],
    pits: [
      [0.04, 0, 4.4],
      [0.04, -0.6, 2.8],
      [0.0, 0.6, 2.8],
    ],
  },
  // Alt birinci azı: beş tümsek (üç yanak, iki dil), "Y" biçimli ana olukla.
  molar5: {
    squareness: 3,
    cusps: [
      { u: -0.62, v: -0.5, ru: 0.42, rv: 0.52 },
      { u: 0.0, v: -0.52, ru: 0.42, rv: 0.52 },
      { u: 0.64, v: -0.46, ru: 0.4, rv: 0.48 },
      { u: -0.32, v: 0.5, ru: 0.6, rv: 0.54 },
      { u: 0.36, v: 0.46, ru: 0.6, rv: 0.54 },
    ],
    grooves: [
      { pts: [[-0.92, 0.08], [-0.52, 0.03], [-0.14, 0], [0.18, 0.02]], width: 3.4, weight: 1 },
      { pts: [[0.18, 0.02], [0.5, -0.2], [0.82, -0.42]], width: 2.8, weight: 0.85 },
      { pts: [[0.18, 0.02], [0.5, 0.26], [0.84, 0.46]], width: 2.8, weight: 0.85 },
      { pts: [[-0.3, -0.94], [-0.28, -0.5], [-0.14, -0.04]], width: 2.4, weight: 0.8 },
      { pts: [[0.32, -0.94], [0.3, -0.5], [0.18, 0.02]], width: 2.4, weight: 0.8 },
      { pts: [[-0.14, 0], [-0.06, 0.5], [-0.1, 0.94]], width: 2.6, weight: 0.85 },
    ],
    pits: [
      [-0.12, 0, 3.8],
      [0.2, 0.02, 3],
      [-0.28, -0.52, 2.4],
    ],
  },
};

/** Tacın dış hattı (yerel koordinat → dünya). Küçük, sabit "organik" bozulmalarla her diş biraz farklıdır. */
function outline(kind: CrownKind, project: (u: number, v: number) => Pt, seed: number): Pt[] {
  const n = ANATOMY[kind].squareness;
  const N = 44;
  const p1 = rand(seed * 1.7) * Math.PI * 2;
  const p2 = rand(seed * 2.9) * Math.PI * 2;
  const pts: Pt[] = [];
  for (let k = 0; k < N; k++) {
    const th = (Math.PI * 2 * k) / N;
    const c = Math.cos(th);
    const s = Math.sin(th);
    let u = Math.sign(c) * Math.abs(c) ** (2 / n);
    let v = Math.sign(s) * Math.abs(s) ** (2 / n);
    const m = 1 + 0.028 * Math.sin(3 * th + p1) + 0.02 * Math.sin(5 * th + p2);
    u *= m;
    v *= m;
    if (kind === "premolar") v *= 1 - 0.1 * u; // yumurta biçimi: arka uç daha dar
    else if (kind === "molar5") {
      v *= 1 - 0.07 * u; // arkaya doğru daralan beşgensi biçim
      if (u > 0) u *= 1.04;
    }
    pts.push(project(u, v));
  }
  return pts;
}

interface Frame {
  project: (u: number, v: number) => Pt;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

function frameOf(t: Rect, kind: CrownKind, flipY: boolean): Frame {
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const rx = t.w / 2 - 1.5;
  const ry = t.h / 2 - 1.5;
  const skew = kind === "molar4" ? 0.1 : 0; // üst azılar eşkenar dörtgene yakın
  return {
    cx,
    cy,
    rx,
    ry,
    project: (u, v) => [cx + rx * (u + skew * v), cy + ry * (flipY ? -v : v)],
  };
}

const crownPath = (ctx: Ctx, pts: Pt[]) => {
  ctx.beginPath();
  smoothClosed(ctx, pts);
};

/** Yedek (basit) çizim: piksel hesabı yapılamıyorsa (belge/tuval yok, hata) kullanılır; degrade + oluk çizgileri. */
function drawCrownFallback(ctx: Ctx, t: Rect, kind: CrownKind, flipY: boolean, seed: number): void {
  const A = ANATOMY[kind];
  const f = frameOf(t, kind, flipY);
  const pts = outline(kind, f.project, seed);
  const sy = flipY ? -1 : 1;

  ctx.save();
  // Taban: sıcak fildişi mine; sol üstte ışık, kenarlara doğru koyulaşır; altında hafif gölge
  ctx.shadowColor = "rgba(120,24,56,0.38)";
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 2;
  const base = ctx.createRadialGradient(f.cx - f.rx * 0.3, f.cy - f.ry * 0.35, 2, f.cx, f.cy, Math.max(f.rx, f.ry) * 1.1);
  base.addColorStop(0, "#FFFEF9");
  base.addColorStop(0.55, "#F6EDD6");
  base.addColorStop(1, "#E3D3AF");
  crownPath(ctx, pts);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Her şey tacın içinde kalsın
  crownPath(ctx, pts);
  ctx.clip();

  // Tümsek kubbeleri: sol üstte parlak, sağ altta gölgeli (komşu kubbelerin arası doğal olarak koyulaşır)
  for (const c of A.cusps) {
    const [x, y] = f.project(c.u, c.v);
    const rx = f.rx * c.ru;
    const ry = f.ry * c.rv;
    domeFill(ctx, x, y, rx * 1.02, ry * 1.02, -0.28, -0.32 * sy, [
      [0, "rgba(255,255,255,0.92)"],
      [0.42, "rgba(255,253,243,0.4)"],
      [0.78, "rgba(214,190,146,0.14)"],
      [1, "rgba(150,116,70,0.42)"],
    ]);
  }

  // Oluklar: yumuşak geniş gölge + orta ton + keskin çekirdek + alt-sağ kenarda ışık
  for (const g of A.grooves) {
    const s = splineSamples(g.pts.map(([u, v]) => f.project(u, v)), 6);
    const k = Math.min(f.rx, f.ry) / 40; // diş boyuna göre ölçek
    ctx.fillStyle = `rgba(122,86,44,${0.1 * g.weight})`;
    taperedStroke(ctx, s, g.width * 3.1 * k, 0.2, 0.3);
    ctx.fillStyle = `rgba(128,90,46,${0.26 * g.weight})`;
    taperedStroke(ctx, s, g.width * 1.7 * k, 0.2, 0.3);
    ctx.fillStyle = `rgba(86,56,26,${0.82 * g.weight})`;
    taperedStroke(ctx, s, g.width * 0.62 * k, 0.16, 0.24);
    ctx.save();
    ctx.translate(0.9, 0.9);
    ctx.fillStyle = `rgba(255,255,255,${0.6 * g.weight})`;
    taperedStroke(ctx, s, g.width * 0.38 * k, 0.2, 0.3);
    ctx.restore();
  }
  // Çukurlar
  for (const [u, v, r] of A.pits) {
    const [x, y] = f.project(u, v);
    const k = Math.min(f.rx, f.ry) / 40;
    domeFill(ctx, x, y, r * k * 1.9, r * k * 1.5, 0.1, 0.1, [
      [0, "rgba(70,44,20,0.85)"],
      [0.55, "rgba(110,78,40,0.45)"],
      [1, "rgba(120,86,46,0)"],
    ]);
  }

  // Kenar sırtı (marjinal sırt): kenarın hemen içinde parlak çizgi ve onun iç yanında ince koyu çizgi
  ctx.lineJoin = "round";
  ctx.save();
  ctx.translate(f.cx, f.cy);
  ctx.scale(0.9, 0.9);
  ctx.translate(-f.cx, -f.cy);
  crownPath(ctx, pts);
  ctx.restore();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.stroke();
  ctx.save();
  ctx.translate(f.cx, f.cy);
  ctx.scale(0.8, 0.8);
  ctx.translate(-f.cx, -f.cy);
  crownPath(ctx, pts);
  ctx.restore();
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = "rgba(150,118,76,0.2)";
  ctx.stroke();

  // Parlak ışık noktaları: her tümsekte sol üstte küçük, keskin yansıma
  for (const c of A.cusps) {
    const [x, y] = f.project(c.u, c.v);
    const rx = f.rx * c.ru;
    const ry = f.ry * c.rv;
    domeFill(ctx, x - rx * 0.34, y - ry * 0.4, rx * 0.2, ry * 0.15, 0, 0, [
      [0, "rgba(255,255,255,0.95)"],
      [1, "rgba(255,255,255,0)"],
    ]);
  }
  ctx.restore();

  // İnce dış çizgi: mine ile diş eti arasındaki sınır
  ctx.save();
  crownPath(ctx, pts);
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = "rgba(146,102,78,0.7)";
  ctx.stroke();
  ctx.restore();
}

// ---- Piksel gölgelendirmeli taç ------------------------------------------------------------

const SPRITE_MARGIN = 3;
/** Işık sol üstten; mine parlaktır (güçlü ama dar parlama), vadiler (oluk, tümsek araları) ortam örtülmesiyle koyulaşır. */
const CROWN_LOOK: Look = {
  light: [-0.42, -0.58, 0.7],
  ambient: 0.66,
  bump: 1.1,
  specStrength: 0.36,
  specPower: 38,
  ao: 0.55,
  aoRadius: 3.5,
  tint: [0.6, 0.48, 0.38],
  albedo: (_x, _y, carve, sd, out) => {
    const stain = Math.min(1, carve / 3) * 0.55; // oluk içi hafif kahverengi leke
    const rim = Math.max(0, Math.min(1, 1 - sd / 4)); // kenara doğru sıcak ton (mine inceliyor)
    out[0] = (255 + (243 - 255) * rim) * (1 - stain) + 150 * stain;
    out[1] = (250 + (230 - 250) * rim) * (1 - stain) + 104 * stain;
    out[2] = (238 + (200 - 238) * rim) * (1 - stain) + 56 * stain;
  },
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Dış hattın (u,v) uzayındaki işaretli uzaklığı: [R − ρ (iç pozitif, normalize), ρ/R]. `outline()` ile aynı biçim.
 * Yarıçap R(θ) bir kez tabloya alınır; piksel başına yalnızca atan2 + tablo okuma yapılır.
 */
function makeShape(kind: CrownKind, seed: number): (u: number, v: number) => [number, number] {
  const n = ANATOMY[kind].squareness;
  const p1 = rand(seed * 1.7) * Math.PI * 2;
  const p2 = rand(seed * 2.9) * Math.PI * 2;
  const N = 512;
  const table = new Float32Array(N + 1);
  for (let k = 0; k <= N; k++) {
    const th = (k / N) * Math.PI * 2 - Math.PI;
    const c = Math.abs(Math.cos(th));
    const s = Math.abs(Math.sin(th));
    table[k] = Math.pow(Math.pow(c, n) + Math.pow(s, n), -1 / n) * (1 + 0.028 * Math.sin(3 * th + p1) + 0.02 * Math.sin(5 * th + p2));
  }
  const out: [number, number] = [0, 0];
  return (u, v) => {
    let uu = u;
    let vv = v;
    if (kind === "molar5" && uu > 0) uu /= 1.04;
    if (kind === "premolar") vv /= 1 - 0.1 * uu;
    else if (kind === "molar5") vv /= 1 - 0.07 * uu;
    const rho = Math.sqrt(uu * uu + vv * vv);
    const f = ((Math.atan2(vv, uu) + Math.PI) / (Math.PI * 2)) * N;
    const i0 = f | 0;
    const R = table[i0]! + (table[Math.min(N, i0 + 1)]! - table[i0]!) * (f - i0);
    out[0] = R - rho;
    out[1] = rho / R;
    return out;
  };
}

function crownField(kind: CrownKind, w: number, h: number, flipY: boolean, seed: number, res: number): Field {
  const M = SPRITE_MARGIN;
  const F = createField(w + 2 * M, h + 2 * M, res);
  const cx = M + w / 2;
  const cy = M + h / 2;
  const rx = w / 2 - 1.5;
  const ry = h / 2 - 1.5;
  const skew = kind === "molar4" ? 0.1 : 0;
  const A = ANATOMY[kind];
  const shape = makeShape(kind, seed);
  const k = Math.min(rx, ry) / 40;
  const rBar = (rx + ry) / 2;
  const amp = kind === "premolar" ? 8 : 9.4;

  forEachPixel(F, (x, y, i) => {
    let v = (y - cy) / ry;
    if (flipY) v = -v;
    const u = (x - cx) / rx - skew * v;
    const [d, t] = shape(u, v);
    const sd = d * rBar;
    F.sd[i] = sd;
    if (sd < -2) return;
    let hc = 0;
    for (const c of A.cusps) {
      const du = (u - c.u) / c.ru;
      const dv = (v - c.v) / c.rv;
      const q = du * du + dv * dv;
      if (q < 1) {
        const hd = amp * (1 - q) * (1 + 0.15 * q); // ≈ (1−q)^0.85, pow'suz
        if (hd > hc) hc = hd;
      }
    }
    const h0 = 2.6 * Math.sqrt(Math.max(0, 1 - t * t));
    const edge = smoothstep(0, 4, sd);
    const rr = (t - 0.86) / 0.09;
    const ridge = rr * rr < 1 ? 1.4 * (1 - rr * rr) * (1 - rr * rr) : 0;
    F.h[i] = (h0 + hc) * Math.sqrt(edge) + ridge * edge;
  });
  softenHeight(F, 0.6);

  const P = (u: number, v: number): [number, number] => [cx + rx * (u + skew * v), cy + ry * (flipY ? -v : v)];
  for (const g of A.grooves) carvePath(F, splineSamples(g.pts.map(([u, v]) => P(u, v)), 4), g.width * 0.42 * k, 2.3 * g.weight, 0.22);
  for (const [u, v, r] of A.pits) {
    const [x, y] = P(u, v);
    stampCarve(F, x, y, r * k * 0.7, 3.4);
  }
  for (let i = 0; i < F.h.length; i++) F.h[i] = F.h[i]! - F.carve[i]!;
  return F;
}

/** Saf hesap: bir tacın aydınlatılmış RGBA pikselleri (tarayıcı gerekmez; test ve ölçüm için). */
export function crownPixels(kind: CrownKind, w: number, h: number, flipY: boolean, seed: number, res: number): { pixels: Uint8ClampedArray; W: number; H: number } {
  const F = crownField(kind, w, h, flipY, seed, res);
  return { pixels: lightField(F, CROWN_LOOK), W: F.W, H: F.H };
}

const crownSprites = new Map<string, HTMLCanvasElement | null>();
let spritesRes = 0;

/** Çiğneme dişi `i`nin anatomisi: tür, çene yönü (ikinci sıra ters), tohum. */
function chewSpec(i: number) {
  return { kind: CHEW_KINDS[i]!, flipY: i % 6 >= 3, seed: i + 1 };
}

function ensureSprite(i: number, res: number): HTMLCanvasElement | null {
  if (res !== spritesRes) {
    crownSprites.clear();
    spritesRes = res;
  }
  const t = CHEW_TILES[i]!;
  const sp = chewSpec(i);
  const key = String(i);
  let sprite = crownSprites.get(key);
  if (sprite === undefined) {
    const px = crownPixels(sp.kind, t.w, t.h, sp.flipY, sp.seed, res);
    sprite = bakeToCanvas(px.pixels, px.W, px.H);
    crownSprites.set(key, sprite);
  }
  return sprite;
}

/**
 * Çiğneme dişlerinin sprite'larını arka planda hazırlar: çağrı başına en az bir diş, `budgetMs` dolana kadar.
 * Hepsi hazırsa true döner. (Oyun açılınca/öğreticide kareler arasında çağrılır; çiğneme aşamasında takılma olmasın.)
 */
export function warmCrowns(res: number, budgetMs: number): boolean {
  if (typeof performance === "undefined") return true;
  const t0 = performance.now();
  for (let i = 0; i < CHEW_TILES.length; i++) {
    if (res === spritesRes && crownSprites.has(String(i))) continue;
    ensureSprite(i, res);
    if (performance.now() - t0 >= budgetMs) return false;
  }
  return true;
}

/** Çiğneme aşamasının dişlerini çizer. `halo`: yalnızca diş eti halkası (önce tüm dişler için, sonra dişlerin kendisi). */
export function drawChewTiles(ctx: Ctx, halo: boolean): void {
  const res = spriteResolution();
  CHEW_TILES.forEach((t, i) => {
    const sprite = ensureSprite(i, res);
    if (!sprite) {
      if (!halo) drawCrownFallback(ctx, t, CHEW_KINDS[i]!, chewSpec(i).flipY, chewSpec(i).seed);
      return;
    }
    ctx.save();
    if (halo) {
      // Diş etinin taca değdiği yerdeki yumuşak koyu pembe halka (komşunun kenarını kirletmesin diye tüm dişler için önce)
      ctx.shadowColor = "rgba(178,34,78,0.62)";
      ctx.shadowBlur = 16;
    } else {
      ctx.shadowColor = "rgba(120,24,56,0.45)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
    }
    ctx.drawImage(sprite, t.x - SPRITE_MARGIN, t.y - SPRITE_MARGIN, sprite.width / res, sprite.height / res);
    ctx.restore();
  });
}

/** Bir çenenin diş eti levhası: kabarık, parlak, hafif dokulu pembe zemin (dişler üstüne oturur). */
export function drawJawSlab(ctx: Ctx, r: Rect, seed: number): void {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w * 0.4, r.y + r.h);
  g.addColorStop(0, "#FFA5B7");
  g.addColorStop(0.5, "#FA8399");
  g.addColorStop(1, "#EE6A86");
  rrect(ctx, r.x, r.y, r.w, r.h, 54);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  rrect(ctx, r.x, r.y, r.w, r.h, 54);
  ctx.clip();
  // Üst kenarda parlama, alt kenarda koyu ton: levha kabarık görünür
  const gloss = ctx.createLinearGradient(0, r.y, 0, r.y + r.h * 0.35);
  gloss.addColorStop(0, "rgba(255,255,255,0.42)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(r.x, r.y, r.w, r.h * 0.35);
  const deep = ctx.createLinearGradient(0, r.y + r.h * 0.7, 0, r.y + r.h);
  deep.addColorStop(0, "rgba(160,30,70,0)");
  deep.addColorStop(1, "rgba(160,30,70,0.28)");
  ctx.fillStyle = deep;
  ctx.fillRect(r.x, r.y + r.h * 0.7, r.w, r.h * 0.3);
  // İnce doku: açık ve koyu benekler
  for (let i = 0; i < 260; i++) {
    const x = r.x + 6 + rand(seed * 3 + i * 1.7) * (r.w - 12);
    const y = r.y + 6 + rand(seed * 5 + i * 2.3) * (r.h - 12);
    const light = i % 2 === 0;
    ctx.fillStyle = light ? "rgba(255,225,232,0.16)" : "rgba(170,40,80,0.1)";
    ctx.beginPath();
    ctx.arc(x, y, 0.6 + rand(seed * 7 + i * 3.1) * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  rrect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 53);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(190,52,92,0.55)";
  ctx.stroke();
}
