import { describe, expect, it } from "vitest";
import { OPEN_FROM, OPEN_TO } from "@/game/constants";
import { artBlend, GameEngine, jawOpening } from "@/game/engine";
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

describe("Ağız açılma geçişi (diş araları → iç yüzey): yüz dönmez, çene iner", () => {
  /** TypeScript döngü sonrası durumu daraltmasın diye ayrı işlev. */
  const inTransition = (e: GameEngine): boolean => e.status === "transition";

  /** Sıradaki aşamayı Yardım ile bitirir; geçişe girince durur. */
  function finishPhaseByAssist(e: GameEngine) {
    let guard = 0;
    while (e.status === "playing" && guard++ < 400) e.assistClean();
  }

  it("yalnızca iç yüzeye geçerken ağız açılır; ilk geçişte (dış→diş araları) açılmaz", () => {
    const opens: number[] = [];
    const starts: number[] = [];
    const e = new GameEngine(buildPhases(), { onOpen: () => opens.push(e.phaseIndex), onPhaseStart: (i) => starts.push(i) });
    e.start();
    finishPhaseByAssist(e); // aşama 0 → geçiş
    expect(inTransition(e)).toBe(true);
    expect(e.opening).toBe(false);
    expect(e.openAmount).toBe(0);
    expect(e.openBlend).toBe(0);
    while (inTransition(e)) e.update(50);
    expect(opens).toEqual([]);
    expect(e.currentKind).toBe("gaps");

    finishPhaseByAssist(e); // aşama 1 (diş araları) → iç yüzeye ağız açılarak geçiş
    expect(inTransition(e)).toBe(true);
    expect(e.opening).toBe(true);
    expect(e.currentKind).toBe("gaps"); // henüz eski sahne
    expect(e.openAmount).toBe(0); // çene daha inmedi
    expect(starts).toEqual([0, 1]);
  });

  it("çene iner (açıklık 0 → 1, hafif aşımla); çene tam inince sahne değişir; oynanış geçişin sonunda başlar", () => {
    const opens: { kind: string; open: number; progress: number }[] = [];
    const starts: number[] = [];
    const e = new GameEngine(buildPhases(), {
      onOpen: () => opens.push({ kind: e.currentKind, open: e.openAmount, progress: e.transitionProgress }),
      onPhaseStart: (i) => starts.push(i),
    });
    e.start();
    finishPhaseByAssist(e);
    while (inTransition(e)) e.update(50);
    finishPhaseByAssist(e);

    let maxOpen = 0;
    let swappedAtOpen = -1;
    let prev = 0;
    let guard = 0;
    while (inTransition(e) && guard++ < 500) {
      e.update(16);
      if (!inTransition(e)) break; // geçiş bu karede bitti: göstergeler sıfırlanır
      const o = e.openAmount;
      maxOpen = Math.max(maxOpen, o);
      if (starts.length === 3 && swappedAtOpen < 0) swappedAtOpen = o;
      // çene önce iner (aşım dahil), sonra yerine oturur; hiçbir karede negatif ya da aşırı açık değil
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThan(1.1);
      // karışım (dış → iç) geriye gitmez
      expect(e.openBlend).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = e.openBlend;
    }
    expect(maxOpen).toBeGreaterThan(1); // çene biraz fazla iner ...
    expect(maxOpen).toBeLessThan(1.1); // ... ama çok değil
    expect(swappedAtOpen).toBeGreaterThan(0.98); // sahne çene tam inince (ağız tam açıkken) değişti: kesme görünmez
    expect(swappedAtOpen).toBeLessThan(1.02);
    // onOpen (ses) bir kez, çene inmeye başlarken: sahne henüz değişmedi, çene daha neredeyse inmedi
    expect(opens).toHaveLength(1);
    expect(opens[0]!.kind).toBe("gaps");
    expect(opens[0]!.progress).toBeGreaterThanOrEqual(OPEN_FROM);
    expect(opens[0]!.progress).toBeLessThan(OPEN_FROM + 0.05);
    expect(opens[0]!.open).toBeLessThan(0.1);
    expect(starts).toEqual([0, 1, 2]); // aşama 2 (iç yüzey) bir kez başladı
    expect(e.status).toBe("playing");
    expect(e.opening).toBe(false);
    expect(e.openAmount).toBe(0); // geçiş bitti; iç yüzey sahnesini çizim kendisi açık çizer
    expect(e.openBlend).toBe(0);
    expect(e.currentKind).toBe("inner");
    expect(e.patches.every((p) => !p.done)).toBe(true); // temiz sayfa, lekeler dolu
  });

  it("çene açıklığı ve diş sanatı karışımı eğrileri: önce sabit, sonra tek yönlü; sonunda tam 1", () => {
    expect(jawOpening(0)).toBe(0);
    expect(jawOpening(OPEN_FROM)).toBeCloseTo(0, 9);
    expect(jawOpening(OPEN_TO)).toBeCloseTo(1, 9);
    expect(jawOpening(1)).toBeCloseTo(1, 9);
    // OPEN_FROM'dan aşım noktasına kadar artar (tek yönlü iniş), sonra hafifçe geri döner
    let prev = 0;
    let peak = 0;
    for (let p = OPEN_FROM; p <= OPEN_TO + 1e-9; p += 0.005) {
      const v = jawOpening(p);
      peak = Math.max(peak, v);
      if (v < prev - 1e-9) expect(peak).toBeGreaterThan(1); // geri dönüş yalnızca aşımdan sonra
      prev = v;
    }
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.08);
    // karışım: 0 → 1, monoton, çene inmeden başlamaz, çene inince tamam
    expect(artBlend(0)).toBe(0);
    expect(artBlend(OPEN_FROM)).toBe(0);
    expect(artBlend(OPEN_TO)).toBe(1);
    expect(artBlend(1)).toBe(1);
    let b = 0;
    for (let p = 0; p <= 1; p += 0.01) {
      expect(artBlend(p)).toBeGreaterThanOrEqual(b - 1e-12);
      b = artBlend(p);
    }
  });

  it("ağız açılırken fırçalama sayılmaz ve ilerleme geriye gitmez", () => {
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
    const openCount = { n: 0 };
    const e = new GameEngine(buildPhases(), { onComplete: () => completes++, onOpen: () => openCount.n++ });
    e.start();
    playAll(e);
    expect(e.status).toBe("done");
    expect(completes).toBe(1);
    expect(openCount.n).toBe(1); // tüm oyunda ağız tek kez açılır
  });
});

describe('Kendini değerlendirme sorusu ("Sence yeterli ve etkin temizlendi mi?"): aşama BİTİNCE sorulur', () => {
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
  /** Aktif aşamadaki tüm lekeleri temizler (aşama biter). */
  const finishPhase = (e: GameEngine) => {
    let guard = 0;
    while (e.status === "playing" && guard++ < 2000) e.assistClean();
  };
  const untilPlaying = (e: GameEngine) => {
    let guard = 0;
    while (e.status !== "playing" && e.status !== "done" && guard++ < 500) e.update(50);
  };

  it("kapalıyken (asıl kampanya) hiç sorulmaz: aşama bitince doğrudan geçişe girer", () => {
    const asked: number[] = [];
    const e = new GameEngine(buildPhases(), { onCheck: (i) => asked.push(i) });
    e.start();
    finishPhase(e);
    expect(e.status).toBe("transition");
    playWithAssist(e);
    expect(e.status).toBe("done");
    expect(asked).toEqual([]);
  });

  it("açıkken soru, aşama TAMAMEN temizlenince çıkar (hiç leke kalmamışken); oyun durur, girdi/süre/ilerleme donar", () => {
    const log: string[] = [];
    const cleanAtAsk: boolean[] = [];
    const e: GameEngine = new GameEngine(
      buildPhases(),
      {
        onPhaseComplete: (i) => log.push(`bitti${i}`),
        onCheck: (i) => {
          log.push(`soru${i}`);
          cleanAtAsk.push(e.patches.every((p) => p.done));
        },
      },
      { selfCheck: true },
    );
    e.start();
    // Yarıya kadar temizle: soru HENÜZ çıkmamalı (eski, yanlış davranış buydu)
    let guard = 0;
    while (e.patches.filter((p) => p.done).length < e.patches.length / 2 && guard++ < 1000) e.assistClean();
    expect(e.status).toBe("playing");
    expect(log).toEqual([]);

    finishPhase(e);
    expect(e.status).toBe("asking");
    expect(cleanAtAsk).toEqual([true]); // soru çıktığında tüm lekeler temiz
    expect(log).toEqual(["bitti0", "soru0"]); // önce aşama tamamlandı (süre kaydı), sonra soru

    const before = { phase: e.phaseElapsed, total: e.totalElapsed, progress: e.overallProgress(), idx: e.phaseIndex, tr: e.transitionElapsed };
    scrub(e, e.patches[0]!, { amp: 40, strokes: 6 });
    e.assistClean();
    for (let i = 0; i < 400; i++) e.update(100); // 40 sn "düşünme"
    expect(e.status).toBe("asking");
    expect(e.phaseIndex).toBe(before.idx);
    expect(e.phaseElapsed).toBe(before.phase);
    expect(e.totalElapsed).toBe(before.total);
    expect(e.transitionElapsed).toBe(before.tr);
    expect(e.overallProgress()).toBe(before.progress);
    expect(e.hintIndex).toBeNull();
  });

  it("cevaptan sonra geçiş başlar ve sonraki aşama oynanır; aynı aşama için soru tekrarlanmaz", () => {
    const asked: number[] = [];
    const starts: number[] = [];
    const e = new GameEngine(buildPhases(), { onCheck: (i) => asked.push(i), onPhaseStart: (i) => starts.push(i) }, { selfCheck: true });
    e.start();
    finishPhase(e);
    expect(e.status).toBe("asking");
    e.answerCheck();
    expect(e.status).toBe("transition");
    untilPlaying(e);
    expect(e.status).toBe("playing");
    expect(e.phaseIndex).toBe(1);
    expect(starts).toEqual([0, 1]);
    expect(asked).toEqual([0]);
  });

  it("ağız açılması (diş araları → iç yüzey) soru cevaplanınca başlar, önce değil", () => {
    const e = new GameEngine(buildPhases(), {}, { selfCheck: true });
    e.start();
    finishPhase(e); // 0. aşama
    e.answerCheck();
    untilPlaying(e);
    finishPhase(e); // 1. aşama (diş araları): sonraki iç yüzey → ağız açılacak
    expect(e.status).toBe("asking");
    expect(e.opening).toBe(false); // soru sırasında ağız açılması başlamadı
    expect(e.openAmount).toBe(0);
    e.answerCheck();
    expect(e.status).toBe("transition");
    expect(e.opening).toBe(true);
  });

  it("son aşamada (diş ipi) soru yok: tam oyunda 5 soru [0..4] sorulur, her seferinde sahne tamamen temiz, oyun bir kez biter", () => {
    const asked: number[] = [];
    const clean: boolean[] = [];
    let completes = 0;
    const e: GameEngine = new GameEngine(
      buildPhases(),
      {
        onCheck: (i) => {
          asked.push(i);
          clean.push(e.patches.every((p) => p.done));
        },
        onComplete: () => completes++,
      },
      { selfCheck: true },
    );
    e.start();
    playWithAssist(e);
    expect(e.status).toBe("done");
    expect(asked).toEqual([0, 1, 2, 3, 4]); // 5. indeks (diş ipi) yok
    expect(clean).toEqual([true, true, true, true, true]);
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

  it("soru yokken answerCheck etkisizdir", () => {
    const e = new GameEngine(buildPhases(), {}, { selfCheck: true });
    e.start();
    e.answerCheck();
    expect(e.status).toBe("playing");
  });
});
