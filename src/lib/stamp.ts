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
