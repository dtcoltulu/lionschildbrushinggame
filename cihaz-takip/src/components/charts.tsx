import type { ReactNode } from "react";

/**
 * Basit, JS'siz grafikler (tek seri → lejant yok; başlık seriyi adlandırır). Değerler çubuğun yanında
 * yazılıdır ve her grafiğin altında/yanında aynı verinin tablosu bulunur. Fareyle üzerine gelince
 * (title) tam değer görünür.
 */
export function BarList({ rows, format = (n) => String(n), ariaLabel }: { rows: { key: string; label: ReactNode; value: number; title?: string }[]; format?: (n: number) => string; ariaLabel: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2" aria-label={ariaLabel}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(7rem,12rem)_1fr_auto] items-center gap-3" title={r.title ?? `${typeof r.label === "string" ? r.label : ""}: ${format(r.value)}`}>
          <span className="truncate text-[15px]">{r.label}</span>
          <span className="h-3 rounded-sm bg-slate-100">
            <span className="block h-3 rounded-r-[4px] bg-[var(--color-chart)]" style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value > 0 ? 3 : 0 }} />
          </span>
          <span className="min-w-12 text-right text-[15px] font-semibold tabular-nums">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function MonthBars({ rows, format, ariaLabel }: { rows: { key: string; label: string; short: string; value: number }[]; format: (n: number) => string; ariaLabel: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="overflow-x-auto" role="img" aria-label={ariaLabel}>
      <div className="flex h-48 min-w-[36rem] items-end gap-[2px] border-b border-slate-300 pt-6">
        {rows.map((r) => (
          <div key={r.key} className="group relative flex h-full flex-1 flex-col items-center justify-end" title={`${r.label}: ${format(r.value)}`}>
            {r.value > 0 && <span className="mb-1 whitespace-nowrap text-[11px] font-semibold tabular-nums text-slate-700">{format(r.value)}</span>}
            <span className="block w-[70%] max-w-10 rounded-t-[4px] bg-[var(--color-chart)] group-hover:opacity-80" style={{ height: `${(r.value / max) * 100}%`, minHeight: r.value > 0 ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex min-w-[36rem] gap-[2px] pt-1">
        {rows.map((r) => (
          <span key={r.key} className="flex-1 text-center text-[11px] text-muted">{r.short}</span>
        ))}
      </div>
    </div>
  );
}
