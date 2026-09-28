import { WORLD_W } from "./constants";
import type { Patch, PhaseSpec } from "./types";

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

function row(count: number, w: number, gap: number, y: number, h: number): Rect[] {
  const total = count * w + (count - 1) * gap;
  const x0 = (WORLD_W - total) / 2;
  return Array.from({ length: count }, (_, i) => ({ x: x0 + i * (w + gap), y, w, h }));
}

/** Ön görünüş / iç görünüş dişleri. */
export const UPPER_TEETH: Rect[] = row(6, 46, 3, 128, 88);
export const LOWER_TEETH: Rect[] = row(6, 44, 4, 228, 74);

/** Çiğneme yüzeyi (yukarıdan) azı dişleri. */
export const MOLARS: Rect[] = [
  ...row(3, 98, 10, 112, 98),
  ...row(3, 98, 10, 250, 98),
];

/** Diş eti sınırı görünümü. */
export const GUM_UPPER_EDGE = 196;
export const GUM_LOWER_EDGE = 330;
export const GUM_UPPER_TEETH: Rect[] = row(5, 56, 4, GUM_UPPER_EDGE, 118);
export const GUM_LOWER_TEETH: Rect[] = row(5, 56, 4, GUM_LOWER_EDGE - 96, 96);

function patchIn(rect: Rect, i: number, r: number, germ: boolean, dx = 0, dy = 0): Patch {
  const jx = (rand(i * 3.1) - 0.5) * (rect.w * 0.22);
  const jy = (rand(i * 5.7) - 0.5) * (rect.h * 0.22);
  return {
    x: rect.x + rect.w / 2 + jx + dx,
    y: rect.y + rect.h / 2 + jy + dy,
    r,
    germ,
    seed: rand(i * 9.3),
  };
}

function outer(): PhaseSpec {
  const patches: Patch[] = [];
  UPPER_TEETH.forEach((t, i) => patches.push(patchIn(t, i + 1, 19, i === 1 || i === 4)));
  [0, 2, 3, 5].forEach((idx, k) => patches.push(patchIn(LOWER_TEETH[idx]!, 20 + k, 18, idx === 2)));
  return { kind: "outer", patches };
}

function inner(): PhaseSpec {
  const patches: Patch[] = [];
  [0, 1, 2, 3, 4, 5].forEach((idx, k) => patches.push(patchIn(LOWER_TEETH[idx]!, 40 + k, 18, idx === 1 || idx === 4)));
  [0, 2, 3, 5].forEach((idx, k) => patches.push(patchIn(UPPER_TEETH[idx]!, 60 + k, 19, idx === 3)));
  return { kind: "inner", patches };
}

function chewing(): PhaseSpec {
  const patches: Patch[] = [];
  MOLARS.forEach((m, i) => {
    patches.push(patchIn(m, 80 + i, 19, i === 1 || i === 4, -18, -14));
    if (i !== 2 && i !== 3) patches.push(patchIn(m, 100 + i, 17, i === 0 || i === 5, 20, 18));
  });
  return { kind: "chewing", patches };
}

function gumline(): PhaseSpec {
  const patches: Patch[] = [];
  GUM_UPPER_TEETH.forEach((t, i) => {
    const p = patchIn(t, 120 + i, 18, i === 1 || i === 3);
    patches.push({ ...p, y: GUM_UPPER_EDGE + 12 });
  });
  [0, 1, 3, 4].forEach((idx, k) => {
    const t = GUM_LOWER_TEETH[idx]!;
    const p = patchIn(t, 140 + k, 17, idx === 3);
    patches.push({ ...p, y: GUM_LOWER_EDGE - 12 });
  });
  return { kind: "gumline", patches };
}

export function buildPhases(): PhaseSpec[] {
  return [outer(), inner(), chewing(), gumline()];
}

export function buildTutorialPhase(): PhaseSpec {
  return { kind: "tutorial", patches: [{ x: 180, y: 268, r: 50, germ: true, seed: 0.42 }] };
}
