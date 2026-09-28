"use client";
import { useSyncExternalStore } from "react";
import { isMuted, setMuted, sfx, subscribeMuted, unlockAudio } from "@/game/audio";
import { tr } from "@/content/tr";

export function SoundToggle({ className = "" }: { className?: string }) {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  return (
    <button
      type="button"
      onClick={() => {
        unlockAudio();
        const next = !muted;
        setMuted(next);
        if (!next) sfx.tap();
      }}
      aria-label={muted ? tr.soundOff : tr.soundOn}
      aria-pressed={!muted}
      className={`inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-2xl shadow-md ${className}`}
    >
      <span aria-hidden="true">{muted ? "🔇" : "🔊"}</span>
    </button>
  );
}
