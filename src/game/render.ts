import { BRUSH_RADIUS, WORLD_H, WORLD_W } from "./constants";
import { rrect, type Ctx } from "./draw";
import type { GameEngine } from "./engine";
import {
  CHEW_SLABS,
  LOWER_TEETH,
  MOUTH,
  MOUTH_IN,
  rand,
  TONGUE,
  toothRank,
  UPPER_TEETH,
} from "./layout";
import { BG, C, FACE } from "./palette";
import { drawGumSprite, drawTongueSprite, FLOOR_THIN, warmGums } from "./gums";
import { drawChewTiles, drawJawSlab, warmCrowns } from "./occlusal";
import { quantizeRes, setDeviceScale, spriteResolution } from "./shade";
import { drawTeethRow, warmTeeth } from "./toothsprite";
import { drawTutorialToothSprite } from "./tutorialtooth";
import { drawTooth, drawTutorialTooth, FLOOR, FRONT_TOOTH, GUM, INNER_TOOTH, PALATE } from "./teeth";
import type { PatchState, PhaseKind } from "./types";

// ---- Yüz ve ağız -----------------------------------------------------------------

/** Sevimli büyük yüz: gözler, kaşlar, yanaklar. Çocuk bu yüzün dişlerini temizler. */
function drawFace(ctx: Ctx, kind: PhaseKind) {
  const tint = FACE[kind] ?? FACE.outer!;
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.ellipse(180, 290, 214, 300, 0, 0, Math.PI * 2);
  ctx.fill();
  // yanaklar
  ctx.fillStyle = "rgba(255,143,163,0.35)";
  for (const x of [26, 334]) {
    ctx.beginPath();
    ctx.arc(x, 128, 26, 0, Math.PI * 2);
    ctx.fill();
  }
  // kaşlar
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  for (const x of [112, 248]) {
    ctx.beginPath();
    ctx.arc(x, 62, 34, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
  }
  // gözler
  for (const x of [112, 248]) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(x, 60, 24, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1c1038";
    ctx.beginPath();
    ctx.arc(x, 70, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x + 4, 65, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // burun
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.beginPath();
  ctx.ellipse(180, 118, 11, 7, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * İç yüzey aşamasında yüz dönmüştür: gözler yerine kafanın arkası ve saçlar görünür
 * (kulaklar, saç tutamları, tepede bir kıvrım ve altın tokası).
 */
function drawHeadBack(ctx: Ctx) {
  const tint = FACE.inner!;
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.ellipse(180, 290, 214, 300, 0, 0, Math.PI * 2);
  ctx.fill();

  // kulaklar (yüzün iki yanında)
  for (const [x, dir] of [[26, -1], [334, 1]] as const) {
    ctx.fillStyle = "#166B7D";
    ctx.beginPath();
    ctx.ellipse(x, 196, 24, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x + dir * -2, 196, 11, Math.PI * 0.3, Math.PI * 1.7, dir > 0);
    ctx.stroke();
  }

  // saç: tepeyi ve alın hizasını (gözlerin olduğu yeri) kaplar, altı dalgalı
  const hair = "#231F4F";
  const hairLight = "#4A4699";
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(180, 290, 214, 300, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.moveTo(-40, -10);
  ctx.lineTo(400, -10);
  ctx.lineTo(400, 122);
  // dalgalı alt kenar (sağdan sola)
  for (let i = 0; i < 8; i++) {
    const x1 = 400 - i * 55;
    const x2 = x1 - 55;
    ctx.quadraticCurveTo((x1 + x2) / 2, i % 2 ? 100 : 156, x2, 122 + (i % 2 ? -4 : 6));
  }
  ctx.lineTo(-40, 122);
  ctx.closePath();
  ctx.fill();

  // saç telleri (açık renk vurgu çizgileri)
  ctx.strokeStyle = hairLight;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  for (let i = 0; i < 9; i++) {
    const x = 20 + i * 40;
    ctx.beginPath();
    ctx.moveTo(x, 8);
    ctx.quadraticCurveTo(x + (i % 2 ? 16 : -16), 52, x + (i % 2 ? 6 : -6), 108);
    ctx.stroke();
  }
  ctx.restore();

  // saçın parlak vurgusu: tepede yumuşak bir yay
  ctx.strokeStyle = "rgba(160,150,255,0.35)";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(70, 70);
  ctx.quadraticCurveTo(180, 18, 290, 70);
  ctx.stroke();

  // tepede sevimli kıvrım / tüy tutamı (açık renk, koyu saçın üstünde belli olsun)
  ctx.strokeStyle = hairLight;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(150, 74);
  ctx.bezierCurveTo(138, 26, 200, 14, 196, 52);
  ctx.bezierCurveTo(194, 70, 172, 66, 176, 52);
  ctx.stroke();

  // altın toka (yıldız)
  ctx.fillStyle = C.gold;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 17 : 7.5;
    const a = -Math.PI / 2 + (Math.PI * i) / 5;
    ctx.lineTo(256 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#D99A00";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawMouthFrame(ctx: Ctx, kind: PhaseKind) {
  if (kind === "inner") drawHeadBack(ctx);
  else drawFace(ctx, kind);
  ctx.fillStyle = C.lip;
  rrect(ctx, MOUTH.x, MOUTH.y, MOUTH.w, MOUTH.h, 96);
  ctx.fill();
  ctx.fillStyle = C.mouth;
  rrect(ctx, MOUTH_IN.x, MOUTH_IN.y, MOUTH_IN.w, MOUTH_IN.h, 84);
  ctx.fill();
}

function clipMouth(ctx: Ctx) {
  rrect(ctx, MOUTH_IN.x, MOUTH_IN.y, MOUTH_IN.w, MOUTH_IN.h, 84);
  ctx.clip();
}

function drawFrontTeeth(ctx: Ctx, kind: PhaseKind, inner: boolean) {
  drawMouthFrame(ctx, kind);
  ctx.save();
  clipMouth(ctx);
  const res = spriteResolution();
  if (inner) {
    // İç yüz: dil (dişlerin arkasında)
    drawTongueSprite(ctx, "inner", res, () => {
      ctx.fillStyle = C.tongue;
      ctx.beginPath();
      ctx.ellipse(180, 400, 176, 104, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  // Önce dişler (boyunları diş etinin altına uzanır), sonra kıvrımlı diş eti şeridi üstlerine biner.
  const pal = inner ? INNER_TOOTH : FRONT_TOOTH;
  const view = inner ? "inner" : "front";
  drawTeethRow(ctx, UPPER_TEETH, true, view, res, (t, i) => drawTooth(ctx, t, toothRank(i), true, pal, inner, i < 6 ? -1 : 1));
  drawTeethRow(ctx, LOWER_TEETH, false, view, res, (t, i) => drawTooth(ctx, t, toothRank(i), false, pal, inner, i < 6 ? -1 : 1));
  drawGumSprite(ctx, inner ? "palate" : "front", UPPER_TEETH, true, MOUTH_IN, res, inner ? PALATE : GUM);
  if (inner) drawGumSprite(ctx, "floor", LOWER_TEETH, false, MOUTH_IN, res, FLOOR, FLOOR_THIN);
  else drawGumSprite(ctx, "front", LOWER_TEETH, false, MOUTH_IN, res, GUM);
  ctx.restore();
}

function drawOuter(ctx: Ctx) {
  drawFrontTeeth(ctx, "outer", false);
}
function drawGaps(ctx: Ctx) {
  drawFrontTeeth(ctx, "gaps", false);
}
function drawFloss(ctx: Ctx) {
  drawFrontTeeth(ctx, "floss", false);
}
function drawInner(ctx: Ctx) {
  drawFrontTeeth(ctx, "inner", true);
}

function drawChewing(ctx: Ctx) {
  CHEW_SLABS.forEach((r, i) => drawJawSlab(ctx, r, i + 1));
  drawChewTiles(ctx, true);
  drawChewTiles(ctx, false);
}

function drawTongue(ctx: Ctx) {
  drawMouthFrame(ctx, "tongue");
  ctx.save();
  clipMouth(ctx);
  // Gerçekçi, papillalı, ıslak parlak dil (sprite); üretilemezse eski düz dil
  drawTongueSprite(ctx, "scene", spriteResolution(), () => {
    const g = ctx.createLinearGradient(0, TONGUE.y, 0, TONGUE.y + TONGUE.h);
    g.addColorStop(0, "#FF8FA3");
    g.addColorStop(1, "#E5607A");
    ctx.fillStyle = g;
    rrect(ctx, TONGUE.x, TONGUE.y, TONGUE.w, TONGUE.h, 120);
    ctx.fill();
    ctx.strokeStyle = "rgba(120,20,50,0.35)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(180, TONGUE.y + 30);
    ctx.lineTo(180, TONGUE.y + TONGUE.h - 30);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    for (let i = 0; i < 46; i++) {
      const x = TONGUE.x + 30 + rand(i * 2.3) * (TONGUE.w - 60);
      const y = TONGUE.y + 26 + rand(i * 4.1) * (TONGUE.h - 52);
      ctx.beginPath();
      ctx.arc(x, y, 2 + rand(i * 7.7) * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
}

const SCENES: Record<PhaseKind, (ctx: Ctx) => void> = {
  outer: drawOuter,
  gaps: drawGaps,
  inner: drawInner,
  chewing: drawChewing,
  tongue: drawTongue,
  floss: drawFloss,
  tutorial: (ctx) => drawTutorialToothSprite(ctx, spriteResolution(), () => drawTutorialTooth(ctx)),
};

// ---- Artıklar: plak, çikolata, cips, dil pası, mikrop ------------------------------

function blobs(ctx: Ctx, p: PatchState, n: number, fill: string) {
  ctx.fillStyle = fill;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + p.seed * 6;
    const d = p.r * (0.3 + rand(p.seed * 10 + i) * 0.35);
    const rr = p.r * (0.45 + rand(p.seed * 20 + i) * 0.3);
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r * 0.72, 0, Math.PI * 2);
  ctx.fill();
}

function specks(ctx: Ctx, p: PatchState, n: number, fill: string) {
  ctx.fillStyle = fill;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(
      p.x + (rand(p.seed * 30 + i) - 0.5) * p.r * 1.3,
      p.y + (rand(p.seed * 40 + i) - 0.5) * p.r * 1.3,
      1.5 + rand(p.seed * 50 + i) * 2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function drawPlaque(ctx: Ctx, p: PatchState) {
  blobs(ctx, p, 6, `rgba(${C.plaque},0.94)`);
  specks(ctx, p, 4, `rgba(${C.plaqueDark},0.55)`);
}

function drawChocolate(ctx: Ctx, p: PatchState) {
  blobs(ctx, p, 5, "rgba(84,48,26,0.96)");
  specks(ctx, p, 3, "rgba(140,92,54,0.8)");
  // küçük çikolata parçası
  ctx.save();
  ctx.translate(p.x + p.r * 0.1, p.y - p.r * 0.05);
  ctx.rotate((p.seed - 0.5) * 1.2);
  const w = p.r * 0.85;
  const h = p.r * 0.62;
  ctx.fillStyle = "#6B3A1F";
  rrect(ctx, -w / 2, -h / 2, w, h, 2.5);
  ctx.fill();
  ctx.strokeStyle = "#3F1F0D";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.lineTo(0, h / 2);
  ctx.moveTo(-w / 2, 0);
  ctx.lineTo(w / 2, 0);
  ctx.stroke();
  ctx.restore();
}

function drawChips(ctx: Ctx, p: PatchState) {
  blobs(ctx, p, 4, "rgba(240,190,80,0.4)");
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * 2 * i) / 6 + p.seed * 5;
    const d = p.r * (0.2 + rand(p.seed * 60 + i) * 0.55);
    const cx = p.x + Math.cos(a) * d;
    const cy = p.y + Math.sin(a) * d;
    const s = p.r * (0.3 + rand(p.seed * 70 + i) * 0.2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rand(p.seed * 80 + i) * Math.PI * 2);
    ctx.fillStyle = "#F2B33D";
    ctx.strokeStyle = "#C98A12";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-s, s * 0.7);
    ctx.quadraticCurveTo(0, -s * 1.2, s, s * 0.7);
    ctx.quadraticCurveTo(0, s * 0.2, -s, s * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawCoating(ctx: Ctx, p: PatchState) {
  blobs(ctx, p, 6, "rgba(246,238,206,0.94)");
  ctx.strokeStyle = "rgba(190,170,110,0.65)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r * 0.95, 0, Math.PI * 2);
  ctx.stroke();
  specks(ctx, p, 4, "rgba(200,180,120,0.7)");
}

function drawDebris(ctx: Ctx, p: PatchState, alpha: number) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  switch (p.kind) {
    case "chocolate":
      drawChocolate(ctx, p);
      break;
    case "chips":
      drawChips(ctx, p);
      break;
    case "coating":
      drawCoating(ctx, p);
      break;
    default:
      drawPlaque(ctx, p); // plak ve mikrop (mikrop karakteri ayrıca çizilir)
  }
  ctx.restore();
}

function drawGerm(ctx: Ctx, p: PatchState, t: number, reduced: boolean) {
  const flee = p.done ? Math.min(1, p.cleanedFor / 450) : 0;
  const scale = (1 - p.clean * 0.45) * (1 - flee * 0.6);
  const alpha = 1 - flee;
  if (alpha <= 0.02) return;
  const wob = reduced ? 0 : Math.sin(t / 220 + p.seed * 8) * 2;
  const cx = p.x;
  const cy = p.y - flee * (reduced ? 0 : 60) + wob;
  const r = p.r * 0.62 * scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = C.germDark;
  for (let i = 0; i < 9; i++) {
    const a = (Math.PI * 2 * i) / 9;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r * 1.05, cy + Math.sin(a) * r * 1.05, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = C.germ;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // gözler
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(cx - r * 0.35, cy - r * 0.15, r * 0.26, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.35, cy - r * 0.15, r * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1b1b2f";
  const look = flee > 0 ? -0.05 : 0.04;
  ctx.beginPath();
  ctx.arc(cx - r * 0.35, cy - r * 0.15 + r * look * 2, r * 0.12, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.35, cy - r * 0.15 + r * look * 2, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
  // ağız
  ctx.strokeStyle = "#1b1b2f";
  ctx.lineWidth = Math.max(1.5, r * 0.09);
  ctx.lineCap = "round";
  ctx.beginPath();
  if (flee > 0) {
    ctx.arc(cx, cy + r * 0.42, r * 0.16, 0, Math.PI * 2);
  } else {
    ctx.arc(cx, cy + r * 0.35, r * 0.28, Math.PI * 1.1, Math.PI * 1.9);
  }
  ctx.stroke();
  ctx.restore();
}

// ---- İpucu, fırça, diş ipi ------------------------------------------------------------

function drawHint(ctx: Ctx, p: PatchState, t: number, vertical: boolean) {
  const pulse = 0.5 + 0.5 * Math.sin(t / 260);
  ctx.save();
  ctx.strokeStyle = `rgba(245,184,0,${0.5 + pulse * 0.5})`;
  ctx.lineWidth = 4;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r + 8 + pulse * 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  const m = Math.sin(t / 240) * Math.max(p.r, 14) * 0.9;
  drawFinger(ctx, vertical ? p.x : p.x + m, vertical ? p.y + m : p.y + 6, 1);
  ctx.restore();
}

/** Yönlendirici parmak: yarı saydam beyaz daire + halka. */
export function drawFinger(ctx: Ctx, x: number, y: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(x, y, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 19, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawBrush(ctx: Ctx, x: number, y: number, down: boolean, t: number, reduced: boolean) {
  const wiggle = down && !reduced ? Math.sin(t / 55) * 0.06 : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.55 + wiggle);
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 8;
  const grad = ctx.createLinearGradient(0, -6, 0, 6);
  grad.addColorStop(0, C.gold);
  grad.addColorStop(1, "#D99A00");
  ctx.fillStyle = grad;
  rrect(ctx, 14, -6, 96, 12, 6);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = C.purpleMid;
  rrect(ctx, -22, -9, 44, 18, 8);
  ctx.fill();
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 6; i++) {
    rrect(ctx, -19 + i * 7, -19, 4.5, 12, 2);
    ctx.fill();
  }
  ctx.fillStyle = C.mint;
  for (let i = 0; i < 6; i += 2) {
    rrect(ctx, -19 + i * 7, -19, 4.5, 5, 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Diş ipi: iki parmak arasında gerilmiş beyaz ip. İpin ortası (x,y) noktasıdır. */
function drawFlossTool(ctx: Ctx, x: number, y: number, down: boolean, t: number, reduced: boolean) {
  const sag = down && !reduced ? 3 + Math.sin(t / 60) * 2 : 5;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 6;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - 26, y - 14);
  ctx.quadraticCurveTo(x, y + sag, x + 26, y - 14);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // iki tutma noktası (parmaklar)
  for (const dx of [-30, 30]) {
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.arc(x + dx, y - 20, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#D99A00";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // kutu
  ctx.fillStyle = C.mint;
  rrect(ctx, x - 12, y - 58, 24, 24, 6);
  ctx.fill();
  ctx.fillStyle = "#fff";
  rrect(ctx, x - 7, y - 53, 14, 14, 3);
  ctx.fill();
  ctx.restore();
}

// ---- Ana çizim -------------------------------------------------------------

export interface RenderOptions {
  reducedMotion: boolean;
  /** Eğitim ekranında hareketsizken gösterilen yönlendirici el. */
  showTutorialHand: boolean;
  /** Sahne önbelleği (varsayılan açık). Yalnızca testlerde/karşılaştırmada kapatılır. */
  cache?: boolean;
}

// ---- Sahne önbelleği -------------------------------------------------------------
// Yüz, ağız ve dişler oyun boyunca değişmez ama çizimi pahalıdır (degradeler, gölgeler). Her karede yeniden çizmek yerine
// bir kez ayrı bir tuvale çizilir, sonra her karede tek `drawImage` ile basılır. Ekran boyutu ya da aşama türü
// değişince yeniden çizilir. Önbellek her canvas'a özeldir (öğretici ve oyun tuvali birbirini bozmaz).

/** Sahnenin kapladığı dünya alanı (yüz elipsi dünya sınırının biraz dışına taşar). */
const SCENE_AREA = { x: -40, y: -16, w: WORLD_W + 80, h: WORLD_H + 108 };
/** Çok büyük ekranlarda bellek şişmesin: bundan büyük önbellek kurulmaz, doğrudan çizilir. */
const MAX_CACHE_PIXELS = 12_000_000;

interface SceneCache {
  key: string;
  canvas: HTMLCanvasElement;
  /** Önbellek tuvalinin sol-üst köşesinin ekrandaki (cihaz pikseli) tam sayı konumu. */
  dx: number;
  dy: number;
}
const sceneCaches = new WeakMap<Ctx, SceneCache>();

function buildSceneCache(kind: PhaseKind, base: DOMMatrix, key: string): SceneCache | null {
  if (typeof document === "undefined") return null;
  // Yalnızca ölçek + öteleme (GameCanvas böyle kurar); başka bir dönüşümde doğrudan çizilir.
  if (base.b !== 0 || base.c !== 0 || !(base.a > 0) || !(base.d > 0)) return null;
  const x0 = Math.floor(base.e + base.a * SCENE_AREA.x);
  const y0 = Math.floor(base.f + base.d * SCENE_AREA.y);
  const w = Math.ceil(base.e + base.a * (SCENE_AREA.x + SCENE_AREA.w)) - x0;
  const h = Math.ceil(base.f + base.d * (SCENE_AREA.y + SCENE_AREA.h)) - y0;
  if (!(w > 0) || !(h > 0) || w * h > MAX_CACHE_PIXELS) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const cctx = canvas.getContext("2d");
  if (!cctx) return null;
  // Dünya (X,Y) önbellekte, doğrudan çizimdeki cihaz konumuna tam oturacak şekilde çizilir.
  cctx.setTransform(base.a, 0, 0, base.d, base.e - x0, base.f - y0);
  SCENES[kind](cctx);
  return { key, canvas, dx: x0, dy: y0 };
}

/**
 * Sahneyi çizer. `base`: bu karenin başındaki (yüz dönme ölçeği uygulanmadan önceki) dönüşüm.
 * `crisp`: ek ölçek yok; önbellek tam piksel hizasında basılır (bulanıklık olmaz).
 */
function drawScene(ctx: Ctx, kind: PhaseKind, base: DOMMatrix | null, crisp: boolean, useCache: boolean): void {
  if (!base || !useCache) {
    SCENES[kind](ctx);
    return;
  }
  const key = `${kind}|${base.a}|${base.d}|${base.e}|${base.f}`;
  let cache = sceneCaches.get(ctx) ?? null;
  if (!cache || cache.key !== key) {
    cache = buildSceneCache(kind, base, key);
    if (cache) sceneCaches.set(ctx, cache);
    else sceneCaches.delete(ctx);
  }
  if (!cache) {
    SCENES[kind](ctx);
    return;
  }
  if (crisp) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cache.canvas, cache.dx, cache.dy);
    ctx.restore();
  } else {
    // Yüz dönerken: önbellek dünya koordinatında, o anki (yatay daralmış) dönüşümle basılır.
    ctx.drawImage(cache.canvas, (cache.dx - base.e) / base.a, (cache.dy - base.f) / base.d, cache.canvas.width / base.a, cache.canvas.height / base.d);
  }
}

// ---- Önceden hazırlama ---------------------------------------------------------------
// Gerçekçi diş sprite'ları (yükseklik haritasından ışık hesabı) ağırdır; ilk kez gerektiği anda hesaplanırsa takılma olur.
// Bu yüzden öğretici/ilk aşamalar sırasında, kareler arasında az az (her 4.–16. karede bir sprite) önceden hazırlanır.
// Gerekirse sprite ilk kullanımda zaten hesaplanır (hazırlık yalnızca takılmayı önler).
let warmTick = 0;
function warmArt(base: DOMMatrix | null, engine: GameEngine): void {
  if (!base) return;
  // Parmak boştayken her 4. karede, fırçalarken her 16. karede bir sprite (takılma hissedilmesin)
  if ((++warmTick & (engine.brushDown ? 15 : 3)) !== 0) return;
  const res = quantizeRes(base.a);
  // Sırayla: önce ilk aşamaların dişleri, sonra diş eti/dil, en son çiğneme dişleri; her çağrıda yalnızca biri ilerler
  if (!warmTeeth(UPPER_TEETH, LOWER_TEETH, res, 6)) return;
  if (!warmGums(UPPER_TEETH, LOWER_TEETH, MOUTH_IN, res, 6)) return;
  warmCrowns(res, 6);
}

/** Canvas'ı tek karede çizer. `ctx` dünya koordinatlarına (WORLD_W x WORLD_H) hazır olmalı. */
export function renderFrame(ctx: Ctx, engine: GameEngine, t: number, opts: RenderOptions): void {
  const kind = engine.currentKind;
  const base = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  if (base) setDeviceScale(base.a);
  const [c1, c2] = BG[kind] ?? BG.outer!;
  const bg = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  bg.addColorStop(0, c1);
  bg.addColorStop(1, c2);
  ctx.fillStyle = bg;
  ctx.fillRect(-2000, -2000, 4000 + WORLD_W, 4000 + WORLD_H);

  // Yüz dönerken (dış/diş araları → iç yüzey) sahne ve lekeler yatayda daralıp yeniden açılır.
  const sx = opts.reducedMotion ? 1 : engine.turnScale;
  ctx.save();
  if (sx !== 1) {
    const hop = Math.sin(engine.transitionProgress * Math.PI) * -10; // dönerken hafifçe yukarı
    ctx.translate(WORLD_W / 2, WORLD_H / 2 + hop);
    ctx.scale(sx, 1);
    ctx.translate(-WORLD_W / 2, -WORLD_H / 2);
  }
  drawScene(ctx, kind, base, sx === 1, opts.cache !== false);

  for (const p of engine.patches) {
    const fade = p.done ? Math.max(0, 1 - p.cleanedFor / 350) : 1 - p.clean * 0.92;
    drawDebris(ctx, p, fade);
  }
  for (const p of engine.patches) if (p.kind === "germ") drawGerm(ctx, p, t, opts.reducedMotion);
  ctx.restore();

  if (engine.status === "transition" && !engine.turning && !opts.reducedMotion) drawSheen(ctx, engine.transitionProgress);

  const floss = kind === "floss";
  if (engine.hintIndex !== null && engine.status === "playing") {
    const p = engine.patches[engine.hintIndex];
    if (p) drawHint(ctx, p, t, floss);
  }

  if (opts.showTutorialHand && engine.status === "playing" && engine.idle > 900 && !engine.brushDown) {
    const p = engine.patches.find((q) => !q.done);
    if (p) drawFinger(ctx, p.x + Math.sin(t / 260) * p.r * 0.85, p.y + 8, 1);
  }

  for (const s of engine.sparkles) {
    const k = 1 - s.life / s.max;
    ctx.fillStyle = `hsla(${s.hue},95%,62%,${k})`;
    star(ctx, s.x, s.y, s.size * (0.6 + k * 0.6));
  }

  if (engine.brush && engine.status === "playing") {
    if (engine.brushDown) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(engine.brush.x, engine.brush.y, BRUSH_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (floss) drawFlossTool(ctx, engine.brush.x, engine.brush.y, engine.brushDown, t, opts.reducedMotion);
    else drawBrush(ctx, engine.brush.x, engine.brush.y, engine.brushDown, t, opts.reducedMotion);
  }
  if (opts.cache !== false) warmArt(base, engine);
}

function star(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rad = i % 2 === 0 ? r : r * 0.4;
    const a = (Math.PI * i) / 4;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}

function drawSheen(ctx: Ctx, progress: number) {
  const x = -80 + progress * (WORLD_W + 160);
  const g = ctx.createLinearGradient(x - 60, 0, x + 60, 0);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.5, "rgba(255,255,255,0.4)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.save();
  ctx.transform(1, 0, -0.3, 1, 0, 0);
  ctx.fillRect(x - 60, 0, 120, WORLD_H);
  ctx.restore();
}
