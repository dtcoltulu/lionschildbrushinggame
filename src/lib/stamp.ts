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

/**
 * "Kaç dakikada bitirdin?" cümlesi (ödül ekranı). Bilerek KABA: "skor rekabeti olmasın" ilkesi gereği saniye gösterilmez.
 * 60 sn altı hepsi "bir dakikadan kısa"; sonrası en yakın dakikaya yuvarlanır. Geçersiz/sıfır süre → null (satır gizlenir).
 */
export function describeDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return "Bir dakikadan kısa sürede bitirdin!";
  return `Yaklaşık ${Math.round(sec / 60)} dakikada bitirdin!`;
}
