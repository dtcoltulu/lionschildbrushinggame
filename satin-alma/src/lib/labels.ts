/** Arayüzde görünen sabit Türkçe etiketler ve seçenek listeleri tek yerde. */

export type Tone = "green" | "red" | "amber" | "orange" | "purple" | "gray" | "blue";

interface Opt<V extends string> {
  value: V;
  label: string;
  tone?: Tone;
  hint?: string;
}

function list<const T extends readonly Opt<string>[]>(items: T) {
  type V = T[number]["value"];
  return {
    items,
    values: items.map((i) => i.value) as V[],
    label: (v: string | null | undefined) => (v ? (items.find((i) => i.value === v)?.label ?? v) : "—"),
    tone: (v: string | null | undefined): Tone => items.find((i) => i.value === v)?.tone ?? "gray",
  };
}

export const ROLES = list([
  { value: "asistan", label: "Asistan", hint: "Talep oluşturur, kendi taleplerini izler" },
  { value: "satinalma", label: "Yönetim / satın alma", hint: "Talepleri değerlendirir, sipariş verir, sorunları çözer" },
  { value: "teslimat", label: "Teslimat sorumlusu", hint: "Atandığı siparişlerin teslimatını kontrol eder" },
  { value: "finans", label: "Finans / klinik yöneticisi", hint: "Fatura, ödeme, borç, raporlar ve kullanıcılar" },
] as const);
export type Role = (typeof ROLES.values)[number];

export const STOCK_STATES = list([
  { value: "azaldi", label: "Azaldı", tone: "amber" },
  { value: "bitti", label: "Bitti", tone: "red" },
] as const);

export const URGENCIES = list([
  { value: "normal", label: "Normal", tone: "gray" },
  { value: "acil", label: "Acil", tone: "orange" },
  { value: "cok_acil", label: "Çok acil (bugün)", tone: "red" },
] as const);

export const REQUEST_STATUSES = list([
  { value: "beklemede", label: "Değerlendirme bekliyor", tone: "amber" },
  { value: "onaylandi", label: "Onaylandı", tone: "blue" },
  { value: "reddedildi", label: "Reddedildi", tone: "red" },
  { value: "iptal", label: "İptal edildi", tone: "gray" },
] as const);

export const ORDER_STATUSES = list([
  { value: "taslak", label: "Taslak (verilmedi)", tone: "gray" },
  { value: "verildi", label: "Sipariş verildi", tone: "blue" },
  { value: "kapandi", label: "Kapandı", tone: "green" },
  { value: "iptal", label: "İptal edildi", tone: "red" },
] as const);

export const ORDER_CHANNELS = list([
  { value: "telefon", label: "Telefon" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "eposta", label: "E-posta" },
  { value: "web", label: "Web sitesi / portal" },
  { value: "yuz_yuze", label: "Yüz yüze / temsilci" },
  { value: "diger", label: "Diğer" },
] as const);

/** Teslimat durumu sipariş durumundan AYRI hesaplanır (kalemlerin kabul edilen/bekleyen miktarlarından). */
export const DELIVERY_STATES = list([
  { value: "bekleniyor", label: "Teslimat bekleniyor", tone: "gray" },
  { value: "kismi", label: "Kısmi teslim", tone: "amber" },
  { value: "tamam", label: "Tamamı teslim alındı", tone: "green" },
  { value: "yok", label: "—", tone: "gray" },
] as const);

export const RECEIPT_STATUSES = list([
  { value: "taslak", label: "Kontrol sürüyor", tone: "amber" },
  { value: "kaydedildi", label: "Kaydedildi", tone: "green" },
  { value: "iptal", label: "İptal edildi (ters kayıt)", tone: "red" },
] as const);

export const ISSUE_TYPES = list([
  { value: "eksik", label: "Eksik teslimat", tone: "amber" },
  { value: "yanlis_urun", label: "Yanlış ürün veya varyant", tone: "red" },
  { value: "farkli_marka", label: "Farklı marka", tone: "orange" },
  { value: "hasarli", label: "Hasarlı ambalaj / ürün", tone: "red" },
  { value: "skt_gecmis", label: "Son kullanma tarihi geçmiş", tone: "red" },
  { value: "kisa_miat", label: "Kullanım süresi gereğinden kısa", tone: "orange" },
  { value: "fazla", label: "Fazla veya sipariş dışı ürün", tone: "purple" },
  { value: "lot_eksik", label: "Lot / parti numarası yok", tone: "orange" },
] as const);
export type IssueType = (typeof ISSUE_TYPES.values)[number];

export const ISSUE_ACTIONS = list([
  { value: "eksik_bekleniyor", label: "Eksik ürün bekleniyor", hint: "Tedarikçi kalan miktarı gönderecek" },
  { value: "degisim", label: "Değişim", hint: "Ürün geri verilir, doğrusu gelecek" },
  { value: "iade", label: "İade", hint: "Ürün geri verilir; borç ancak finansal düzeltme belgesiyle düşer" },
  { value: "fiyat_duzeltmesi", label: "Fiyat düzeltmesiyle kabul", hint: "Ürün kabul edilir, tedarikçiden fiyat farkı/iade faturası beklenir" },
  { value: "alternatif_kabul", label: "Yönetim onayıyla alternatif ürün kabulü", hint: "Gerçek gelen ürün kaydedilir; sipariş bilgisi değişmez" },
  { value: "kabul", label: "İncelendi, kabul edildi", hint: "Kısa miatlı / lotsuz / fazla ürün yönetim kararıyla kabul" },
  { value: "iptal", label: "Kalan miktar iptal edildi", hint: "Gerekçe zorunlu" },
] as const);
export type IssueAction = (typeof ISSUE_ACTIONS.values)[number];

export const ISSUE_STATUSES = list([
  { value: "acik", label: "Açık", tone: "red" },
  { value: "cozuldu", label: "Çözüldü", tone: "green" },
] as const);

export const INVOICE_KINDS = list([
  { value: "fatura", label: "Fatura" },
  { value: "acilis", label: "Açılış (başlangıç) borcu" },
] as const);

export const INVOICE_REVIEWS = list([
  { value: "yok", label: "Fark yok", tone: "green" },
  { value: "inceleme_bekliyor", label: "Fark var – inceleme bekliyor", tone: "red" },
  { value: "onaylandi", label: "Fark incelendi, kabul edildi", tone: "blue" },
  { value: "itiraz", label: "Fark tedarikçiye itiraz edildi", tone: "orange" },
] as const);

export const PAYMENT_METHODS = list([
  { value: "havale_eft", label: "Havale / EFT" },
  { value: "nakit", label: "Nakit" },
  { value: "kredi_karti", label: "Kredi kartı" },
  { value: "cek", label: "Çek" },
  { value: "senet", label: "Senet" },
  { value: "mahsup", label: "Mahsup" },
  { value: "diger", label: "Diğer" },
] as const);

export const ADJ_TYPES = list([
  { value: "iade_faturasi", label: "İade faturası" },
  { value: "fiyat_farki", label: "Fiyat farkı faturası / dekontu" },
  { value: "iskonto", label: "Sonradan iskonto" },
  { value: "kur_farki", label: "Kur farkı" },
  { value: "diger", label: "Diğer düzeltme" },
] as const);

export const ADJ_DIRECTIONS = list([
  { value: "borc_azaltir", label: "Borcu azaltır (alacak)", tone: "green" },
  { value: "borc_artirir", label: "Borcu artırır", tone: "red" },
] as const);

export const ADJ_STATUSES = list([
  { value: "onay_bekliyor", label: "Onay bekliyor", tone: "amber" },
  { value: "onaylandi", label: "Onaylandı (bakiyeye yansır)", tone: "green" },
  { value: "iptal", label: "İptal edildi", tone: "gray" },
] as const);

export const CURRENCIES = list([
  { value: "TRY", label: "TL (Türk lirası)" },
  { value: "EUR", label: "EUR (Avro)" },
  { value: "USD", label: "USD (ABD doları)" },
  { value: "GBP", label: "GBP (Sterlin)" },
  { value: "CHF", label: "CHF (İsviçre frangı)" },
] as const);
export type Currency = (typeof CURRENCIES.values)[number];

/** Sipariş ve temel birimler. Sipariş birimi ≠ temel birim ise paket içeriği (1 kutu = 100 adet) zorunludur. */
export const UNITS = [
  "adet", "kutu", "paket", "şişe", "tüp", "rulo", "set", "koli", "poşet", "flakon", "kavanoz", "şırınga", "karpül", "blister",
  "ml", "lt", "gr", "kg", "metre",
] as const;

export const VAT_RATES = ["0", "1", "10", "20"] as const;

export const CATEGORY_DEFAULTS = [
  "Eldiven ve koruyucular", "Restoratif", "Endodonti", "Ölçü", "Cerrahi", "İmplant sarfları", "Sterilizasyon", "Tek kullanımlık ürünler",
  "Diğer",
];

export const LOCATION_DEFAULTS = ["Ünit 1", "Ünit 2", "Ünit 3", "Cerrahi oda", "Sterilizasyon", "Röntgen", "Depo", "Banko / sekreterya"];

/**
 * Talebin ilerlemesi (değerlendirme durumundan AYRI, sipariş bağlantıları ve kabul edilen teslimatlardan hesaplanır).
 */
export const REQUEST_PROGRESS = list([
  { value: "degerlendirme", label: "Değerlendirme bekliyor", tone: "amber" },
  { value: "eslestirme", label: "Katalog eşleştirmesi bekliyor", tone: "purple" },
  { value: "siparis_bekliyor", label: "Onaylandı – siparişe eklenecek", tone: "blue" },
  { value: "kismen_hazirlaniyor", label: "Kısmen siparişe eklendi", tone: "blue" },
  { value: "hazirlaniyor", label: "Sipariş hazırlanıyor (henüz verilmedi)", tone: "blue" },
  { value: "sipariste", label: "Sipariş verildi – teslimat bekleniyor", tone: "blue" },
  { value: "kismen_teslim", label: "Kısmen teslim alındı", tone: "amber" },
  { value: "teslim_alindi", label: "Teslim alındı", tone: "green" },
  { value: "reddedildi", label: "Reddedildi", tone: "red" },
  { value: "iptal", label: "İptal edildi", tone: "gray" },
] as const);
export type RequestProgress = (typeof REQUEST_PROGRESS.values)[number];
