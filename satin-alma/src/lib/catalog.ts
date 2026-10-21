import { formatQty } from "./decimal";

/** Ürün varyantının okunabilir adı: "Nitril muayene eldiveni – Örnek Marka · Pudrasız · M beden" */
export interface VariantNameParts {
  productName: string;
  brand?: string | null;
  model?: string | null;
  attributes?: string | null;
}

export function variantLabel(v: VariantNameParts): string {
  const detail = [v.brand, v.model, v.attributes].filter(Boolean).join(" · ");
  return detail ? `${v.productName} – ${detail}` : v.productName;
}

/** Paket içeriği: "1 kutu = 100 adet" (sipariş birimi temel birimle aynıysa yalnızca birim). */
export function packLabel(v: { orderUnit: string; baseUnit: string; packSize: string }): string {
  if (v.orderUnit === v.baseUnit) return v.orderUnit;
  return `1 ${v.orderUnit} = ${formatQty(v.packSize)} ${v.baseUnit}`;
}

export interface OrderTextInput {
  clinicName: string;
  orderNo: string;
  supplierName: string;
  expectedOn: string | null;
  note: string | null;
  lines: {
    label: string;
    code: string | null;
    supplierCode?: string | null;
    qty: string;
    unitLabel: string;
    packText: string;
    unitPrice?: string | null;
    discountPct?: string | null;
    currency?: string;
  }[];
}

/**
 * Tedarikçiye kopyalanıp gönderilecek sipariş metni (WhatsApp / e-posta). Uygulama mesajı kendisi GÖNDERMEZ.
 */
export function orderText(o: OrderTextInput, formatDate: (d: string) => string, formatPrice?: (v: string, c: string) => string): string {
  const out: string[] = [];
  out.push(`Merhaba, ${o.clinicName} adına sipariş vermek istiyoruz.`);
  out.push(`Sipariş no: ${o.orderNo}`);
  out.push("");
  o.lines.forEach((l, i) => {
    const code = [l.supplierCode && `Tedarikçi kodu: ${l.supplierCode}`, l.code && `Kod: ${l.code}`].filter(Boolean).join(", ");
    let line = `${i + 1}) ${l.label}${code ? ` (${code})` : ""} — ${formatQty(l.qty)} ${l.unitLabel}`;
    if (l.packText && l.packText !== l.unitLabel) line += ` [${l.packText}]`;
    if (formatPrice && l.unitPrice) {
      line += ` — birim fiyat ${formatPrice(l.unitPrice, l.currency ?? "TRY")} + KDV`;
      if (l.discountPct && Number(l.discountPct) > 0) line += `, iskonto %${l.discountPct.replace(/\.?0+$/, "")}`;
    }
    out.push(line);
  });
  out.push("");
  if (o.expectedOn) out.push(`İstenen teslim tarihi: ${formatDate(o.expectedOn)}`);
  out.push("Lütfen marka, ölçü ve paket içeriğini siparişle aynı gönderin; farklı ürün göndermeden önce bize sorun.");
  out.push("Son kullanma tarihi kısa ürün göndermeyin; lot/parti numarası ambalajda olsun.");
  if (o.note) out.push(`Not: ${o.note}`);
  out.push("Teşekkürler.");
  return out.join("\n");
}
