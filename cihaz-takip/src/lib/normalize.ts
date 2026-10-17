/**
 * Türkçe karşılaştırma anahtarı: büyük/küçük harf, aksan (ç, ğ, ı, ö, ş, ü), noktalama ve
 * fazla boşluk farkını yok sayar. "AYŞE  Yılmaz", "ayse yilmaz" ve "Ayşe Yılmaz" aynı anahtarı verir.
 * Veritabanındaki name_key sütunları bununla üretilir (başlangıç verisi de aynı kuralla yazılmıştır).
 */
export function normalizeKey(input: string): string {
  return input
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Serbest metni tek satıra indirger, baş/son boşlukları ve art arda boşlukları temizler. */
export function cleanLine(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/** Arama: sorgudaki her kelime, kaydın arama metninde (normalize edilmiş) geçmelidir. */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = normalizeKey(query);
  if (!q) return true;
  const h = normalizeKey(haystack);
  // Envanter kodları "AER-001" ↔ "aer001" ↔ "aer 1" gibi yazılabilsin diye boşluksuz hâl de denenir.
  const compact = h.replace(/ /g, "");
  return q.split(" ").every((w) => h.includes(w) || compact.includes(w));
}
