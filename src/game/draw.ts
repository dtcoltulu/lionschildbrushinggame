export type Ctx = CanvasRenderingContext2D;

/** Köşeleri yuvarlatılmış dikdörtgen yolu. `r` tek sayı ya da [sol-üst, sağ-üst, sağ-alt, sol-alt]. */
export function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | [number, number, number, number]) {
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

export type Pt = [number, number];

/** Noktalardan geçen yumuşak kapalı eğri yolu (komşu orta noktalar arası ikinci derece Bezier). `beginPath` çağrılmaz. */
export function smoothClosed(ctx: Ctx, pts: Pt[]): void {
  const n = pts.length;
  if (n < 3) return;
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts[n - 1]!, pts[0]!);
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const m = mid(p, pts[(i + 1) % n]!);
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
}

/** Catmull-Rom eğrisi üzerinden örnekler (açık eğri; uçlar sabit). Oluk gibi serbest çizgiler için. */
export function splineSamples(pts: Pt[], perSegment = 6): Pt[] {
  if (pts.length < 3) return pts.slice();
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/**
 * Uçlara doğru incelen dolgulu çizgi (oluk, fissür). `samples` açık bir eğridir; genişlik başta `taperIn`,
 * sonda `taperOut` oranında yumuşakça sıfıra yaklaşır. Rengi `ctx.fillStyle` belirler.
 */
export function taperedStroke(ctx: Ctx, samples: Pt[], width: number, taperIn = 0.25, taperOut = 0.35): void {
  const n = samples.length;
  if (n < 2) return;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = samples[Math.max(0, i - 1)]!;
    const b = samples[Math.min(n - 1, i + 1)]!;
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const t = i / (n - 1);
    const k = Math.min(1, t / Math.max(1e-6, taperIn), (1 - t) / Math.max(1e-6, taperOut));
    const w = (width / 2) * Math.max(0.1, Math.sin((k * Math.PI) / 2));
    const p = samples[i]!;
    left.push([p[0] - dy * w, p[1] + dx * w]);
    right.push([p[0] + dy * w, p[1] - dx * w]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0]![0], left[0]![1]);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i]![0], left[i]![1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i]![0], right[i]![1]);
  ctx.closePath();
  ctx.fill();
}

/**
 * Elips biçimli radyal degrade dolgusu ("kubbe" ışığı). `hx`,`hy`: ışık odağının elips merkezine göre kayması (0..1, elips yarıçapı oranında).
 * Duraklar [konum, renk]. Mevcut yol/klip değil, kendi elipsini doldurur.
 */
export function domeFill(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, hx: number, hy: number, stops: [number, string][]): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(hx * rx, hy * rx, 0, 0, 0, rx);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** İki "#RRGGBB" rengini karıştırır (t: 0 → a, 1 → b). Aşama geçişlerinde arka plan ve yüz rengini yumuşatır. */
export function mixHex(a: string, b: string, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const ch = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  const m = (i: number) =>
    Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * k)
      .toString(16)
      .padStart(2, "0");
  return `#${m(0)}${m(1)}${m(2)}`;
}
