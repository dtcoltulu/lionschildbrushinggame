import Decimal from "decimal.js";

/**
 * Para ve miktar hesapları: kayan noktalı sayı (JS number) KULLANILMAZ. Değerler veritabanından ondalık
 * metin olarak gelir ("1250.50"), hesaplar decimal.js ile yapılır, yine metin olarak taşınır.
 * Yuvarlama: yarım yukarı (0,005 → 0,01), veritabanındaki round(numeric, 2) ile aynı.
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;
export type DecValue = string | number | Dec;

export function dec(v: DecValue | null | undefined): Dec {
  if (v === null || v === undefined || v === "") return new D(0);
  return new D(v);
}

/** 2 basamağa yuvarlanmış tutar metni: "1250.50" */
export function money(v: DecValue | null | undefined): string {
  return dec(v).toDecimalPlaces(2).toFixed(2);
}

/** Satır net tutarı (KDV hariç): miktar × birim fiyat × (100 − indirim %) / 100, 2 basamak. Veritabanı formülüyle aynı. */
export function lineNet(qty: DecValue, unitPrice: DecValue, discountPct: DecValue = 0): string {
  return dec(qty).mul(dec(unitPrice)).mul(new D(100).minus(dec(discountPct))).div(100).toDecimalPlaces(2).toFixed(2);
}

/** Satır KDV tutarı: net × oran / 100, 2 basamak. */
export function lineVat(net: DecValue, vatRate: DecValue): string {
  return dec(net).mul(dec(vatRate)).div(100).toDecimalPlaces(2).toFixed(2);
}

export interface Totals {
  net: string;
  vat: string;
  total: string;
}

/** Satırlar + kargo toplamı (KDV hariç / KDV / KDV dahil). */
export function documentTotals(
  lines: { qty: DecValue; unitPrice: DecValue; discountPct?: DecValue; vatRate: DecValue }[],
  shipping: { amount: DecValue; vatRate: DecValue } = { amount: 0, vatRate: 0 },
): Totals {
  let net = dec(0);
  let vat = dec(0);
  for (const l of lines) {
    const n = lineNet(l.qty, l.unitPrice, l.discountPct ?? 0);
    net = net.plus(n);
    vat = vat.plus(lineVat(n, l.vatRate));
  }
  const sNet = money(shipping.amount);
  net = net.plus(sNet);
  vat = vat.plus(lineVat(sNet, shipping.vatRate));
  return { net: money(net), vat: money(vat), total: money(net.plus(vat)) };
}

export function sum(values: (DecValue | null | undefined)[]): string {
  return money(values.reduce<Dec>((acc, v) => acc.plus(dec(v)), dec(0)));
}

export function sumQty(values: (DecValue | null | undefined)[]): string {
  return qty(values.reduce<Dec>((acc, v) => acc.plus(dec(v)), dec(0)));
}

/** Miktar metni (3 basamak, sondaki sıfırlar atılır): "10", "2.5" */
export function qty(v: DecValue | null | undefined): string {
  return dec(v).toDecimalPlaces(3).toFixed();
}

export function cmp(a: DecValue | null | undefined, b: DecValue | null | undefined): number {
  return dec(a).cmp(dec(b));
}

export const isZero = (v: DecValue | null | undefined) => dec(v).isZero();
export const isPositive = (v: DecValue | null | undefined) => dec(v).gt(0);
export const minDec = (a: DecValue, b: DecValue) => (dec(a).lte(dec(b)) ? dec(a) : dec(b));

/** KDV dahil birim fiyattan KDV hariç birim fiyat (4 basamak). */
export function excludeVat(priceInclVat: DecValue, vatRate: DecValue): string {
  return dec(priceInclVat).div(dec(vatRate).div(100).plus(1)).toDecimalPlaces(4).toFixed(4);
}

export function includeVat(priceExclVat: DecValue, vatRate: DecValue, places = 4): string {
  return dec(priceExclVat).mul(dec(vatRate).div(100).plus(1)).toDecimalPlaces(places).toFixed(places);
}

/**
 * Kullanıcı girişi: "1.250,50", "1250,5", "1250.50", "1 250", "₺1.250" kabul edilir.
 * Sonuç ondalık metin ("1250.50"); boş → null; geçersiz → "invalid". Sayıya (float) hiç çevrilmez.
 */
export function parseDecimalInput(input: string | number | null | undefined, scale = 2): string | null | "invalid" {
  if (input === null || input === undefined) return null;
  let s = typeof input === "number" ? (Number.isFinite(input) ? String(input) : "x") : input;
  s = s.replace(/\s+/g, "").replace(/₺|TL|tl|TRY/g, "");
  if (s === "") return null;
  if (!/^[0-9.,]+$/.test(s)) return "invalid";
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Hangisi sonda ise ondalık ayırıcıdır; diğeri binlik ayırıcıdır.
    const decSep = lastComma > lastDot ? "," : ".";
    const thou = decSep === "," ? "." : ",";
    s = s.split(thou).join("");
    if (s.split(decSep).length > 2) return "invalid";
    s = s.replace(decSep, ".");
  } else if (lastComma >= 0) {
    if (s.split(",").length > 2) {
      if (!/^\d{1,3}(,\d{3})+$/.test(s)) return "invalid";
      s = s.split(",").join("");
    } else s = s.replace(",", ".");
  } else if (lastDot >= 0) {
    // Yalnız nokta: "1.250" / "12.500.000" binlik; "1250.5" ondalık
    if (/^\d{1,3}(\.\d{3})+$/.test(s) && scale <= 2) s = s.split(".").join("");
    else if (s.split(".").length > 2) return "invalid";
  }
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return "invalid";
  if ((m[2] ?? "").length > scale) return "invalid";
  if (m[1]!.replace(/^0+/, "").length > 12) return "invalid";
  return new D(s).toFixed(scale);
}

// ---------------------------------------------------------------------------
// Gösterim (Türkçe biçim). Intl yerine elle: büyük tutarlarda bile hassasiyet kaybı olmaz.
// ---------------------------------------------------------------------------

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export const CURRENCY_SUFFIX: Record<string, string> = { TRY: "TL", USD: "USD", EUR: "EUR", GBP: "GBP", CHF: "CHF" };

/** "1250.5" → "1.250,50 TL" */
export function formatMoney(v: DecValue | null | undefined, currency = "TRY"): string {
  if (v === null || v === undefined || v === "") return "—";
  const fixed = dec(v).toDecimalPlaces(2).toFixed(2);
  const neg = fixed.startsWith("-");
  const [i, f] = (neg ? fixed.slice(1) : fixed).split(".");
  return `${neg ? "−" : ""}${groupThousands(i!)},${f} ${CURRENCY_SUFFIX[currency] ?? currency}`;
}

/** Birim fiyat gösterimi: 2–4 basamak ("12,3456 TL", "12,50 TL"). */
export function formatPrice(v: DecValue | null | undefined, currency = "TRY"): string {
  if (v === null || v === undefined || v === "") return "—";
  const d4 = dec(v).toDecimalPlaces(4);
  const places = d4.decimalPlaces() <= 2 ? 2 : d4.decimalPlaces();
  const fixed = d4.toFixed(places);
  const [i, f] = fixed.split(".");
  return `${groupThousands(i!)},${f} ${CURRENCY_SUFFIX[currency] ?? currency}`;
}

/** "10.000" → "10", "2.500" → "2,5", "1250" → "1.250" */
export function formatQty(v: DecValue | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = dec(v).toDecimalPlaces(3).toFixed();
  const neg = s.startsWith("-");
  const [i, f] = (neg ? s.slice(1) : s).split(".");
  return `${neg ? "−" : ""}${groupThousands(i!)}${f ? `,${f}` : ""}`;
}

/** Form alanında gösterim: "1250.50" → "1250,50" */
export function decimalInput(v: DecValue | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  return dec(v).toFixed().replace(".", ",");
}

/** Oran: "20.00" → "%20" */
export function formatPct(v: DecValue | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return `%${dec(v).toDecimalPlaces(2).toFixed().replace(".", ",")}`;
}
