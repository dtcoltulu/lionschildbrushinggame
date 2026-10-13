import { afterEach, describe, expect, it } from "vitest";
import { GameEngine } from "@/game/engine";
import { CHEW_KINDS, CHEW_TILES, buildPhases, buildTutorialPhase, LOWER_TEETH, MOUTH_IN, toothRank, UPPER_TEETH } from "@/game/layout";
import { crownPixels, drawChewTiles, warmCrowns } from "@/game/occlusal";
import { renderFrame } from "@/game/render";
import { drawGumSprite, warmGums } from "@/game/gums";
import { setDeviceScale } from "@/game/shade";
import { drawGumBand, drawTooth, drawTutorialTooth, FRONT_TOOTH, GUM, INNER_TOOTH } from "@/game/teeth";
import { drawTeethRow, toothPixels, warmTeeth } from "@/game/toothsprite";

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
