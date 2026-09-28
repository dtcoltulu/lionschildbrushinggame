"use client";
import { useState } from "react";
import type { HourRow } from "@/lib/kpi";
import { hourLabel } from "@/lib/csv";

/** Bağımlılıksız SVG çubuk grafik: tek seri (kullanım = başlatılan oyunlar). Tablo alternatifi aşağıdadır. */
export function HourlyChart({ rows }: { rows: HourRow[] }) {
  const [active, setActive] = useState<number | null>(null);

  const withData = rows.filter((r) => r.plays + r.landing + r.completions > 0).map((r) => r.hour);
  const lo = withData.length ? Math.max(0, Math.min(...withData) - 1) : 9;
  const hi = withData.length ? Math.min(23, Math.max(...withData) + 1) : 17;
  const shown = rows.filter((r) => r.hour >= lo && r.hour <= Math.max(hi, lo + 5));
  const max = Math.max(4, ...shown.map((r) => r.plays));
  const niceMax = Math.ceil(max / 4) * 4;

  const W = 640;
  const H = 240;
  const m = { l: 40, r: 12, t: 16, b: 36 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const step = iw / shown.length;
  const bw = Math.min(28, step * 0.6);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceMax * f));

  const a = active !== null ? shown[active] : null;

  return (
    <figure className="m-0">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Saatlere göre oyun kullanımı grafiği. Ayrıntılar aşağıdaki tabloda.">
          {ticks.map((t) => {
            const y = m.t + ih - (t / niceMax) * ih;
            return (
              <g key={t}>
                <line x1={m.l} x2={W - m.r} y1={y} y2={y} stroke="#e4def2" strokeWidth={1} />
                <text x={m.l - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#5b5670">
                  {t}
                </text>
              </g>
            );
          })}
          {shown.map((r, i) => {
            const h = (r.plays / niceMax) * ih;
            const x = m.l + i * step + (step - bw) / 2;
            const y = m.t + ih - h;
            const on = active === i;
            return (
              <g
                key={r.hour}
                tabIndex={0}
                role="listitem"
                aria-label={`${hourLabel(r.hour)}: ${r.plays} kullanım`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(i)}
              >
                {/* geniş, görünmez dokunma alanı */}
                <rect x={m.l + i * step} y={m.t} width={step} height={ih} fill="transparent" />
                {r.plays > 0 && (
                  <path
                    d={`M${x},${m.t + ih} V${y + 4} Q${x},${y} ${x + 4},${y} H${x + bw - 4} Q${x + bw},${y} ${x + bw},${y + 4} V${m.t + ih} Z`}
                    fill={on ? "#2e1a5e" : "#5b3fa8"}
                  />
                )}
                {r.plays > 0 && (
                  <text x={x + bw / 2} y={y - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1c1038">
                    {r.plays}
                  </text>
                )}
                <text x={x + bw / 2} y={H - 14} textAnchor="middle" fontSize={11} fill="#5b5670">
                  {String(r.hour).padStart(2, "0")}
                </text>
              </g>
            );
          })}
          <line x1={m.l} x2={W - m.r} y1={m.t + ih} y2={m.t + ih} stroke="#8b85a3" strokeWidth={1} />
        </svg>
        <div aria-live="polite" className="min-h-6 text-sm font-semibold text-ink">
          {a ? `${hourLabel(a.hour)} → ${a.plays} kullanım (${a.starts} ilk, ${a.replays} tekrar) · ${a.completions} tamamlanma` : "Bir çubuğun üzerine gelin ya da dokunun."}
        </div>
      </div>
      <figcaption className="mt-1 text-xs text-ink/70">Kullanım = başlatılan oyunlar (ilk oyun + tekrar oynama). Saatler Türkiye saatidir.</figcaption>
    </figure>
  );
}
