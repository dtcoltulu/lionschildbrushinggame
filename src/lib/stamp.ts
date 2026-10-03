/**
 * Ödül ekranı şeridindeki "11 Ekim · 14:32" yazısı (saniyesiz).
 * Kampanyanın saat diliminde biçimlenir; geçersiz bir saat dilimi yazılmışsa (RangeError) cihaz saatine düşer,
 * böylece yanlış bir ayar ödül ekranını çökertmez.
 */
export function formatStamp(date: Date, timeZone?: string): string {
  const make = (tz?: string) => {
    const day = date.toLocaleDateString("tr-TR", { day: "numeric", month: "long", timeZone: tz });
    const time = date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: tz });
    return `${day} · ${time}`;
  };
  try {
    return make(timeZone);
  } catch {
    return make(undefined);
  }
}

/** İdeal fırçalama süresi: 2 dakika. Oyun süresi bununla karşılaştırılıp ödül ekranında kısa bir geri bildirim verilir. */
export const IDEAL_BRUSH_MS = 120_000;

function validMs(ms: number | null | undefined): ms is number {
  return ms !== null && ms !== undefined && Number.isFinite(ms) && ms > 0;
}

/** Oyun süresi: "1 dk 12 sn", "45 sn", "2 dk". Geçersiz/sıfır süre → null (satır gizlenir). */
export function formatDuration(ms: number | null | undefined): string | null {
  if (!validMs(ms)) return null;
  const sec = Math.max(1, Math.round(ms / 1000));
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  if (m === 0) return `${r} sn`;
  if (r === 0) return `${m} dk`;
  return `${m} dk ${r} sn`;
}

/** 2 dakikadan kısa → "quick" (uyarı), 2 dakika ve üzeri → "ideal" (tebrik). Süre bilinmiyorsa null. */
export function brushVerdict(ms: number | null | undefined): "quick" | "ideal" | null {
  if (!validMs(ms)) return null;
  return ms < IDEAL_BRUSH_MS ? "quick" : "ideal";
}
