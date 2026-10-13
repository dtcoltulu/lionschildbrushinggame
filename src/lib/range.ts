import { localParts } from "@/lib/kpi";
import type { CampaignData } from "@/lib/store";

/**
 * Tarih aralığı süzgeci: kampanya saat diliminde yerel gün, uçlar DAHİL. Boş uç = sınırsız.
 * Veriler silinmez; yalnızca panelde, raporda ve CSV'de görünen sayılar aralıkla sınırlanır
 * (ör. etkinlik gününü deneme oyunlarından ayırmak için).
 */
export interface DateRange {
  /** İlk gün (YYYY-MM-DD) ya da null. */
  from: string | null;
  /** Son gün (YYYY-MM-DD) ya da null. */
  to: string | null;
}

export const NO_RANGE: DateRange = { from: null, to: null };

/** "YYYY-MM-DD" biçiminde GERÇEK bir takvim günü mü? (2026-02-30 geçersizdir.) */
export function isValidDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

type Param = string | string[] | null | undefined;

const one = (v: Param): string | null => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && isValidDay(s) ? s : null;
};

/** Adres parametrelerinden aralık: geçersiz değerler yok sayılır, `from > to` ise uçlar yer değiştirir. */
export function parseRange(from: Param, to: Param): DateRange {
  const f = one(from);
  const t = one(to);
  return f && t && f > t ? { from: t, to: f } : { from: f, to: t };
}

export function hasRange(r: DateRange): boolean {
  return r.from !== null || r.to !== null;
}

/** Adres/form için sorgu parçaları (yalnızca dolu uçlar). */
export function rangeParams(r: DateRange): Record<string, string> {
  const out: Record<string, string> = {};
  if (r.from) out.from = r.from;
  if (r.to) out.to = r.to;
  return out;
}

const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Okunur dönem etiketi: "11.10.2026 – 13.10.2026", "11.10.2026 ve sonrası", "13.10.2026 ve öncesi"; aralık yoksa "Tüm dönem". */
export function rangeLabel(r: DateRange): string {
  if (r.from && r.to) return r.from === r.to ? dmy(r.from) : `${dmy(r.from)} – ${dmy(r.to)}`;
  if (r.from) return `${dmy(r.from)} ve sonrası`;
  if (r.to) return `${dmy(r.to)} ve öncesi`;
  return "Tüm dönem";
}

function localDay(iso: string, tz: string): string | null {
  try {
    return localParts(iso, tz).date;
  } catch {
    return null; // çözümlenemeyen zaman damgası: süzülmüş görünümde yer almaz
  }
}

/**
 * Olayları yerel güne göre aralıkla süzer; oturumlar yalnızca aralıkta en az bir olayı olanlarla kalır
 * (cihaz sınıfı sayıları aralıkla tutarlı olsun). Aralık yoksa veri olduğu gibi döner.
 */
export function filterByRange(data: CampaignData, range: DateRange, tz: string): CampaignData {
  if (!hasRange(range)) return data;
  const events = data.events.filter((e) => {
    const day = localDay(e.occurredAt, tz);
    return day !== null && (!range.from || day >= range.from) && (!range.to || day <= range.to);
  });
  const active = new Set(events.map((e) => e.sessionId));
  return { events, sessions: data.sessions.filter((s) => active.has(s.id)) };
}
