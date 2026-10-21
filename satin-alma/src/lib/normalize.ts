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

/** İki kelime aynı kökten mi? Türkçe ekler için ortak önek yeterince uzunsa eşleşir ("eldiveni" ≈ "eldivenleri"). */
function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min < 5) return false;
  let i = 0;
  while (i < min && a[i] === b[i]) i++;
  return i >= Math.max(5, min - 2);
}

/**
 * İki adın aynı şeyin farklı yazımı olma ihtimali (katalogda mükerrer ürün açılmasını önlemek için uyarı).
 * Boşluk/noktalama farkı, Türkçe ekler ve kelime sırası farkı yakalanır.
 */
export function looksSimilar(a: string, b: string): boolean {
  const ca = normalizeKey(a).replace(/ /g, "");
  const cb = normalizeKey(b).replace(/ /g, "");
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (Math.min(ca.length, cb.length) >= 6 && (ca.includes(cb) || cb.includes(ca))) return true;
  const ta = normalizeKey(a).split(" ").filter(Boolean);
  const tb = normalizeKey(b).split(" ").filter(Boolean);
  const matched = ta.filter((x) => tb.some((y) => sameStem(x, y))).length;
  return matched / Math.max(ta.length, tb.length) >= 0.6;
}

/**
 * Fatura/irsaliye numarası karşılaştırma anahtarı: yalnız harf ve rakam, büyük harf; Türkçe harfler sadeleştirilir
 * ("abc-2026 001" → "ABC2026001", "e2e çift" ve "E2E-CIFT" aynı anahtar). Türkçe büyük harf dönüşümü ("i" → "İ")
 * kullanılmaz: aynı numaranın küçük/büyük harfle yazılışı farklı anahtar üretmesin.
 */
export function docNoKey(input: string): string {
  return normalizeKey(input).replace(/ /g, "").toUpperCase();
}
