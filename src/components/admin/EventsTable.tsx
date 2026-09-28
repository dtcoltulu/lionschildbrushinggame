import type { StoredEvent } from "@/types/analytics";

const LABELS: Record<StoredEvent["name"], string> = {
  landing_view: "Sayfa açıldı",
  tutorial_started: "Öğretici başladı",
  tutorial_completed: "Öğretici bitti",
  tutorial_skipped: "Öğretici atlandı",
  game_started: "Oyun başladı",
  phase_completed: "Aşama bitti",
  game_completed: "Oyun tamamlandı",
  reward_screen_viewed: "Ödül ekranı",
  replay_started: "Tekrar oynama",
};

export function EventsTable({ events, tz }: { events: StoredEvent[]; tz: string }) {
  const fmt = new Intl.DateTimeFormat("tr-TR", { timeZone: tz, dateStyle: "short", timeStyle: "medium" });
  if (!events.length) return <p className="text-sm text-ink/70">Henüz olay yok.</p>;
  return (
    <div className="max-h-96 overflow-auto rounded-xl ring-1 ring-purple/10">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <caption className="sr-only">Son olaylar</caption>
        <thead className="sticky top-0 bg-purple-soft text-left">
          <tr>
            <th scope="col" className="px-3 py-2">Zaman</th>
            <th scope="col" className="px-3">Olay</th>
            <th scope="col" className="px-3">Anonim kod</th>
            <th scope="col" className="px-3 text-right">Oyun #</th>
            <th scope="col" className="px-3 text-right">Süre</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-b border-purple/10 bg-white">
              <td className="px-3 py-1.5 tabular-nums">{fmt.format(new Date(e.occurredAt))}</td>
              <td className="px-3 font-semibold">{LABELS[e.name]}{e.phase ? ` ${e.phase}` : ""}</td>
              <td className="px-3 font-mono text-xs text-ink/70">{e.sessionId.slice(0, 8)}</td>
              <td className="px-3 text-right tabular-nums">{e.playIndex ?? "—"}</td>
              <td className="px-3 text-right tabular-nums">{e.durationMs ? `${Math.round(e.durationMs / 1000)} sn` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
