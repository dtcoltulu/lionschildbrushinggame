import type { StoredEvent, StoredSession } from "@/types/analytics";

export interface HourRow {
  date: string; // YYYY-MM-DD (yerel)
  hour: number; // 0-23 (yerel)
  landing: number;
  starts: number; // ilk oyun başlatma
  replays: number;
  completions: number;
  /** "Kullanım" = başlatılan tüm oyunlar (ilk + tekrar). */
  plays: number;
}

export interface PhaseStat {
  phase: number;
  count: number;
  avgMs: number;
}

export interface Kpis {
  landingViews: number;
  landingVisitors: number;
  starters: number;
  completers: number;
  completionRate: number | null; // 0..1
  totalCompletions: number;
  replays: number;
  tutorialSkipped: number;
  tutorialCompleted: number;
  avgDurationMs: number | null;
  medianDurationMs: number | null;
  durationSamples: number;
  hourly: HourRow[];
  dates: string[];
  phases: PhaseStat[];
  devices: { mobile: number; tablet: number; desktop: number; unknown: number };
  firstEventAt: string | null;
  lastEventAt: string | null;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function localParts(iso: string, tz: string): { date: string; hour: number } {
  const parts = formatter(tz).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

/** Aykırı değerleri (unutulmuş telefon vb.) dışlamak için üst sınır. */
const MAX_VALID_DURATION_MS = 15 * 60 * 1000;

export function computeKpis(events: StoredEvent[], sessions: StoredSession[], tz: string): Kpis {
  const distinct = (name: StoredEvent["name"]) =>
    new Set(events.filter((e) => e.name === name).map((e) => e.sessionId));
  const count = (name: StoredEvent["name"]) => events.reduce((n, e) => n + (e.name === name ? 1 : 0), 0);

  const landingVisitors = distinct("landing_view").size;
  const starters = distinct("game_started").size;
  const completers = distinct("game_completed").size;

  const durations = events
    .filter(
      (e) =>
        e.name === "game_completed" &&
        (e.playIndex === null || e.playIndex === 1) &&
        e.durationMs !== null &&
        e.durationMs > 0 &&
        e.durationMs <= MAX_VALID_DURATION_MS,
    )
    .map((e) => e.durationMs as number)
    .sort((a, b) => a - b);
  const avg = durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : null;
  const median = durations.length
    ? durations.length % 2
      ? durations[(durations.length - 1) / 2]!
      : (durations[durations.length / 2 - 1]! + durations[durations.length / 2]!) / 2
    : null;

  const buckets = new Map<string, HourRow>();
  for (const e of events) {
    if (
      e.name !== "landing_view" &&
      e.name !== "game_started" &&
      e.name !== "replay_started" &&
      e.name !== "game_completed"
    ) {
      continue;
    }
    const { date, hour } = localParts(e.occurredAt, tz);
    const key = `${date}T${hour}`;
    let row = buckets.get(key);
    if (!row) {
      row = { date, hour, landing: 0, starts: 0, replays: 0, completions: 0, plays: 0 };
      buckets.set(key, row);
    }
    if (e.name === "landing_view") row.landing += 1;
    else if (e.name === "game_started") {
      row.starts += 1;
      row.plays += 1;
    } else if (e.name === "replay_started") {
      row.replays += 1;
      row.plays += 1;
    } else row.completions += 1;
  }
  const hourly = [...buckets.values()].sort((a, b) => (a.date === b.date ? a.hour - b.hour : a.date < b.date ? -1 : 1));
  const dates = [...new Set(hourly.map((h) => h.date))];

  const phaseAgg = new Map<number, { n: number; sum: number }>();
  for (const e of events) {
    if (e.name === "phase_completed" && e.phase !== null && e.durationMs !== null) {
      const a = phaseAgg.get(e.phase) ?? { n: 0, sum: 0 };
      a.n += 1;
      a.sum += e.durationMs;
      phaseAgg.set(e.phase, a);
    }
  }
  const phases: PhaseStat[] = [...phaseAgg.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([phase, a]) => ({ phase, count: a.n, avgMs: a.sum / a.n }));

  const devices = { mobile: 0, tablet: 0, desktop: 0, unknown: 0 };
  for (const s of sessions) devices[s.deviceClass ?? "unknown"] += 1;

  const times = events.map((e) => e.occurredAt).sort();

  return {
    landingViews: count("landing_view"),
    landingVisitors,
    starters,
    completers,
    completionRate: starters > 0 ? completers / starters : null,
    totalCompletions: count("game_completed"),
    replays: count("replay_started"),
    tutorialSkipped: count("tutorial_skipped"),
    tutorialCompleted: count("tutorial_completed"),
    avgDurationMs: avg,
    medianDurationMs: median,
    durationSamples: durations.length,
    hourly,
    dates,
    phases,
    devices,
    firstEventAt: times[0] ?? null,
    lastEventAt: times.at(-1) ?? null,
  };
}

/** Belirli bir güne (ya da tüm günlere) göre 24 saatlik dizi. Boş saatler 0 döner. */
export function hourlyForDate(rows: HourRow[], date: string | null): HourRow[] {
  const out: HourRow[] = Array.from({ length: 24 }, (_, hour) => ({
    date: date ?? "all",
    hour,
    landing: 0,
    starts: 0,
    replays: 0,
    completions: 0,
    plays: 0,
  }));
  for (const r of rows) {
    if (date && r.date !== date) continue;
    const t = out[r.hour]!;
    t.landing += r.landing;
    t.starts += r.starts;
    t.replays += r.replays;
    t.completions += r.completions;
    t.plays += r.plays;
  }
  return out;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sn`;
  return `${Math.floor(s / 60)} dk ${s % 60} sn`;
}

export function formatPercent(v: number | null): string {
  if (v === null) return "—";
  return `%${(v * 100).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}
