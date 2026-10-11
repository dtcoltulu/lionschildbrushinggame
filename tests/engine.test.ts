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

describe("Yüz dönme geçişi (diş araları → iç yüzey)", () => {
  /** TypeScript döngü sonrası durumu daraltmasın diye ayrı işlev. */
  const inTransition = (e: GameEngine): boolean => e.status === "transition";

  /** Sıradaki aşamayı Yardım ile bitirir; geçişe girince durur. */
  function finishPhaseByAssist(e: GameEngine) {
    let guard = 0;
    while (e.status === "playing" && guard++ < 400) e.assistClean();
  }

  it("yalnızca iç yüzeye geçerken döner; ilk geçişte (dış→diş araları) dönmez", () => {
    const turns: number[] = [];
    const starts: number[] = [];
    const e = new GameEngine(buildPhases(), { onTurn: () => turns.push(e.phaseIndex), onPhaseStart: (i) => starts.push(i) });
    e.start();
    finishPhaseByAssist(e); // aşama 0 → geçiş
    expect(inTransition(e)).toBe(true);
    expect(e.turning).toBe(false);
    expect(e.turnScale).toBe(1);
    while (inTransition(e)) e.update(50);
    expect(turns).toEqual([]);
    expect(e.currentKind).toBe("gaps");

    finishPhaseByAssist(e); // aşama 1 (diş araları) → iç yüzeye dönerek geçiş
    expect(inTransition(e)).toBe(true);
    expect(e.turning).toBe(true);
    expect(e.currentKind).toBe("gaps"); // henüz eski sahne
    expect(starts).toEqual([0, 1]);
  });

  it("yarıda sahne değişir, yüz yana bakar (ölçek ~0), sonunda oynanış başlar", () => {
    const turns: string[] = [];
    const starts: number[] = [];
    const e = new GameEngine(buildPhases(), { onTurn: () => turns.push(e.currentKind), onPhaseStart: (i) => starts.push(i) });
    e.start();
    finishPhaseByAssist(e);
    while (inTransition(e)) e.update(50);
    finishPhaseByAssist(e);

    let minScale = 1;
    let swappedAtScale = -1;
    let guard = 0;
    while (inTransition(e) && guard++ < 500) {
      e.update(16);
      minScale = Math.min(minScale, e.turnScale);
      if (turns.length === 1 && swappedAtScale < 0) swappedAtScale = e.turnScale;
    }
    expect(minScale).toBeLessThan(0.1); // tam yan dönüş
    expect(swappedAtScale).toBeLessThan(0.15); // sahne yan dönükken değişti (kesme görünmez)
    expect(turns).toEqual(["inner"]); // onTurn bir kez, yeni sahneyle
    expect(starts).toEqual([0, 1, 2]); // aşama 2 (iç yüzey) bir kez başladı
    expect(e.status).toBe("playing");
    expect(e.turning).toBe(false);
    expect(e.turnScale).toBe(1);
    expect(e.currentKind).toBe("inner");
    expect(e.patches.every((p) => !p.done)).toBe(true); // temiz sayfa, lekeler dolu
  });

  it("dönme sırasında fırçalama sayılmaz ve ilerleme geriye gitmez", () => {
    const seen: number[] = [];
    const e = new GameEngine(buildPhases(), { onProgress: (v) => seen.push(v) });
    e.start();
    finishPhaseByAssist(e);
    while (inTransition(e)) e.update(50);
    finishPhaseByAssist(e);
    const before = e.overallProgress();
    for (let i = 0; i < 60 && inTransition(e); i++) {
      e.pointerDown({ x: 180, y: 250 });
      e.pointerMove({ x: 240, y: 250 });
      e.pointerMove({ x: 120, y: 250 });
      e.pointerUp();
      e.update(16);
      expect(e.overallProgress()).toBeGreaterThanOrEqual(before - 1e-9);
    }
    while (inTransition(e)) e.update(50);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]! - 1e-9);
  });

  it("tam oyun yine 6 aşamayla biter ve onComplete bir kez çağrılır", () => {
    let completes = 0;
    const turnCount = { n: 0 };
    const e = new GameEngine(buildPhases(), { onComplete: () => completes++, onTurn: () => turnCount.n++ });
    e.start();
    playAll(e);
    expect(e.status).toBe("done");
    expect(completes).toBe(1);
    expect(turnCount.n).toBe(1); // tüm oyunda tek kez döner
  });
});

describe('Kendini değerlendirme sorusu ("Sence yeterli ve etkin temizlendi mi?")', () => {
  /** Yardım butonuyla (deterministik) oynar; soru çıkınca `onAsk` karar verir. */
  function playWithAssist(e: GameEngine, onAsk: (e: GameEngine) => void = (x) => x.answerCheck()) {
    let guard = 0;
    while (e.status !== "done" && guard++ < 20000) {
      if (e.status === "asking") onAsk(e);
      else if (e.status === "playing") {
        e.assistClean();
        e.update(16);
      } else e.update(50);
    }
  }
  const doneCount = (e: GameEngine) => e.patches.filter((p) => p.done).length;

  it("kapalıyken (asıl kampanya) hiç sorulmaz ve oyun bitebilir", () => {
    const asked: number[] = [];
    const e = new GameEngine(buildPhases(), { onCheck: (i) => asked.push(i) });
    e.start();
    playWithAssist(e);
    expect(e.status).toBe("done");
    expect(asked).toEqual([]);
  });

  it("açıkken aşamanın yarısı temizlenince sorulur; oyun durur, girdi/süre/ilerleme donar", () => {
    const asked: number[] = [];
    const e = new GameEngine(buildPhases(), { onCheck: (i) => asked.push(i) }, { selfCheck: true });
    e.start();
    let guard = 0;
    while (e.status === "playing" && guard++ < 1000) e.assistClean();
    expect(e.status).toBe("asking");
    expect(asked).toEqual([0]);
    expect(doneCount(e)).toBe(e.patches.length / 2); // tam yarısı: 24 lekenin 12'si

    const before = { done: doneCount(e), phase: e.phaseElapsed, total: e.totalElapsed, progress: e.overallProgress() };
    // Soru açıkken fırçalama, yardım ve zaman hiçbir şeyi ilerletmez.
    const t = e.patches.find((p) => !p.done)!;
    scrub(e, t, { amp: 40, strokes: 6 });
    e.assistClean();
    for (let i = 0; i < 400; i++) e.update(100); // 40 sn "düşünme"
    expect(e.status).toBe("asking");
    expect(doneCount(e)).toBe(before.done);
    expect(e.phaseElapsed).toBe(before.phase);
    expect(e.totalElapsed).toBe(before.total);
    expect(e.overallProgress()).toBe(before.progress);
    expect(e.hintIndex).toBeNull();
  });

  it("cevaptan sonra aynı aşamada devam eder ve o aşamada bir daha sorulmaz", () => {
    const asked: number[] = [];
    const e = new GameEngine(buildPhases(), { onCheck: (i) => asked.push(i) }, { selfCheck: true });
    e.start();
    let guard = 0;
    while (e.status === "playing" && guard++ < 1000) e.assistClean();
    e.answerCheck();
    expect(e.status).toBe("playing");
    expect(e.phaseIndex).toBe(0);
    expect(e.idle).toBe(0);
    // aşama biter (geçişe girer), 0. aşama için soru tekrarlanmamıştır
    guard = 0;
    while (e.status === "playing" && guard++ < 1000) e.assistClean();
    expect(e.status).toBe("transition");
    expect(asked).toEqual([0]);
  });

  it("son aşamada (diş ipi) soru yok: tam oyunda 5 soru sorulur ve oyun bir kez biter", () => {
    const asked: number[] = [];
    let completes = 0;
    const e = new GameEngine(buildPhases(), { onCheck: (i) => asked.push(i), onComplete: () => completes++ }, { selfCheck: true });
    e.start();
    playWithAssist(e);
    expect(e.status).toBe("done");
    expect(asked).toEqual([0, 1, 2, 3, 4]); // 5. indeks (diş ipi) yok
    expect(completes).toBe(1);
  });

  it("soru ve cevaplama süresi oyun süresine (completionMs) sayılmaz", () => {
    const run = (thinkMs: number) => {
      const e = new GameEngine(buildPhases(), {}, { selfCheck: true });
      e.start();
      playWithAssist(e, (x) => {
        for (let t = 0; t < thinkMs; t += 100) x.update(100);
        x.answerCheck();
      });
      return e.completionMs;
    };
    expect(run(60_000)).toBe(run(0)); // 1 dk düşünen çocukla hemen cevaplayan aynı süre
  });

  it("öğreticide (tek aşama) soru çıkmaz", () => {
    const asked: number[] = [];
    const e = new GameEngine([buildTutorialPhase()], { onCheck: (i) => asked.push(i) }, { selfCheck: true, swipesPerPatch: 3 });
    e.start();
    playWithAssist(e);
    expect(e.status).toBe("done");
    expect(asked).toEqual([]);
  });

  it("checkAt ayarlanabilir (daha geç sorulur, yine de bitmeden)", () => {
    const asked: number[] = [];
    const late = new GameEngine(buildPhases(), { onCheck: (i) => asked.push(i) }, { selfCheck: true, checkAt: 0.9 });
    late.start();
    let guard = 0;
    while (late.status === "playing" && guard++ < 1000) late.assistClean();
    expect(late.status).toBe("asking");
    expect(doneCount(late)).toBeGreaterThanOrEqual(Math.ceil(late.patches.length * 0.9));
    expect(doneCount(late)).toBeLessThan(late.patches.length);
  });

  it("soru yokken answerCheck etkisizdir", () => {
    const e = new GameEngine(buildPhases(), {}, { selfCheck: true });
    e.start();
    e.answerCheck();
    expect(e.status).toBe("playing");
  });
});
