import {
  BRUSH_RADIUS,
  EASY_AFTER_MS,
  HINT_AFTER_MS,
  MAX_DT_MS,
  MIN_STROKE,
  PHASE_EASY_ALL_MS,
  PHASE_TRANSITION_MS,
  TURN_TRANSITION_MS,
  SWIPES_PER_PATCH,
} from "./constants";
import { StrokeTracker, type Swipe } from "./brush";
import { distToSegment } from "./geometry";
import type { EngineCallbacks, EngineStatus, PatchState, PhaseSpec, Point, Sparkle } from "./types";

export interface EngineOptions {
  reducedMotion?: boolean;
  swipesPerPatch?: number;
}

/**
 * Oyun mantığı: DOM/React'ten bağımsız, deterministik ve test edilebilir.
 * Ceza yok, kaybetme yok: takılan çocuğa ipucu ve kolaylaştırma vardır.
 */
export class GameEngine {
  status: EngineStatus = "idle";
  phaseIndex = 0;
  patches: PatchState[] = [];
  sparkles: Sparkle[] = [];
  brush: Point | null = null;
  brushDown = false;
  hintIndex: number | null = null;
  phaseElapsed = 0;
  totalElapsed = 0;
  /** Son patch temizlendiği andaki toplam süre (ödül ekranı için "oyun süresi"). */
  completionMs = 0;
  transitionElapsed = 0;
  /** Son patch temizlemeden beri geçen süre. */
  idle = 0;

  private tracker = new StrokeTracker();
  private lastProgress = 0;
  private cleanedInPhase = 0;

  constructor(
    private readonly phases: PhaseSpec[],
    private readonly cb: EngineCallbacks = {},
    private readonly opts: EngineOptions = {},
  ) {}

  get phaseCount(): number {
    return this.phases.length;
  }

  get currentKind() {
    return this.phases[Math.min(this.phaseIndex, this.phases.length - 1)]!.kind;
  }

  /** Geçiş yüzün dönmesiyle mi yapılıyor? (yalnızca iç yüzeye geçerken) */
  turning = false;
  private swapped = false;

  private get transitionDuration(): number {
    return this.turning ? TURN_TRANSITION_MS : PHASE_TRANSITION_MS;
  }

  get transitionProgress(): number {
    return Math.min(1, this.transitionElapsed / this.transitionDuration);
  }

  /** Yüzün yatay ölçeği: 1 → 0 (yan dönüş) → 1. Sahne tam ortada değişir. Dönme yokken 1. */
  get turnScale(): number {
    if (this.status !== "transition" || !this.turning) return 1;
    const p = this.transitionProgress;
    // Yumuşatılmış (ease-in-out) cos: yan tarafa doğru yavaşlar, döndükten sonra açılır
    return Math.max(0.03, Math.abs(Math.cos(p * Math.PI)));
  }

  start(): void {
    this.phaseIndex = 0;
    this.totalElapsed = 0;
    this.completionMs = 0;
    this.lastProgress = 0;
    this.loadPhase(0);
    this.status = "playing";
    this.cb.onPhaseStart?.(0);
    this.cb.onProgress?.(0);
  }

  private loadPhase(i: number): void {
    const need = this.phases[i]!.swipes ?? this.opts.swipesPerPatch ?? SWIPES_PER_PATCH;
    this.patches = this.phases[i]!.patches.map((p) => ({
      ...p,
      swipes: 0,
      partial: 0,
      need,
      clean: 0,
      cleanedFor: 0,
      done: false,
    }));
    this.phaseElapsed = 0;
    this.idle = 0;
    this.hintIndex = null;
    this.cleanedInPhase = 0;
    this.tracker.reset();
  }

  // ---- Girdi -----------------------------------------------------------

  pointerDown(p: Point): void {
    this.brush = { ...p };
    this.brushDown = true;
    this.tracker.begin(p);
  }

  pointerMove(p: Point): void {
    this.brush = { ...p };
    if (!this.brushDown || this.status !== "playing") return;
    const { swipe, segment } = this.tracker.move(p);
    if (segment) this.applySegment(segment.from, segment.to, segment.length);
    if (swipe) this.applySwipe(swipe);
  }

  pointerUp(): void {
    this.brushDown = false;
    this.tracker.reset();
  }

  /** "Yardım" butonu / klavye: sıradaki lekeyi temizler. */
  assistClean(): void {
    if (this.status !== "playing") return;
    const i = this.pickHintIndex();
    if (i === null) return;
    const patch = this.patches[i]!;
    patch.swipes = patch.need;
    this.finishPatchIfDone(patch);
    this.afterProgress();
  }

  // ---- Zaman -----------------------------------------------------------

  update(rawDtMs: number): void {
    const dt = Math.min(Math.max(rawDtMs, 0), MAX_DT_MS);
    for (const p of this.patches) if (p.done) p.cleanedFor += dt;
    this.updateSparkles(dt);

    if (this.status === "playing") {
      this.phaseElapsed += dt;
      this.totalElapsed += dt;
      this.idle += dt;
      this.applyAssist();
    } else if (this.status === "transition") {
      this.totalElapsed += dt;
      this.transitionElapsed += dt;
      if (this.turning && !this.swapped && this.transitionElapsed >= this.transitionDuration / 2) this.swapToNext();
      if (this.transitionElapsed >= this.transitionDuration) this.advance();
    }
  }

  private applyAssist(): void {
    if (this.idle >= HINT_AFTER_MS) {
      this.hintIndex = this.pickHintIndex();
    } else {
      this.hintIndex = null;
    }
    if (this.idle >= EASY_AFTER_MS && this.hintIndex !== null) {
      const p = this.patches[this.hintIndex]!;
      p.need = Math.min(p.need, p.swipes + 1);
    }
    if (this.phaseElapsed >= PHASE_EASY_ALL_MS) {
      for (const p of this.patches) if (!p.done) p.need = Math.min(p.need, p.swipes + 1);
    }
  }

  private pickHintIndex(): number | null {
    let best: number | null = null;
    let bestD = Infinity;
    const ref = this.brush ?? { x: 180, y: 260 };
    this.patches.forEach((p, i) => {
      if (p.done) return;
      const d = Math.hypot(p.x - ref.x, p.y - ref.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  // ---- Temizleme ------------------------------------------------------

  private reach(p: PatchState): number {
    return BRUSH_RADIUS + p.r * 0.85;
  }

  private applySegment(from: Point, to: Point, length: number): void {
    let touched = false;
    for (const p of this.patches) {
      if (p.done) continue;
      if (distToSegment(p, from, to) <= this.reach(p)) {
        p.partial = Math.min(0.95, p.partial + length / (MIN_STROKE * 1.6));
        p.clean = Math.min(1, (p.swipes + p.partial) / p.need);
        touched = true;
      }
    }
    if (touched) {
      this.idle = 0;
      this.afterProgress();
    }
  }

  private applySwipe(swipe: Swipe): void {
    let hit = false;
    for (const p of this.patches) {
      if (p.done) continue;
      if (distToSegment(p, swipe.from, swipe.to) <= this.reach(p)) {
        p.swipes += 1;
        p.partial = 0;
        hit = true;
        this.finishPatchIfDone(p);
        if (!p.done) p.clean = Math.min(1, p.swipes / p.need);
      }
    }
    if (hit) {
      this.idle = 0;
      this.cb.onSwipe?.();
      if (!this.opts.reducedMotion && this.brush) this.emitSparkles(this.brush.x, this.brush.y, 2, 0.4);
      this.afterProgress();
    }
  }

  private finishPatchIfDone(p: PatchState): void {
    if (p.done || p.swipes < p.need) return;
    p.done = true;
    p.clean = 1;
    p.cleanedFor = 0;
    this.cleanedInPhase += 1;
    this.emitSparkles(p.x, p.y, this.opts.reducedMotion ? 3 : 12, 1);
    this.cb.onPatchCleaned?.();
  }

  private afterProgress(): void {
    const overall = this.overallProgress();
    if (overall - this.lastProgress > 0.002 || overall >= 1) {
      this.lastProgress = overall;
      this.cb.onProgress?.(overall);
    }
    if (this.status === "playing" && this.patches.every((p) => p.done)) this.completePhase();
  }

  private completePhase(): void {
    this.status = "transition";
    this.transitionElapsed = 0;
    this.swapped = false;
    const next = this.phases[this.phaseIndex + 1];
    this.turning = next !== undefined && next.kind === "inner";
    this.hintIndex = null;
    this.brushDown = false;
    this.tracker.reset();
    if (this.phaseIndex === this.phases.length - 1) this.completionMs = this.totalElapsed;
    this.cb.onPhaseComplete?.(this.phaseIndex, Math.round(this.phaseElapsed));
  }

  /** Yüz yan dönünce: sonraki aşamanın sahnesi ve lekeleri yüklenir (oynanış geçişin sonunda başlar). */
  private swapToNext(): void {
    this.swapped = true;
    this.phaseIndex += 1;
    this.loadPhase(this.phaseIndex);
    this.cb.onTurn?.();
    this.cb.onPhaseStart?.(this.phaseIndex);
  }

  private advance(): void {
    if (this.swapped) {
      this.status = "playing";
      this.turning = false;
      this.swapped = false;
      return;
    }
    if (this.phaseIndex >= this.phases.length - 1) {
      this.status = "done";
      this.cb.onComplete?.(Math.round(this.completionMs));
      return;
    }
    this.phaseIndex += 1;
    this.loadPhase(this.phaseIndex);
    this.status = "playing";
    this.turning = false;
    this.cb.onPhaseStart?.(this.phaseIndex);
  }

  overallProgress(): number {
    if (this.status === "idle") return 0;
    if (this.status === "done") return 1;
    const n = this.phases.length;
    const cur = this.patches.length
      ? this.patches.reduce((s, p) => s + (p.done ? 1 : p.clean), 0) / this.patches.length
      : 0;
    return Math.min(1, (this.phaseIndex + cur) / n);
  }

  // ---- Parıltılar -----------------------------------------------------

  private emitSparkles(x: number, y: number, n: number, power: number): void {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + i * 0.7;
      const s = (40 + (i % 3) * 30) * power;
      this.sparkles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 20,
        life: 0,
        max: 550 + (i % 4) * 90,
        size: 3 + (i % 3) * 1.5,
        hue: 45 + (i % 5) * 28,
      });
    }
  }

  private updateSparkles(dt: number): void {
    if (!this.sparkles.length) return;
    const s = dt / 1000;
    for (const sp of this.sparkles) {
      sp.life += dt;
      sp.x += sp.vx * s;
      sp.y += sp.vy * s;
      sp.vy += 60 * s;
    }
    this.sparkles = this.sparkles.filter((sp) => sp.life < sp.max);
  }
}
