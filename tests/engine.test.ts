import { describe, expect, it } from "vitest";
import { GameEngine } from "@/game/engine";
import { StrokeTracker } from "@/game/brush";
import { buildPhases, buildTutorialPhase } from "@/game/layout";
import type { PatchState, Point } from "@/game/types";

/** Bir lekenin üzerinde ileri-geri fırçalayan sanal çocuk. */
function scrub(engine: GameEngine, center: Point, opts: { amp?: number; speed?: number; strokes?: number } = {}) {
  const amp = opts.amp ?? 36;
  const speed = opts.speed ?? 320; // dünya birimi / sn
  const strokes = opts.strokes ?? 8;
  const dt = 16;
  let x = center.x - amp;
  let dir = 1;
  engine.pointerDown({ x, y: center.y });
  let elapsed = 0;
  for (let s = 0; s < strokes; s++) {
    const target = center.x + dir * amp;
    while ((dir > 0 && x < target) || (dir < 0 && x > target)) {
      x += dir * speed * (dt / 1000);
      engine.pointerMove({ x, y: center.y });
      engine.update(dt);
      elapsed += dt;
    }
    dir *= -1;
  }
  engine.pointerUp();
  return elapsed;
}

function playAll(engine: GameEngine) {
  let guard = 0;
  while (engine.status !== "done" && guard++ < 5000) {
    if (engine.status === "playing") {
      const next = engine.patches.find((p: PatchState) => !p.done);
      if (next) scrub(engine, next, { amp: 40, strokes: 5 });
    } else {
      engine.update(50);
    }
  }
}

describe("StrokeTracker", () => {
  it("ileri-geri hareketi swipe sayar", () => {
    const t = new StrokeTracker();
    t.begin({ x: 0, y: 0 });
    let swipes = 0;
    for (let x = 0; x <= 60; x += 4) if (t.move({ x, y: 0 }).swipe) swipes++;
    for (let x = 60; x >= 0; x -= 4) if (t.move({ x, y: 0 }).swipe) swipes++;
    expect(swipes).toBeGreaterThanOrEqual(1);
  });

  it("titreme (çok küçük hareket) swipe sayılmaz", () => {
    const t = new StrokeTracker();
    t.begin({ x: 0, y: 0 });
    let swipes = 0;
    for (let i = 0; i < 200; i++) if (t.move({ x: i % 2 ? 0.5 : 0, y: 0 }).swipe) swipes++;
    expect(swipes).toBe(0);
  });

  it("uzun kesintisiz hareket de swipe olur", () => {
    const t = new StrokeTracker();
    t.begin({ x: 0, y: 0 });
    let swipes = 0;
    for (let x = 0; x <= 200; x += 5) if (t.move({ x, y: 0 }).swipe) swipes++;
    expect(swipes).toBeGreaterThanOrEqual(2);
  });
});

describe("GameEngine", () => {
  it("temizleme tek dokunuşta olmaz; birkaç swipe gerekir", () => {
    const e = new GameEngine(buildPhases());
    e.start();
    const p = e.patches[0]!;
    // Tek kısa çizgi: tam temizlemez.
    e.pointerDown({ x: p.x - 30, y: p.y });
    for (let x = p.x - 30; x <= p.x + 30; x += 5) e.pointerMove({ x, y: p.y });
    e.pointerUp();
    expect(p.done).toBe(false);
    expect(p.clean).toBeGreaterThan(0);
    expect(p.clean).toBeLessThan(1);
  });

  it("yeterli fırçalamada leke temizlenir", () => {
    const e = new GameEngine(buildPhases());
    e.start();
    const p = e.patches[0]!;
    scrub(e, p, { strokes: 6 });
    expect(p.done).toBe(true);
    expect(p.clean).toBe(1);
  });

  it("6 aşama sırasıyla tamamlanır ve onComplete bir kez çağrılır", () => {
    const started: number[] = [];
    const finished: number[] = [];
    let completes = 0;
    const e = new GameEngine(buildPhases(), {
      onPhaseStart: (i) => started.push(i),
      onPhaseComplete: (i) => finished.push(i),
      onComplete: () => completes++,
    });
    e.start();
    playAll(e);
    expect(e.status).toBe("done");
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(finished).toEqual([0, 1, 2, 3, 4, 5]);
    expect(completes).toBe(1);
    expect(e.overallProgress()).toBe(1);
  });

  it("ilerleme monoton artar", () => {
    const seen: number[] = [];
    const e = new GameEngine(buildPhases(), { onProgress: (v) => seen.push(v) });
    e.start();
    playAll(e);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(seen.at(-1)).toBe(1);
  });

  it("verimli bir oyuncu için toplam süre ~45–90 sn bandına yakındır", () => {
    const e = new GameEngine(buildPhases());
    e.start();
    playAll(e);
    const sec = e.completionMs / 1000;
    // Bot mükemmel/verimli; gerçek çocuklar daha yavaş. Alt sınır makul olmalı.
    expect(sec).toBeGreaterThan(25);
    expect(sec).toBeLessThan(90);
  });

  it("yavaş/dağınık çocuk için bile takılma yok: yardım devreye girer", () => {
    const e = new GameEngine(buildPhases());
    e.start();
    // Hiçbir şey yapmadan bekle: ipucu ve kolaylaştırma sonrası "Yardım" ile bitir.
    let ms = 0;
    while (e.status !== "done" && ms < 300000) {
      e.update(100);
      ms += 100;
      if (e.status === "playing" && e.hintIndex !== null) e.assistClean();
    }
    expect(e.status).toBe("done");
  });

  it("ipucu 5.5 sn hareketsizlikten sonra çıkar", () => {
    const e = new GameEngine(buildPhases());
    e.start();
    for (let i = 0; i < 50; i++) e.update(100);
    expect(e.hintIndex).toBeNull();
    for (let i = 0; i < 20; i++) e.update(100);
    expect(e.hintIndex).not.toBeNull();
  });

  it("arka plandan dönüşte süre şişmez (dt kırpılır)", () => {
    const e = new GameEngine(buildPhases());
    e.start();
    e.update(60000);
    expect(e.totalElapsed).toBeLessThanOrEqual(100);
  });

  it("tutorial tek leke ile tamamlanır", () => {
    let completed = false;
    const e = new GameEngine([buildTutorialPhase()], { onComplete: () => (completed = true) });
    e.start();
    playAll(e);
    expect(completed).toBe(true);
  });

  it("azaltılmış hareket modunda parıltı sayısı azalır", () => {
    const a = new GameEngine(buildPhases());
    const b = new GameEngine(buildPhases(), {}, { reducedMotion: true });
    for (const e of [a, b]) {
      e.start();
      scrub(e, e.patches[0]!, { strokes: 6 });
    }
    expect(b.sparkles.length).toBeLessThan(a.sparkles.length);
  });
});
