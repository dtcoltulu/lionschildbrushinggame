"use client";
import { useEffect, useRef, type RefObject } from "react";
import { tr } from "@/content/tr";
import { WORLD_H, WORLD_W } from "@/game/constants";
import { GameEngine } from "@/game/engine";
import { buildPhases, buildTutorialPhase } from "@/game/layout";
import { renderFrame } from "@/game/render";
import type { EngineCallbacks } from "@/game/types";

export interface GameCanvasHandle {
  assist(): void;
}

interface Props {
  mode: "tutorial" | "game";
  callbacks: EngineCallbacks;
  controlRef?: RefObject<GameCanvasHandle | null>;
}

/** Parmak parmağın altında kalmasın diye dokunmatikte fırça ~26 birim yukarıda çizilir. */
const TOUCH_OFFSET_Y = 26;

export function GameCanvas({ mode, callbacks, controlRef }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cbRef = useRef(callbacks);
  useEffect(() => {
    cbRef.current = callbacks;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const engine = new GameEngine(
      mode === "tutorial" ? [buildTutorialPhase()] : buildPhases(),
      {
        onPhaseStart: (i) => cbRef.current.onPhaseStart?.(i),
        onPhaseComplete: (i, ms) => cbRef.current.onPhaseComplete?.(i, ms),
        onProgress: (v) => cbRef.current.onProgress?.(v),
        onComplete: (ms) => cbRef.current.onComplete?.(ms),
        onSwipe: () => cbRef.current.onSwipe?.(),
        onPatchCleaned: () => cbRef.current.onPatchCleaned?.(),
        onTurn: () => cbRef.current.onTurn?.(),
      },
      { reducedMotion: reduced, swipesPerPatch: mode === "tutorial" ? 3 : undefined },
    );

    let scale = 1;
    let ox = 0;
    let oy = 0;
    let dpr = 1;
    let cssW = 0;
    let cssH = 0;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      cssW = Math.max(1, r.width);
      cssH = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      scale = Math.min(cssW / WORLD_W, cssH / WORLD_H);
      ox = (cssW - WORLD_W * scale) / 2;
      oy = (cssH - WORLD_H * scale) / 2;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const toWorld = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const off = e.pointerType === "mouse" ? 0 : TOUCH_OFFSET_Y;
      const x = (e.clientX - r.left - ox) / scale;
      const y = (e.clientY - r.top - oy) / scale - off;
      return { x: Math.max(0, Math.min(WORLD_W, x)), y: Math.max(0, Math.min(WORLD_H, y)) };
    };

    const down = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* yoksay */
      }
      engine.pointerDown(toWorld(e));
    };
    const move = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      if (list.length > 1) for (const ce of list) engine.pointerMove(toWorld(ce));
      else engine.pointerMove(toWorld(e));
    };
    const up = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      engine.pointerUp();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        engine.assistClean();
      }
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("keydown", key);
    const noMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener("contextmenu", noMenu);

    if (controlRef) controlRef.current = { assist: () => engine.assistClean() };

    let raf = 0;
    let last = performance.now();
    let stopped = false;
    const loop = (now: number) => {
      if (stopped) return;
      const dt = now - last;
      last = now;
      engine.update(dt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#221248";
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
      renderFrame(ctx, engine, now, { reducedMotion: reduced, showTutorialHand: mode === "tutorial" });
      raf = requestAnimationFrame(loop);
    };
    const onVis = () => {
      last = performance.now();
    };
    document.addEventListener("visibilitychange", onVis);

    engine.start();
    raf = requestAnimationFrame(loop);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("keydown", key);
      canvas.removeEventListener("contextmenu", noMenu);
      if (controlRef) controlRef.current = null;
    };
    // Motor yalnızca mod değişince yeniden kurulur; callback'ler ref üzerinden okunur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="game-canvas"
        role="img"
        aria-label={tr.canvasLabel}
        tabIndex={0}
        data-testid="game-canvas"
      />
    </div>
  );
}
