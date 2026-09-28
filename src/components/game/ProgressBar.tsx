import { tr } from "@/content/tr";

export function ProgressBar({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={tr.progressLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-5 flex-1 overflow-hidden rounded-full bg-white/25 ring-2 ring-white/60"
      >
        <div
          className="anim-shine h-full rounded-full bg-gradient-to-r from-mint via-gold to-mint transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-14 text-right text-lg font-extrabold tabular-nums text-white">%{pct}</span>
    </div>
  );
}
