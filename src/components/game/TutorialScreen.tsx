"use client";
import { useEffect, useRef, useState } from "react";
import { tr } from "@/content/tr";
import { sfx } from "@/game/audio";
import { GameCanvas } from "./GameCanvas";
import { SoundToggle } from "./SoundToggle";

interface Props {
  onDone: () => void;
  onSkip: () => void;
}

export function TutorialScreen({ onDone, onSkip }: Props) {
  const [finished, setFinished] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });

  useEffect(() => {
    if (!finished) return;
    timer.current = setTimeout(() => doneRef.current(), 2200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [finished]);

  return (
    <main className="screen relative flex flex-col bg-purple text-white" data-testid="tutorial-screen">
      <header className="z-10 flex items-start justify-between gap-3 px-4 pb-2 pt-3">
        <div>
          <h1 className="text-2xl font-black">{finished ? tr.tutorial.done : tr.tutorial.title}</h1>
          <p className="text-lg font-semibold opacity-90">{finished ? "" : tr.tutorial.hint}</p>
        </div>
        <SoundToggle />
      </header>

      <div className="relative flex-1 touch-none" style={{ minHeight: 320 }}>
        <GameCanvas
          mode="tutorial"
          callbacks={{
            onSwipe: () => sfx.swipe(),
            onPatchCleaned: () => sfx.clean(),
            onComplete: () => {
              sfx.phase();
              setFinished(true);
            },
          }}
        />
      </div>

      <footer className="z-10 flex items-center justify-between gap-3 px-4 py-3">
        <button type="button" onClick={onSkip} className="btn-big btn-ghost text-white" data-testid="skip-tutorial">
          {tr.tutorial.skip}
        </button>
        {finished && (
          <button type="button" onClick={onDone} className="btn-big btn-gold anim-pop text-xl" data-testid="tutorial-go">
            {tr.tutorial.go}
          </button>
        )}
      </footer>
    </main>
  );
}
