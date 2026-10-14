import { afterEach, describe, expect, it } from "vitest";
import { OPEN_APPEAR, OPEN_TO } from "@/game/constants";
import { mixHex } from "@/game/draw";
import { GameEngine } from "@/game/engine";
import { CHEW_KINDS, CHEW_TILES, buildPhases, buildTutorialPhase, JAW_DROP, LOWER_TEETH, MOUTH_IN, toothRank, UPPER_TEETH } from "@/game/layout";
import { crownPixels, drawChewTiles, warmCrowns } from "@/game/occlusal";
import { BG, FACE } from "@/game/palette";
import { renderFrame } from "@/game/render";
import { drawGumSprite, warmGums } from "@/game/gums";
import { setDeviceScale } from "@/game/shade";
import { drawGumBand, drawTooth, drawTutorialTooth, FRONT_TOOTH, GUM, INNER_TOOTH } from "@/game/teeth";
import { drawTeethRow, toothPixels, warmTeeth } from "@/game/toothsprite";

interface Call {
  name: string;
  args: unknown[];
}
type MockCtx = CanvasRenderingContext2D & { calls: Call[]; props: Record<string, unknown>; trace: string[] };

/** İz satırı için değer biçimi: sayılar yuvarlanır, renkler küçük harfe çevrilir ("#5A2456" ile "#5a2456" aynıdır). */
const fmt = (a: unknown): string => (typeof a === "number" ? String(+a.toFixed(6)) : typeof a === "string" ? a.toLowerCase() : typeof a === "object" && a ? "{}" : String(a));

/**
 * Çizim çağrılarını kaydeden sahte 2D bağlam (gerçek canvas gerektirmez).
 * `calls`: yöntem çağrıları; `trace`: yöntem çağrıları VE özellik atamaları, sırayla (iki çizimin birebir aynı olduğunu göstermek için).
 */
function makeCtx(transform?: { a: number; b: number; c: number; d: number; e: number; f: number }): MockCtx {
  const calls: Call[] = [];
  const trace: string[] = [];
  const props: Record<string, unknown> = { globalAlpha: 1 };
  const record = (name: string, args: unknown[]) => {
    calls.push({ name, args });
    trace.push(`${name}(${args.map(fmt).join(",")})`);
  };
  const gradient = () => ({ addColorStop: (o: number, c: string) => record("addColorStop", [o, c]) });
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, key: string) {
      if (key === "calls") return calls;
      if (key === "props") return props;
      if (key === "trace") return trace;
      if (key === "getTransform") return transform ? () => transform : undefined;
      if (key in props) return props[key];
      if (key === "createLinearGradient" || key === "createRadialGradient") {
        return (...args: unknown[]) => {
          record(key, args);
          return gradient();
        };
      }
      return (...args: unknown[]) => record(key, args);
    },
    set(_t, key: string, v) {
      props[key] = v;
      trace.push(`${key}=${fmt(v)}`);
      return true;
    },
  });
  return ctx as unknown as MockCtx;
}

const GEOMETRY = new Set([
  "moveTo",
  "lineTo",
  "bezierCurveTo",
  "quadraticCurveTo",
  "arc",
  "ellipse",
  "fillRect",
  "translate",
  "scale",
  "setTransform",
  "drawImage",
  "createLinearGradient",
  "createRadialGradient",
]);

function expectSane(ctx: MockCtx) {
  let depth = 0;
  for (const c of ctx.calls) {
    if (c.name === "save") depth++;
    if (c.name === "restore") {
      depth--;
      expect(depth, "restore, save'den fazla").toBeGreaterThanOrEqual(0);
    }
    if (GEOMETRY.has(c.name)) {
      for (const a of c.args) {
        if (typeof a === "number") expect(Number.isFinite(a), `${c.name} sayısal argümanı sonlu olmalı (${String(a)})`).toBe(true);
      }
    }
    if (c.name === "addColorStop") {
      const o = c.args[0] as number;
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
  }
  expect(depth, "save/restore dengeli olmalı").toBe(0);
}

/** Aydınlatılmış sprite piksellerinin özeti: [ortalama parlaklık, en parlak, en koyu, kapsama (opak piksel oranı)]. */
function stats(px: Uint8ClampedArray): { mean: number; max: number; min: number; opaque: number; transparent: number } {
  let sum = 0;
  let n = 0;
  let max = 0;
  let min = 255;
  let opaque = 0;
  const total = px.length / 4;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3]!;
    if (a === 255) opaque++;
    if (a < 255 * 0.5) continue;
    const lum = 0.3 * px[i]! + 0.59 * px[i + 1]! + 0.11 * px[i + 2]!;
    sum += lum;
    n++;
    max = Math.max(max, lum);
    min = Math.min(min, lum);
  }
  return { mean: n ? sum / n : 0, max, min, opaque: opaque / total, transparent: px.reduce((k, _v, i) => (i % 4 === 3 && px[i]! === 0 ? k + 1 : k), 0) / total };
}

describe("diş sırası", () => {
  it("diş türü merkezden dışa 0..5, sol ve sağ simetrik", () => {
    expect(Array.from({ length: 12 }, (_, i) => toothRank(i))).toEqual([5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5]);
  });
});

describe("yedek (basit) diş çizimi", () => {
  it("üst ve alt dişler, iç görünüş, diş eti ve öğretici dişi sağlam çizilir", () => {
    for (const fn of [
      (c: MockCtx) => UPPER_TEETH.forEach((t, i) => drawTooth(c, t, toothRank(i), true, FRONT_TOOTH)),
      (c: MockCtx) => LOWER_TEETH.forEach((t, i) => drawTooth(c, t, toothRank(i), false, INNER_TOOTH, true)),
      (c: MockCtx) => drawGumBand(c, UPPER_TEETH, true, MOUTH_IN, GUM),
      (c: MockCtx) => drawGumBand(c, LOWER_TEETH, false, MOUTH_IN, GUM),
      (c: MockCtx) => drawTutorialTooth(c),
    ]) {
      const ctx = makeCtx();
      fn(ctx);
      expectSane(ctx);
      expect(ctx.calls.length).toBeGreaterThan(5);
    }
  });
});

describe("gerçekçi diş sprite'ları (yükseklik haritasından ışık)", () => {
  it("azı dişi: kenarda saydam, içte opak; tümsek parlama ve olukta koyu leke var; her tür ve çene yönü için", () => {
    for (const kind of ["premolar", "molar4", "molar5"] as const) {
      for (const flip of [false, true]) {
        const t = CHEW_TILES[CHEW_KINDS.indexOf(kind)]!;
        const { pixels, W, H } = crownPixels(kind, t.w, t.h, flip, 3, 2);
        expect(pixels.length).toBe(W * H * 4);
        const s = stats(pixels);
        expect(s.opaque).toBeGreaterThan(0.45); // taç sprite'ın büyük kısmını kaplar
        expect(s.transparent).toBeGreaterThan(0.02); // köşelerde saydam
        expect(s.mean).toBeGreaterThan(180); // fildişi/parlak
        expect(s.max).toBeGreaterThan(245); // parlama
        expect(s.min).toBeLessThan(175); // oluk/vadi
      }
    }
  });

  it("ışık sol üstten: kubbenin sol-üst yüzü sağ-alt yüzünden daha parlak", () => {
    const t = CHEW_TILES[CHEW_KINDS.indexOf("molar4")]!;
    const res = 2;
    const { pixels, W, H } = crownPixels("molar4", t.w, t.h, false, 3, res);
    const at = (x: number, y: number) => {
      const k = (Math.round(y * res) * W + Math.round(x * res)) * 4;
      return 0.3 * pixels[k]! + 0.59 * pixels[k + 1]! + 0.11 * pixels[k + 2]!;
    };
    // Sol-üst tümseğin ışığa bakan yüzü (merkezin biraz sol-üstü) ile sağ-alt tümseğin gölgeli yüzü (merkezin sağ-altı)
    const cx = 3 + t.w / 2;
    const cy = 3 + t.h / 2;
    const lit = at(cx - t.w * 0.42, cy - t.h * 0.3);
    const shade = at(cx + t.w * 0.44, cy + t.h * 0.38);
    expect(lit).toBeGreaterThan(shade);
    expect(W).toBe(Math.ceil((t.w + 6) * res));
    expect(H).toBe(Math.ceil((t.h + 6) * res));
  });

  it("ön ve iç yüz dişleri: tüm sıra ve türler üretilir, piksel sayısı sprite boyutuyla uyumlu, parlak ve renkli", () => {
    for (const view of ["front", "inner"] as const) {
      for (const upper of [true, false]) {
        const teeth = upper ? UPPER_TEETH : LOWER_TEETH;
        teeth.forEach((t, i) => {
          const { pixels, W, H } = toothPixels(view, toothRank(i), t.w, t.h, upper, i, 2);
          expect(pixels.length).toBe(W * H * 4);
          const s = stats(pixels);
          expect(s.mean).toBeGreaterThan(170);
          expect(s.opaque).toBeGreaterThan(0.9); // silüet "destination-in" ile sonradan uygulanır; hepsi dolu üretilir
        });
      }
    }
  });

  it("ön yüzde boyun sıcak (sarımsı), kesici kenar soğuk (mavimsi saydam); iç yüzde yüzey düz değil, hacimli", () => {
    const t = UPPER_TEETH[5]!; // merkez kesici
    const res = 2;
    const front = toothPixels("front", 0, t.w, t.h, true, 5, res);
    // Işık parlaması kanalları doyurmasın diye dişin sağ (gölgeli) yarısından küçük bir pencerenin ortalaması
    const win = (p: { pixels: Uint8ClampedArray; W: number }, x: number, y: number) => {
      let r = 0;
      let b = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const k = ((Math.round(y * res) + dy) * p.W + Math.round(x * res) + dx) * 4;
          r += p.pixels[k]!;
          b += p.pixels[k + 2]!;
          n++;
        }
      }
      return { r: r / n, b: b / n };
    };
    const hid = 0.18 * t.h;
    const x = 3 + t.w * 0.68;
    const neck = win(front, x, 3 + hid + t.h * 0.1);
    const edge = win(front, x, 3 + hid + t.h * 0.94);
    expect(neck.r - neck.b).toBeGreaterThan(edge.r - edge.b); // boyun daha sıcak; kesici kenar daha mavimsi
    const inner = toothPixels("inner", 0, t.w, t.h, true, 5, res);
    const lum = (c: { r: number; b: number }) => c.r + c.b;
    const center = lum(win(inner, 3 + t.w / 2, 3 + hid + t.h * 0.6)); // fossa
    const ridge = lum(win(inner, 3 + t.w * 0.2, 3 + hid + t.h * 0.6)); // marjinal sırt
    expect(Math.abs(center - ridge)).toBeGreaterThan(1); // yüzey düz değil, hacimli
  });

  it("sprite hazırlığı: bütçe 0'da çağrı başına en az bir sprite hazırlanır ve hepsi bitince true döner", () => {
    let guard = 0;
    while (!warmCrowns(2, 0) && guard++ < 40);
    expect(guard).toBeLessThan(40);
    expect(warmCrowns(2, 0)).toBe(true);
    guard = 0;
    while (!warmTeeth(UPPER_TEETH, LOWER_TEETH, 2, 0) && guard++ < 120);
    expect(guard).toBeLessThan(120);
    guard = 0;
    while (!warmGums(UPPER_TEETH, LOWER_TEETH, MOUTH_IN, 2, 0) && guard++ < 20);
    expect(guard).toBeLessThan(20);
  });
});

describe("sprite çizimi (tuval yokken yedek yola düşer)", () => {
  it("diş sırası, diş eti ve çiğneme dişleri hata vermeden basit çizime döner", () => {
    setDeviceScale(2);
    const ctx = makeCtx();
    let fallbacks = 0;
    drawTeethRow(ctx, UPPER_TEETH, true, "front", 2, () => fallbacks++);
    expect(fallbacks).toBe(12);
    drawGumSprite(ctx, "front", UPPER_TEETH, true, MOUTH_IN, 2, GUM);
    drawChewTiles(ctx, true);
    drawChewTiles(ctx, false);
    expectSane(ctx);
    expect(ctx.calls.filter((c) => c.name === "bezierCurveTo").length).toBeGreaterThan(10);
  });
});

describe("tüm sahneler", () => {
  function frame(phase: number | "tutorial", clean: boolean, ctx: MockCtx, cache = true) {
    const engine = new GameEngine(phase === "tutorial" ? [buildTutorialPhase()] : buildPhases(), {}, { reducedMotion: true });
    engine.start();
    if (phase !== "tutorial") {
      engine.phaseIndex = phase;
      (engine as unknown as { loadPhase(i: number): void }).loadPhase(phase);
    }
    if (clean) for (const p of engine.patches) Object.assign(p, { done: true, clean: 1, cleanedFor: 1e6 });
    renderFrame(ctx, engine, 1234, { reducedMotion: true, showTutorialHand: false, cache });
  }

  it("6 aşama + öğretici, kirli ve temiz halleriyle hatasız ve dengeli çizilir", () => {
    for (const phase of [0, 1, 2, 3, 4, 5, "tutorial"] as const) {
      for (const clean of [false, true]) {
        const ctx = makeCtx();
        expect(() => frame(phase, clean, ctx)).not.toThrow();
        expectSane(ctx);
      }
    }
  });
});

describe("sahne önbelleği", () => {
  const original = (globalThis as { document?: unknown }).document;
  afterEach(() => {
    (globalThis as { document?: unknown }).document = original;
  });

  function setup() {
    const made: MockCtx[] = [];
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const cctx = makeCtx();
        made.push(cctx);
        return { width: 0, height: 0, getContext: () => cctx };
      },
    };
    const engine = new GameEngine(buildPhases(), {}, { reducedMotion: true });
    engine.start();
    return { made, engine };
  }
  const opts = { reducedMotion: true, showTutorialHand: false } as const;

  it("sahne bir kez çizilir; sonraki karelerde yalnızca önbellek basılır", () => {
    const { made, engine } = setup();
    const ctx = makeCtx({ a: 2, b: 0, c: 0, d: 2, e: 10.5, f: 4.25 });
    renderFrame(ctx, engine, 0, opts);
    // tuvalin kendisi + (sahte belgede) her sprite için ayrı tuval: ilk eleman sahne önbelleğidir
    const sceneCtx = made.find((m) => m.calls.some((c) => c.name === "ellipse"))!;
    expect(sceneCtx).toBeDefined();
    const sceneCalls = sceneCtx.calls.length;
    expect(sceneCalls).toBeGreaterThan(50);
    expect(ctx.calls.filter((c) => c.name === "drawImage")).toHaveLength(1);
    // ana tuvale sahne çizilmez (yüz elipsi yalnızca önbelleğe çizilir)
    expect(ctx.calls.filter((c) => c.name === "ellipse")).toHaveLength(0);

    const made1 = made.length;
    renderFrame(ctx, engine, 16, opts);
    renderFrame(ctx, engine, 32, opts);
    expect(made.length).toBe(made1); // yeni tuval açılmadı (sahne ve sprite'lar yeniden kurulmadı)
    expect(sceneCtx.calls.length).toBe(sceneCalls); // önbelleğe yeni çizim yapılmadı
    expect(ctx.calls.filter((c) => c.name === "drawImage")).toHaveLength(3);
  });

  it("ölçek (ekran boyutu) değişince yeniden kurulur; aynı ekranda aşama türü değişince de", () => {
    const { made, engine } = setup();
    const t = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    const ctx = makeCtx(t);
    renderFrame(ctx, engine, 0, opts);
    const scenes = () => made.filter((m) => m.calls.some((c) => c.name === "ellipse")).length;
    expect(scenes()).toBe(1);
    t.a = t.d = 3; // örn. ekran döndürüldü
    renderFrame(ctx, engine, 16, opts);
    expect(scenes()).toBe(2);
    engine.phaseIndex = 3; // çiğneme aşaması: farklı sahne
    (engine as unknown as { loadPhase(i: number): void }).loadPhase(3);
    renderFrame(ctx, engine, 32, opts);
    expect(made.filter((m) => m.calls.some((c) => c.name === "roundRect" || c.name === "quadraticCurveTo")).length).toBeGreaterThanOrEqual(2);
  });

  it("önbellek kapalıyken (cache:false) sahne doğrudan ana tuvale çizilir", () => {
    const { made, engine } = setup();
    const ctx = makeCtx({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
    renderFrame(ctx, engine, 0, { ...opts, cache: false });
    expect(made.some((m) => m.calls.some((c) => c.name === "ellipse"))).toBe(false); // sahne tuvali açılmadı
    expect(ctx.calls.filter((c) => c.name === "ellipse").length).toBeGreaterThan(0);
  });

  it("belge/destek yoksa (sunucu, eski tarayıcı) sessizce doğrudan çizer", () => {
    (globalThis as { document?: unknown }).document = undefined;
    const engine = new GameEngine(buildPhases(), {}, { reducedMotion: true });
    engine.start();
    const ctx = makeCtx({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
    expect(() => renderFrame(ctx, engine, 0, opts)).not.toThrow();
    expect(ctx.calls.filter((c) => c.name === "ellipse").length).toBeGreaterThan(0);
  });
});

describe("renk karışımı (mixHex)", () => {
  it("uçlar birebir, orta nokta yuvarlanmış; aralık dışı değerler kırpılır; çıktı hep küçük harfli #rrggbb", () => {
    expect(mixHex("#5A2456", "#0F4C5C", 0)).toBe("#5a2456");
    expect(mixHex("#5A2456", "#0F4C5C", 1)).toBe("#0f4c5c");
    expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mixHex("#102030", "#FFFFFF", -3)).toBe("#102030");
    expect(mixHex("#102030", "#FFFFFF", 9)).toBe("#ffffff");
  });
});

// Düğüm ortamında (tuval yok) diş sprite'larının piksel hesabı ilk kullanımda birkaç saniye sürer: bol süre tanınır.
describe("ağız açılma geçişi çizimi (diş araları → iç yüzey)", { timeout: 60_000 }, () => {
  const opts = { reducedMotion: false, showTutorialHand: false } as const;
  const T = { a: 2, b: 0, c: 0, d: 2, e: 7.5, f: 3.25 };
  const inTransition = (e: GameEngine): boolean => e.status === "transition";
  const finish = (e: GameEngine) => {
    let guard = 0;
    while (e.status === "playing" && guard++ < 400) e.assistClean();
  };
  /** Arka plan degradesinin iki rengi (küçük harfli): çizimin ilk iki `addColorStop` çağrısı. */
  const bgStops = (ctx: MockCtx) => ctx.calls.filter((c) => c.name === "addColorStop").slice(0, 2).map((c) => (c.args[1] as string).toLowerCase());

  /** Diş araları aşaması az önce bitmiş: ağız açılma geçişinin ilk karesi. */
  function engineAtOpening(): GameEngine {
    const e = new GameEngine(buildPhases(), {}, { reducedMotion: false });
    e.start();
    finish(e); // dış yüzey
    while (inTransition(e)) e.update(50);
    finish(e); // diş araları → ağız açılarak iç yüzeye geçiş başlar
    e.sparkles.length = 0;
    return e;
  }

  it("geçişin her karesi (çene inmeden başlayıp yerine oturana dek) hatasız, sonlu sayılarla ve dengeli çizilir", () => {
    for (const cache of [true, false]) {
      const e = engineAtOpening();
      expect(e.opening).toBe(true);
      let frames = 0;
      let rendered = 0;
      while (inTransition(e) && frames < 400) {
        // her 2. kare çizilir (kare süresi 32 ms ≈ 30 fps; sprite hazırlığı da tetiklenir)
        if (frames % 2 === 0) {
          const ctx = makeCtx(T);
          expect(() => renderFrame(ctx, e, frames * 16, { ...opts, cache })).not.toThrow();
          expectSane(ctx);
          rendered++;
        }
        e.update(16);
        frames++;
      }
      expect(frames).toBeGreaterThan(60); // ≈ 1,5 sn
      expect(rendered).toBeGreaterThan(30);
    }
  });

  it("çene iner ama yüz dönmez: yüz her karede aynı yerde ve ölçeksiz çizilir; alt dişler ve diş eti çene açıklığı kadar aşağı kayar", () => {
    const e = engineAtOpening();
    let maxShift = 0;
    while (inTransition(e)) {
      const ctx = makeCtx(T);
      renderFrame(ctx, e, 0, { ...opts, cache: false });
      const faces = ctx.calls.filter((c) => c.name === "ellipse" && c.args[2] === 214 && c.args[3] === 300);
      expect(faces).toHaveLength(1);
      expect(faces[0]!.args.slice(0, 2)).toEqual([180, 290]);
      expect(ctx.calls.some((c) => c.name === "scale")).toBe(false); // eski yüz dönme çizimi yatay ölçekliyordu
      const shifts = ctx.calls.filter((c) => c.name === "translate" && c.args[0] === 0).map((c) => c.args[1] as number);
      expect(shifts.some((dy) => Math.abs(dy - JAW_DROP * e.openAmount) < 1e-9), `kare ${e.transitionProgress.toFixed(2)}`).toBe(true);
      maxShift = Math.max(maxShift, ...shifts);
      e.update(16);
    }
    expect(maxShift).toBeGreaterThan(JAW_DROP * 0.98); // çene tam iner (hafif aşımla)
    expect(maxShift).toBeLessThan(JAW_DROP * 1.1);
  });

  it("çene kapalıyken ağız boşluğu (boğaz, bademcik, küçük dil) görünmez; çene indikçe belirir ve tam açıkken tam görünür", () => {
    const throatAlpha = (ctx: MockCtx) => {
      const i = ctx.trace.findIndex((s) => s.startsWith("createRadialGradient(180,318,6,180,318,124)"));
      expect(i, "boğaz degradesi çizilmeli").toBeGreaterThan(0);
      const alphas = ctx.trace.slice(0, i).filter((s) => s.startsWith("globalAlpha="));
      return Number(alphas[alphas.length - 1]!.split("=")[1]);
    };
    const e = engineAtOpening();
    const closed = makeCtx(T);
    renderFrame(closed, e, 0, { ...opts, cache: false });
    expect(e.openAmount).toBe(0);
    expect(throatAlpha(closed)).toBe(0);

    while (inTransition(e) && e.openAmount < 0.15) e.update(16);
    const ajar = makeCtx(T);
    renderFrame(ajar, e, 0, { ...opts, cache: false });
    expect(throatAlpha(ajar)).toBeCloseTo(Math.min(1, e.openAmount * 3), 5);
    expect(throatAlpha(ajar)).toBeGreaterThan(0);

    while (inTransition(e) && e.openAmount < 0.9) e.update(16);
    const wide = makeCtx(T);
    renderFrame(wide, e, 0, { ...opts, cache: false });
    expect(throatAlpha(wide)).toBe(1);
  });

  it("çene tam inince geçiş karesi, iç yüzey oynanış karesiyle birebir aynı çizilir (geçişin sonunda atlama yok)", () => {
    const e = engineAtOpening();
    while (inTransition(e) && e.transitionProgress < OPEN_TO + OPEN_APPEAR + 0.02) e.update(16);
    expect(e.status).toBe("transition");
    expect(e.currentKind).toBe("inner"); // sahne (lekeler) çene inince değişti
    expect(e.openAmount).toBe(1);
    expect(e.openBlend).toBe(1);
    const during = makeCtx(T);
    renderFrame(during, e, 777, { ...opts, cache: false });
    while (inTransition(e)) e.update(16);
    expect(e.status).toBe("playing");
    const after = makeCtx(T);
    renderFrame(after, e, 777, { ...opts, cache: false });
    expect(during.trace.length).toBeGreaterThan(100);
    expect(during.trace).toEqual(after.trace);
  });

  it("çene inince yeni lekeler birden çıkmaz: kısa sürede belirir ve oynanış başlamadan tam görünür", () => {
    // Son çizilen mikrobun saydamlığı = belirme oranı (yeni lekeler temiz değil, kaçmıyor)
    const lastAlpha = (ctx: MockCtx) => {
      const alphas = ctx.trace.filter((s) => s.startsWith("globalAlpha="));
      return Number(alphas[alphas.length - 1]!.split("=")[1]);
    };
    const e = engineAtOpening();
    const alphas: number[] = [];
    while (inTransition(e) && e.transitionProgress < OPEN_TO + OPEN_APPEAR + 0.03) {
      e.update(16);
      if (e.currentKind !== "inner" || e.transitionProgress < OPEN_TO + 0.02) continue;
      const ctx = makeCtx(T);
      renderFrame(ctx, e, 0, { ...opts, cache: false });
      const expected = Math.min(1, (e.transitionProgress - OPEN_TO) / OPEN_APPEAR);
      expect(lastAlpha(ctx)).toBeCloseTo(expected, 5);
      alphas.push(lastAlpha(ctx));
    }
    expect(alphas.length).toBeGreaterThan(5);
    expect(alphas[0]!).toBeLessThan(0.3); // başta neredeyse görünmez
    expect(alphas[alphas.length - 1]!).toBe(1); // sonda tam görünür
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]!).toBeGreaterThanOrEqual(alphas[i - 1]! - 1e-9); // yalnızca belirir
  });

  it("arka plan ve yüz rengi diş araları renginden iç yüzey rengine yumuşakça geçer; geçiş sonunda iç yüzey renginde", () => {
    const e = engineAtOpening();
    const first = makeCtx(T);
    renderFrame(first, e, 0, { ...opts, cache: false });
    expect(bgStops(first)).toEqual([BG.gaps![0].toLowerCase(), BG.gaps![1].toLowerCase()]);
    // "#rrggbb" iki renk arasındaki uzaklık (kanal farklarının toplamı): doğrusal karışımda yalnızca azalır
    const dist = (a: string, b: string) => [1, 3, 5].reduce((s, i) => s + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0);
    let prevGap = dist(BG.gaps![0], BG.inner![0]) + 1;
    while (inTransition(e)) {
      e.update(16);
      if (!inTransition(e)) break;
      const ctx = makeCtx(T);
      renderFrame(ctx, e, 0, { ...opts, cache: false });
      const gap = dist(bgStops(ctx)[0]!, BG.inner![0]); // iç yüzey rengine uzaklık
      expect(gap).toBeLessThanOrEqual(prevGap); // renk yalnızca hedefe yaklaşır
      prevGap = gap;
    }
    expect(prevGap).toBeLessThan(2);
    const last = makeCtx(T);
    renderFrame(last, e, 0, { ...opts, cache: false });
    expect(bgStops(last)).toEqual([BG.inner![0].toLowerCase(), BG.inner![1].toLowerCase()]);
    expect(last.props.fillStyle).toBeDefined();
    expect(FACE.inner!.toLowerCase()).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("azaltılmış harekette geçiş animasyonu çizilmez: eski sahne, çene inince yeni (iç yüzey) sahne doğrudan çizilir", () => {
    const reduced = { ...opts, reducedMotion: true, cache: false } as const;
    const e = engineAtOpening();
    let sawGaps = false;
    let sawInner = false;
    while (inTransition(e)) {
      const ctx = makeCtx(T);
      expect(() => renderFrame(ctx, e, 0, reduced)).not.toThrow();
      expectSane(ctx);
      const stops = bgStops(ctx);
      // renk karışımı yok: ya tam diş araları ya tam iç yüzey rengi
      if (e.currentKind === "gaps") {
        sawGaps = true;
        expect(stops).toEqual([BG.gaps![0].toLowerCase(), BG.gaps![1].toLowerCase()]);
      } else {
        sawInner = true;
        expect(stops).toEqual([BG.inner![0].toLowerCase(), BG.inner![1].toLowerCase()]);
      }
      e.update(96); // seyrek kare: bu test yalnızca "hareketsiz geçiş" mantığını sınar
    }
    expect(sawGaps && sawInner).toBe(true);
  });
});
