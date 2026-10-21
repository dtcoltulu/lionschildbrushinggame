/** Tarihler "YYYY-MM-DD" metni olarak taşınır; "bugün" klinik saat dilimine (İstanbul) göredir. */
export const CLINIC_TZ = "Europe/Istanbul";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function todayIstanbul(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isValidIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function utc(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

/** b − a, gün olarak. */
export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

export function addDays(s: string, n: number): string {
  return new Date(utc(s) + n * 86_400_000).toISOString().slice(0, 10);
}

/** "2026-10-17" → "17.10.2026" */
export function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

/** ISO zaman damgası → "17.10.2026 14:05" (İstanbul) */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const parts = new Intl.DateTimeFormat("tr-TR", {
    timeZone: CLINIC_TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}`;
}

/** ISO zaman damgasının İstanbul'daki günü. */
export function isoToIstanbulDate(iso: string): string {
  return todayIstanbul(new Date(iso));
}

export const MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** "2026-10" → "Ekim 2026" */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS_TR[Number(m) - 1] ?? m} ${y}`;
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** "2026-10" ayına n ay ekler. */
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const idx = y! * 12 + (m! - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function monthRange(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  for (let k = fromKey; k <= toKey && out.length < 240; k = addMonths(k, 1)) out.push(k);
  return out;
}

export function lastDayOfMonth(key: string): string {
  return addDays(`${addMonths(key, 1)}-01`, -1);
}
