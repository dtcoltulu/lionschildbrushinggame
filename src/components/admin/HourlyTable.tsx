import { hourLabel } from "@/lib/csv";
import type { HourRow } from "@/lib/kpi";

export function HourlyTable({ rows }: { rows: HourRow[] }) {
  const shown = rows.filter((r) => r.landing + r.plays + r.completions > 0);
  if (!shown.length) return <p className="text-sm text-ink/70">Henüz veri yok.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <caption className="sr-only">Saatlik dağılım</caption>
        <thead>
          <tr className="border-b-2 border-purple/30 text-left">
            <th scope="col" className="py-2 pr-3">Saat</th>
            <th scope="col" className="px-2 text-right">Sayfa görüntüleme</th>
            <th scope="col" className="px-2 text-right">İlk oyun</th>
            <th scope="col" className="px-2 text-right">Tekrar</th>
            <th scope="col" className="px-2 text-right">Kullanım</th>
            <th scope="col" className="pl-2 text-right">Tamamlanma</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.hour} className="border-b border-purple/10">
              <th scope="row" className="py-1.5 pr-3 text-left font-semibold">{hourLabel(r.hour)}</th>
              <td className="px-2 text-right tabular-nums">{r.landing}</td>
              <td className="px-2 text-right tabular-nums">{r.starts}</td>
              <td className="px-2 text-right tabular-nums">{r.replays}</td>
              <td className="px-2 text-right font-bold tabular-nums">{r.plays}</td>
              <td className="pl-2 text-right tabular-nums">{r.completions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
