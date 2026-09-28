"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { tr } from "@/content/tr";
import { sfx } from "@/game/audio";
import { TOTAL_PHASES } from "@/game/constants";
import { GameCanvas, type GameCanvasHandle } from "./GameCanvas";
import { ProgressBar } from "./ProgressBar";
import { SoundToggle } from "./SoundToggle";

interface Props {
  onPhaseComplete: (phaseIndex: number, durationMs: number) => void;
  onComplete: (totalMs: number) => void;
}

export function PlayScreen({ onPhaseComplete, onComplete }: Props) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState(0);
  const [message, setMessage] = useState<string>(tr.phases[0].intro);
  const [live, setLive] = useState<string>(tr.phases[0].intro);
  const controlRef = useRef<GameCanvasHandle | null>(null);
  const cleaned = useRef(0);
  const flash = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef(0);

  useEffect(() => () => void (flash.current && clearTimeout(flash.current)), []);

  const showFor = useCallback((text: string, restore: string, ms = 1300) => {
    setMessage(text);
    if (flash.current) clearTimeout(flash.current);
    flash.current = setTimeout(() => setMessage(restore), ms);
  }, []);

  const callbacks = {
    onPhaseStart: (i: number) => {
      phaseRef.current = i;
      setPhase(i);
      cleaned.current = 0;
      if (flash.current) clearTimeout(flash.current);
      const text = tr.phases[i]?.intro ?? "";
      setMessage(text);
      setLive(text);
    },
    onPhaseComplete: (i: number, ms: number) => {
      sfx.phase();
      if (flash.current) clearTimeout(flash.current);
      const text = tr.phases[i]?.done ?? "";
      setMessage(text);
      setLive(text);
      onPhaseComplete(i, ms);
    },
    onProgress: setProgress,
    onComplete: (ms: number) => {
      sfx.fanfare();
      onComplete(ms);
    },
    onSwipe: () => sfx.swipe(),
    onPatchCleaned: () => {
      sfx.clean();
      cleaned.current += 1;
      if (cleaned.current % 4 === 0) {
        const enc = tr.encouragement[Math.floor(cleaned.current / 4) % tr.encouragement.length]!;
        showFor(enc, tr.phases[phaseRef.current]?.intro ?? "");
      }
    },
  };

  return (
    <main className="screen relative flex flex-col bg-purple text-white" data-testid="play-screen" data-phase={phase + 1}>
      <header className="z-10 flex flex-col gap-2 px-4 pb-2 pt-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <ProgressBar value={progress} />
          </div>
          <SoundToggle />
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded-full bg-gold px-3 py-1 text-sm font-black text-ink" data-testid="phase-pill">
            {phase + 1}/{TOTAL_PHASES}
          </span>
          <p className="text-lg font-extrabold leading-snug" aria-hidden="true" data-testid="message">
            {message}
          </p>
        </div>
        <p className="sr-only" aria-live="polite">
          {tr.phases[phase]?.name}. {live}
        </p>
      </header>

      <div className="relative flex-1 touch-none" style={{ minHeight: 320 }}>
        <GameCanvas mode="game" callbacks={callbacks} controlRef={controlRef} />
        <button
          type="button"
          onClick={() => controlRef.current?.assist()}
          aria-label={tr.helpLabel}
          className="absolute bottom-4 right-4 z-10 min-h-[48px] min-w-[48px] rounded-full bg-white/90 px-4 text-base font-extrabold text-purple shadow-lg"
          data-testid="help"
        >
          ✨ {tr.help}
        </button>
      </div>
    </main>
  );
}
