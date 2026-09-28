import { JITTER, MAX_STROKE, MIN_STROKE } from "./constants";
import type { Point } from "./types";

export interface Swipe {
  from: Point;
  to: Point;
  length: number;
}

/**
 * Parmak hareketinden "swipe" (fırça darbesi) çıkarır.
 * - Yön değiştirme (ileri-geri) veya yeterince uzun kesintisiz hareket = 1 swipe.
 * - Dairesel hareket de yön değiştirdiği için geçerlidir; hiçbir hareket cezalandırılmaz.
 */
export class StrokeTracker {
  private start: Point | null = null;
  private last: Point | null = null;
  private dir: Point | null = null;
  private len = 0;

  reset(): void {
    this.start = this.last = this.dir = null;
    this.len = 0;
  }

  begin(p: Point): void {
    this.start = { ...p };
    this.last = { ...p };
    this.dir = null;
    this.len = 0;
  }

  /** Hareketi işler; tamamlanan swipe varsa döndürür. */
  move(p: Point): { swipe: Swipe | null; segment: { from: Point; to: Point; length: number } | null } {
    if (!this.last || !this.start) {
      this.begin(p);
      return { swipe: null, segment: null };
    }
    const dx = p.x - this.last.x;
    const dy = p.y - this.last.y;
    const d = Math.hypot(dx, dy);
    if (d < JITTER) return { swipe: null, segment: null };

    const from = { ...this.last };
    const ux = dx / d;
    const uy = dy / d;
    let swipe: Swipe | null = null;

    if (this.dir && this.dir.x * ux + this.dir.y * uy < -0.2) {
      // yön değişti
      if (this.len >= MIN_STROKE) {
        swipe = { from: { ...this.start }, to: { ...this.last }, length: this.len };
      }
      this.start = { ...this.last };
      this.len = 0;
      this.dir = { x: ux, y: uy };
    } else {
      // yumuşatılmış yön
      this.dir = this.dir
        ? normalize({ x: this.dir.x * 0.6 + ux * 0.4, y: this.dir.y * 0.6 + uy * 0.4 })
        : { x: ux, y: uy };
    }

    this.len += d;
    this.last = { ...p };

    if (!swipe && this.len >= MAX_STROKE) {
      swipe = { from: { ...this.start }, to: { ...p }, length: this.len };
      this.start = { ...p };
      this.len = 0;
    }
    return { swipe, segment: { from, to: { ...p }, length: d } };
  }
}

function normalize(v: Point): Point {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}
