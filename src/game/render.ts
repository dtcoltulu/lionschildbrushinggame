import { BRUSH_RADIUS, WORLD_H, WORLD_W } from "./constants";
import type { GameEngine } from "./engine";
import {
  GUM_BOTTOM,
  GUM_LOWER_EDGE,
  GUM_LOWER_TEETH,
  GUM_TOP,
  GUM_UPPER_EDGE,
  GUM_UPPER_TEETH,
  LOWER_TEETH,
  MOLARS,
  rand,
  UPPER_TEETH,
  type Rect,
} from "./layout";
import { BG, C } from "./palette";
import type { PatchState, PhaseKind } from "./types";

type Ctx = CanvasRenderingContext2D;

function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | [number, number, number, number]) {
  const [tl, tr, br, bl] = typeof r === "number" ? [r, r, r, r] : r;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function toothShape(ctx: Ctx, t: Rect, fill: string, radii: [number, number, number, number], shade: string = C.toothShade) {
  rrect(ctx, t.x, t.y, t.w, t.h, radii);
  const g = ctx.createLinearGradient(t.x, t.y, t.x + t.w, t.y + t.h);
  g.addColorStop(0, fill);
  g.addColorStop(1, shade);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = C.toothLine;
  ctx.stroke();
  // parlama
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  rrect(ctx, t.x + t.w * 0.14, t.y + 8, t.w * 0.14, t.h * 0.45, 6);
  ctx.fill();
}

// ---- Sahneler ------------------------------------------------------------

function drawFaceEyes(ctx: Ctx) {
  for (const x of [112, 248]) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(x, 42, 24, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1c1038";
    ctx.beginPath();
    ctx.arc(x, 52, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x + 4, 47, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMouthFrame(ctx: Ctx) {
  drawFaceEyes(ctx);
  ctx.fillStyle = C.lip;
  rrect(ctx, 6, 84, 348, 352, 120);
  ctx.fill();
  ctx.fillStyle = C.mouth;
  rrect(ctx, 20, 98, 320, 324, 100);
  ctx.fill();
}

function drawOuter(ctx: Ctx) {
  drawMouthFrame(ctx);
  UPPER_TEETH.forEach((t) => toothShape(ctx, t, C.tooth, [8, 8, 18, 18]));
  LOWER_TEETH.forEach((t) => toothShape(ctx, t, C.tooth, [18, 18, 8, 8]));
}

function drawInner(ctx: Ctx) {
  drawMouthFrame(ctx);
  // dil (ağız içine kırpılır)
  ctx.save();
  rrect(ctx, 20, 98, 320, 324, 100);
  ctx.clip();
  ctx.fillStyle = C.tongue;
  ctx.beginPath();
  ctx.ellipse(180, 408, 136, 92, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(90,26,46,0.35)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(180, 330);
  ctx.lineTo(180, 396);
  ctx.stroke();
  ctx.restore();
  const shade = "#D9D2EA";
  UPPER_TEETH.forEach((t) => {
    toothShape(ctx, t, "#F1EDFA", [8, 8, 18, 18], shade);
    ctx.fillStyle = "rgba(120,100,170,0.16)";
    rrect(ctx, t.x + 6, t.y + t.h * 0.5, t.w - 12, t.h * 0.42, 12);
    ctx.fill();
  });
  LOWER_TEETH.forEach((t) => {
    toothShape(ctx, t, "#F1EDFA", [18, 18, 8, 8], shade);
    ctx.fillStyle = "rgba(120,100,170,0.16)";
    rrect(ctx, t.x + 6, t.y + 6, t.w - 12, t.h * 0.42, 12);
    ctx.fill();
  });
}

function drawChewing(ctx: Ctx) {
  ctx.fillStyle = C.gum;
  rrect(ctx, 6, 62, WORLD_W - 12, 396, 54);
  ctx.fill();
  MOLARS.forEach((m) => {
    toothShape(ctx, m, C.tooth, [34, 34, 34, 34]);
    // olukları çiz
    ctx.strokeStyle = C.toothLine;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    const cx = m.x + m.w / 2;
    const cy = m.y + m.h / 2;
    ctx.beginPath();
    ctx.moveTo(m.x + 20, cy);
    ctx.lineTo(m.x + m.w - 20, cy);
    ctx.moveTo(cx, m.y + 16);
    ctx.lineTo(cx, m.y + m.h - 16);
    ctx.moveTo(m.x + 30, m.y + 24);
    ctx.lineTo(cx - 8, cy - 8);
    ctx.moveTo(m.x + m.w - 30, m.y + m.h - 24);
    ctx.lineTo(cx + 8, cy + 8);
    ctx.stroke();
  });
}

function drawGumline(ctx: Ctx) {
  ctx.fillStyle = C.mouth;
  ctx.fillRect(0, GUM_TOP, WORLD_W, GUM_BOTTOM - GUM_TOP);
  // üst diş eti
  ctx.fillStyle = C.gum;
  rrect(ctx, 0, GUM_TOP, WORLD_W, GUM_UPPER_EDGE - GUM_TOP + 4, [34, 34, 0, 0]);
  ctx.fill();
  GUM_UPPER_TEETH.forEach((t) => toothShape(ctx, t, C.tooth, [6, 6, 28, 28]));
  scallop(ctx, GUM_UPPER_TEETH, GUM_UPPER_EDGE, true);
  // alt diş eti
  GUM_LOWER_TEETH.forEach((t) => toothShape(ctx, t, C.tooth, [28, 28, 6, 6]));
  ctx.fillStyle = C.gum;
  rrect(ctx, 0, GUM_LOWER_EDGE, WORLD_W, GUM_BOTTOM - GUM_LOWER_EDGE, [0, 0, 34, 34]);
  ctx.fill();
  scallop(ctx, GUM_LOWER_TEETH, GUM_LOWER_EDGE, false);
}

/** Diş etinin dişlerin arasına sarkan kıvrımlı kenarı. */
function scallop(ctx: Ctx, teeth: Rect[], edgeY: number, upper: boolean) {
  ctx.fillStyle = C.gum;
  ctx.strokeStyle = C.gumDark;
  ctx.lineWidth = 3;
  const dir = upper ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(0, edgeY - dir * 4);
  teeth.forEach((t) => {
    const cx = t.x + t.w / 2;
    ctx.quadraticCurveTo(cx, edgeY + dir * 20, t.x + t.w + 2, edgeY - dir * 4);
  });
  ctx.lineTo(WORLD_W, edgeY - dir * 4);
  ctx.lineTo(WORLD_W, edgeY - dir * 60);
  ctx.lineTo(0, edgeY - dir * 60);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, edgeY - dir * 4);
  teeth.forEach((t) => {
    const cx = t.x + t.w / 2;
    ctx.quadraticCurveTo(cx, edgeY + dir * 20, t.x + t.w + 2, edgeY - dir * 4);
  });
  ctx.stroke();
}

function drawTutorialTooth(ctx: Ctx) {
  toothShape(ctx, { x: 100, y: 170, w: 160, h: 200 }, C.tooth, [40, 40, 70, 70]);
}

const SCENES: Record<PhaseKind, (ctx: Ctx) => void> = {
  outer: drawOuter,
  inner: drawInner,
  chewing: drawChewing,
  gumline: drawGumline,
  tutorial: drawTutorialTooth,
};

// ---- Plak, mikrop, parıltı -------------------------------------------------

function drawPlaque(ctx: Ctx, p: PatchState, alpha: number, kind: PhaseKind) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  const blobs = 6;
  for (let i = 0; i < blobs; i++) {
    const a = (Math.PI * 2 * i) / blobs + p.seed * 6;
    const d = p.r * (0.35 + rand(p.seed * 10 + i) * 0.3);
    const rr = p.r * (0.5 + rand(p.seed * 20 + i) * 0.28);
    ctx.fillStyle = `rgba(${C.plaque},0.92)`;
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = `rgba(${C.plaque},0.92)`;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r * 0.75, 0, Math.PI * 2);
  ctx.fill();
  // benekler
  ctx.fillStyle = `rgba(${C.plaqueDark},0.55)`;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(
      p.x + (rand(p.seed * 30 + i) - 0.5) * p.r * 1.2,
      p.y + (rand(p.seed * 40 + i) - 0.5) * p.r * 1.2,
      2 + rand(p.seed * 50 + i) * 2.5,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  if (kind === "chewing") {
    const colors = ["#E4572E", "#8B5A2B", "#F29E4C", "#6A994E"];
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = colors[(i + Math.floor(p.seed * 4)) % colors.length]!;
      const cx = p.x + (rand(p.seed * 60 + i) - 0.5) * p.r * 1.1;
      const cy = p.y + (rand(p.seed * 70 + i) - 0.5) * p.r * 1.1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 4);
      ctx.lineTo(cx + 4, cy + 3);
      ctx.lineTo(cx - 4, cy + 3);
      ctx.closePath();
      ctx.fill();
    }
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

function drawHint(ctx: Ctx, p: PatchState, t: number) {
  const pulse = 0.5 + 0.5 * Math.sin(t / 260);
  ctx.save();
  ctx.strokeStyle = `rgba(245,184,0,${0.5 + pulse * 0.5})`;
  ctx.lineWidth = 4;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r + 8 + pulse * 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  drawFinger(ctx, p.x + Math.sin(t / 240) * p.r * 0.9, p.y + 6, 1);
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

function drawBrush(ctx: Ctx, x: number, y: number, kind: PhaseKind, down: boolean, t: number, reduced: boolean) {
  const tilt = kind === "gumline" ? -0.95 : -0.55;
  const wiggle = down && !reduced ? Math.sin(t / 55) * 0.06 : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt + wiggle);
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 8;
  // sap
  const grad = ctx.createLinearGradient(0, -6, 0, 6);
  grad.addColorStop(0, C.gold);
  grad.addColorStop(1, "#D99A00");
  ctx.fillStyle = grad;
  rrect(ctx, 14, -6, 96, 12, 6);
  ctx.fill();
  ctx.shadowBlur = 0;
  // baş
  ctx.fillStyle = C.purpleMid;
  rrect(ctx, -22, -9, 44, 18, 8);
  ctx.fill();
  // kıllar
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

// ---- Ana çizim -------------------------------------------------------------

export interface RenderOptions {
  reducedMotion: boolean;
  /** Eğitim ekranında hareketsizken gösterilen yönlendirici el. */
  showTutorialHand: boolean;
}

/** Canvas'ı tek karede çizer. `ctx` dünya koordinatlarına (WORLD_W x WORLD_H) hazır olmalı. */
export function renderFrame(ctx: Ctx, engine: GameEngine, t: number, opts: RenderOptions): void {
  const kind = engine.currentKind;
  const [c1, c2] = BG[kind] ?? BG.outer!;
  const bg = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  bg.addColorStop(0, c1);
  bg.addColorStop(1, c2);
  ctx.fillStyle = bg;
  ctx.fillRect(-2000, -2000, 4000 + WORLD_W, 4000 + WORLD_H);

  SCENES[kind](ctx);

  for (const p of engine.patches) {
    const fade = p.done ? Math.max(0, 1 - p.cleanedFor / 350) : 1 - p.clean * 0.92;
    drawPlaque(ctx, p, fade, kind);
  }
  for (const p of engine.patches) if (p.germ) drawGerm(ctx, p, t, opts.reducedMotion);

  if (engine.status === "transition" && !opts.reducedMotion) drawSheen(ctx, engine.transitionProgress);

  if (engine.hintIndex !== null && engine.status === "playing") {
    const p = engine.patches[engine.hintIndex];
    if (p) drawHint(ctx, p, t);
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
    drawBrush(ctx, engine.brush.x, engine.brush.y, kind, engine.brushDown, t, opts.reducedMotion);
  }
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
