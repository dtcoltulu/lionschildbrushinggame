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

/** "Sence yeterli ve etkin temizlendi mi?" cevapları (bir aşama için). */
export interface SelfCheckPhase {
  phase: number;
  yes: number;
  no: number;
  total: number;
  /** Evet / toplam (0..1); cevap yoksa null. */
  yesRate: number | null;
}

/** Bir cevap grubunun Evet/Hayır sayısı ve Evet oranı. */
export interface SelfCheckSplit {
  yes: number;
  no: number;
  total: number;
  /** Evet / toplam (0..1); cevap yoksa null. */
  yesRate: number | null;
}

/**
 * Soru her aşama bittikten sonra (diğer yüzeyler hâlâ kalmışken) sorulur: "Evet" = çocuk işi erken bırakmak istedi,
 * "Hayır" = doğru farkındalık. Oranlar cevap sayısı üzerindendir (bir çocuk birden çok kez cevaplar).
 */
export interface SelfCheckStats {
  yes: number;
  no: number;
  total: number;
  yesRate: number | null;
  noRate: number | null;
  /** En az bir kez cevap veren benzersiz çocuk (tarayıcı). */
  children: number;
  /** En az bir kez "Evet" diyen benzersiz çocuk (tarayıcı). */
  childrenYes: number;
  /**
   * "Başlangıç yanılgısı": çocuğun (tarayıcının) zaman sırasıyla İLK cevabı "Evet" olanların sayısı (payda: `children`).
   * İlk cevap henüz hiçbir geri bildirim görülmeden verildiği için en temiz ölçüdür; sonraki cevaplar "doğru cevabı öğrenme"den etkilenir.
   */
  firstYes: number;
  firstYesRate: number | null;
  /** Cevaplar çocuğun ilk oyunu ile tekrar oyunlarına bölünür (tekrarlarda doğru cevap öğrenilmiş olabilir). */
  firstPlay: SelfCheckSplit;
  replayPlays: SelfCheckSplit;
  /**
   * Soruların oyuna eklediği süre (medyan): (soru dahil gerçek süre) − (aktif oyun süresi). Soru süresi oyun süresine sayılmadığı için
   * "Ortalama süre" bunu göstermez; bu, sorunun oyunu ne kadar uzattığını (koruma göstergesi) ölçer. Tamamlanan ve en az bir cevabı olan oyunlar.
   */
  overheadMedianMs: number | null;
  overheadSamples: number;
  byPhase: SelfCheckPhase[];
}

export interface Kpis {
  landingViews: number;
  landingVisitors: number;
  starters: number;
  /** Başlatma oranı: oyunu başlatan / QR landing'i açan benzersiz ziyaretçi (0..1; en çok 1). */
  startRate: number | null;
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
  selfCheck: SelfCheckStats;
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
/** Bir oyunun başlangıcı ile bitişi arasındaki gerçek süre bundan uzunsa (telefon bırakılmış) soru süresi hesabına katılmaz. */
const MAX_WALL_CLOCK_MS = 30 * 60 * 1000;

/** Sıralı dizinin medyanı; boşsa null. */
function medianOf(sorted: number[]): number | null {
  if (!sorted.length) return null;
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
}

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
  const median = medianOf(durations);

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

  const selfCheck = computeSelfCheck(events);

  const devices = { mobile: 0, tablet: 0, desktop: 0, unknown: 0 };
  for (const s of sessions) devices[s.deviceClass ?? "unknown"] += 1;

  const times = events.map((e) => e.occurredAt).sort();

  return {
    landingViews: count("landing_view"),
    landingVisitors,
    starters,
    startRate: landingVisitors > 0 ? Math.min(1, starters / landingVisitors) : null,
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
    selfCheck,
    devices,
    firstEventAt: times[0] ?? null,
    lastEventAt: times.at(-1) ?? null,
  };
}

function splitOf(yes: number, no: number): SelfCheckSplit {
  const total = yes + no;
  return { yes, no, total, yesRate: total > 0 ? yes / total : null };
}

/** `a`, `b`'den ÖNCE mi? Zaman sırasıyla; zamanlar eşitse (ya da çözümlenemezse) kimliğe göre, böylece sonuç kararlıdır. */
function isEarlier(a: StoredEvent, b: StoredEvent): boolean {
  const ta = Date.parse(a.occurredAt);
  const tb = Date.parse(b.occurredAt);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta < tb;
  return a.id < b.id;
}

/**
 * Soruların oyuna eklediği süre (medyan): tamamlanan ve en az bir cevabı olan her oyun için
 * (game_completed − game_started/replay_started gerçek süresi) − (aktif oyun süresi). Aynı `playId`'li olaylar eşlenir.
 * Gerçek süre fazla uzun (telefon bırakılmış) ya da olaylar eksikse o oyun atlanır; negatif fark (saat farkı) 0 sayılır.
 */
function questionOverhead(events: StoredEvent[]): { medianMs: number | null; samples: number } {
  const started = new Map<string, number>();
  const completed = new Map<string, { at: number; activeMs: number }>();
  const answered = new Set<string>();
  for (const e of events) {
    if (!e.playId) continue;
    if (e.name === "game_started" || e.name === "replay_started") {
      const t = Date.parse(e.occurredAt);
      const prev = started.get(e.playId);
      if (Number.isFinite(t) && (prev === undefined || t < prev)) started.set(e.playId, t);
    } else if (e.name === "game_completed") {
      const t = Date.parse(e.occurredAt);
      if (Number.isFinite(t) && e.durationMs !== null && e.durationMs > 0 && e.durationMs <= MAX_VALID_DURATION_MS && !completed.has(e.playId)) {
        completed.set(e.playId, { at: t, activeMs: e.durationMs });
      }
    } else if (e.name === "self_check_yes" || e.name === "self_check_no") {
      answered.add(e.playId);
    }
  }
  const overheads: number[] = [];
  for (const [playId, c] of completed) {
    const s = started.get(playId);
    if (s === undefined || !answered.has(playId)) continue;
    const wall = c.at - s;
    if (wall <= 0 || wall > MAX_WALL_CLOCK_MS) continue;
    overheads.push(Math.max(0, wall - c.activeMs));
  }
  overheads.sort((a, b) => a - b);
  return { medianMs: medianOf(overheads), samples: overheads.length };
}

function computeSelfCheck(events: StoredEvent[]): SelfCheckStats {
  let yes = 0;
  let no = 0;
  let firstPlayYes = 0;
  let firstPlayNo = 0;
  let replayYes = 0;
  let replayNo = 0;
  const answered = new Set<string>();
  const saidYes = new Set<string>();
  const firstAnswer = new Map<string, StoredEvent>();
  const phases = new Map<number, { yes: number; no: number }>();
  for (const e of events) {
    if (e.name !== "self_check_yes" && e.name !== "self_check_no") continue;
    const isYes = e.name === "self_check_yes";
    if (isYes) yes += 1;
    else no += 1;
    // Çocuğun ilk oyunu (playIndex 1; eski kayıtlarda yoksa ilk sayılır) ile tekrar oyunları (playIndex ≥ 2)
    if (e.playIndex !== null && e.playIndex > 1) {
      if (isYes) replayYes += 1;
      else replayNo += 1;
    } else if (isYes) firstPlayYes += 1;
    else firstPlayNo += 1;
    answered.add(e.sessionId);
    if (isYes) saidYes.add(e.sessionId);
    const prev = firstAnswer.get(e.sessionId);
    if (!prev || isEarlier(e, prev)) firstAnswer.set(e.sessionId, e);
    if (e.phase !== null) {
      const a = phases.get(e.phase) ?? { yes: 0, no: 0 };
      if (isYes) a.yes += 1;
      else a.no += 1;
      phases.set(e.phase, a);
    }
  }
  const total = yes + no;
  const byPhase: SelfCheckPhase[] = [...phases.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([phase, a]) => ({ phase, yes: a.yes, no: a.no, total: a.yes + a.no, yesRate: a.yes / (a.yes + a.no) }));
  let firstYes = 0;
  for (const e of firstAnswer.values()) if (e.name === "self_check_yes") firstYes += 1;
  const overhead = questionOverhead(events);
  return {
    yes,
    no,
    total,
    yesRate: total > 0 ? yes / total : null,
    noRate: total > 0 ? no / total : null,
    children: answered.size,
    childrenYes: saidYes.size,
    firstYes,
    firstYesRate: answered.size > 0 ? firstYes / answered.size : null,
    firstPlay: splitOf(firstPlayYes, firstPlayNo),
    replayPlays: splitOf(replayYes, replayNo),
    overheadMedianMs: overhead.medianMs,
    overheadSamples: overhead.samples,
    byPhase,
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
