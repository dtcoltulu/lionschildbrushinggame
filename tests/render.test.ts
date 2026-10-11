import { afterEach, describe, expect, it } from "vitest";
import { GameEngine } from "@/game/engine";
import { buildPhases, buildTutorialPhase, LOWER_TEETH, MOUTH_IN, toothRank, UPPER_TEETH, type Rect } from "@/game/layout";
import { renderFrame } from "@/game/render";
import { drawGumBand, drawMolarTile, drawTooth, drawTutorialTooth, FRONT_TOOTH, GUM, INNER_TOOTH } from "@/game/teeth";

interface Call {
  name: string;
  args: unknown[];
}
type MockCtx = CanvasRenderingContext2D & { calls: Call[]; props: Record<string, unknown> };

/** Çizim çağrılarını kaydeden sahte 2D bağlam (gerçek canvas gerektirmez). */
function makeCtx(transform?: { a: number; b: number; c: number; d: number; e: number; f: number }): MockCtx {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {};
  const gradient = () => ({ addColorStop: (o: number, c: string) => void calls.push({ name: "addColorStop", args: [o, c] }) });
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, key: string) {
      if (key === "calls") return calls;
      if (key === "props") return props;
      if (key === "getTransform") return transform ? () => transform : undefined;
      if (key in props) return props[key];
      if (key === "createLinearGradient" || key === "createRadialGradient") {
        return (...args: unknown[]) => {
          calls.push({ name: key, args });
          return gradient();
        };
      }
      return (...args: unknown[]) => void calls.push({ name: key, args });
    },
    set(_t, key: string, v) {
      props[key] = v;
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

/** `drawTooth` içindeki tüm yol noktaları. */
function pathPoints(ctx: MockCtx): [number, number][] {
  const pts: [number, number][] = [];
  for (const c of ctx.calls) {
    if (c.name === "moveTo" || c.name === "lineTo") pts.push([c.args[0] as number, c.args[1] as number]);
    if (c.name === "bezierCurveTo") for (let k = 0; k < 6; k += 2) pts.push([c.args[k] as number, c.args[k + 1] as number]);
  }
  return pts;
}

describe("diş sırası", () => {
  it("diş türü merkezden dışa 0..5, sol ve sağ simetrik", () => {
    expect(Array.from({ length: 12 }, (_, i) => toothRank(i))).toEqual([5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5]);
  });
});

describe("diş çizimi (yalnızca görünüm)", () => {
  const rects: [string, Rect[], boolean][] = [
    ["üst", UPPER_TEETH, true],
    ["alt", LOWER_TEETH, false],
  ];

  for (const [name, teeth, upper] of rects) {
    it(`${name} dişlerin şekli kendi dikdörtgeninin dışına taşmaz (vuruş alanı ile görünüm tutarlı)`, () => {
      teeth.forEach((t, i) => {
        const ctx = makeCtx();
        drawTooth(ctx, t, toothRank(i), upper, FRONT_TOOTH);
        expectSane(ctx);
        const hidden = t.h * 0.2; // diş etinin altında kalan pay
        for (const [x, y] of pathPoints(ctx)) {
          expect(x).toBeGreaterThanOrEqual(t.x - 0.5);
          expect(x).toBeLessThanOrEqual(t.x + t.w + 0.5);
          // gum tarafında `hidden` kadar, kesici kenar tarafında hafif kabarma payı
          const lo = upper ? t.y - hidden - 0.5 : t.y - t.h * 0.05 - 0.5;
          const hi = upper ? t.y + t.h * 1.05 + 0.5 : t.y + t.h + hidden + 0.5;
          expect(y).toBeGreaterThanOrEqual(lo);
          expect(y).toBeLessThanOrEqual(hi);
        }
      });
    });
  }

  it("iç görünüş, diş eti, çiğneme yüzeyi ve öğretici dişi sağlam çizilir", () => {
    for (const fn of [
      (c: MockCtx) => UPPER_TEETH.forEach((t, i) => drawTooth(c, t, toothRank(i), true, INNER_TOOTH, true)),
      (c: MockCtx) => drawGumBand(c, UPPER_TEETH, true, MOUTH_IN, GUM),
      (c: MockCtx) => drawGumBand(c, LOWER_TEETH, false, MOUTH_IN, GUM),
      (c: MockCtx) => Array.from({ length: 12 }, (_, i) => drawMolarTile(c, { x: 24 + (i % 3) * 110, y: 74 + Math.floor(i / 3) * 96, w: 100, h: 86 }, i)),
      (c: MockCtx) => drawTutorialTooth(c),
    ]) {
      const ctx = makeCtx();
      fn(ctx);
      expectSane(ctx);
      expect(ctx.calls.length).toBeGreaterThan(5);
    }
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
    const canvases: { width: number; height: number; getContext: () => MockCtx }[] = [];
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const cctx = makeCtx();
        made.push(cctx);
        const canvas = { width: 0, height: 0, getContext: () => cctx };
        canvases.push(canvas);
        return canvas;
      },
    };
    const engine = new GameEngine(buildPhases(), {}, { reducedMotion: true });
    engine.start();
    return { made, canvases, engine };
  }
  const opts = { reducedMotion: true, showTutorialHand: false } as const;

  it("sahne bir kez çizilir; sonraki karelerde yalnızca önbellek basılır", () => {
    const { made, engine } = setup();
    const ctx = makeCtx({ a: 2, b: 0, c: 0, d: 2, e: 10.5, f: 4.25 });
    renderFrame(ctx, engine, 0, opts);
    expect(made).toHaveLength(1);
    const sceneCalls = made[0]!.calls.length;
    expect(sceneCalls).toBeGreaterThan(50);
    expect(ctx.calls.filter((c) => c.name === "drawImage")).toHaveLength(1);
    // ana tuvale sahne çizilmez (yüz elipsi yalnızca önbelleğe çizilir)
    expect(ctx.calls.filter((c) => c.name === "ellipse")).toHaveLength(0);

    renderFrame(ctx, engine, 16, opts);
    renderFrame(ctx, engine, 32, opts);
    expect(made).toHaveLength(1);
    expect(made[0]!.calls.length).toBe(sceneCalls); // önbelleğe yeni çizim yapılmadı
    expect(ctx.calls.filter((c) => c.name === "drawImage")).toHaveLength(3);
  });

  it("ölçek (ekran boyutu) değişince yeniden kurulur; aynı ekranda aşama türü değişince de", () => {
    const { made, engine } = setup();
    const t = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    const ctx = makeCtx(t);
    renderFrame(ctx, engine, 0, opts);
    t.a = t.d = 3; // örn. ekran döndürüldü
    renderFrame(ctx, engine, 16, opts);
    expect(made).toHaveLength(2);
    engine.phaseIndex = 3; // çiğneme aşaması: farklı sahne
    (engine as unknown as { loadPhase(i: number): void }).loadPhase(3);
    renderFrame(ctx, engine, 32, opts);
    expect(made).toHaveLength(3);
  });

  it("önbellek kapalıyken (cache:false) sahne doğrudan ana tuvale çizilir", () => {
    const { made, engine } = setup();
    const ctx = makeCtx({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
    renderFrame(ctx, engine, 0, { ...opts, cache: false });
    expect(made).toHaveLength(0);
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
