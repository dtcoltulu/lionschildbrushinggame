import { dec, type DecValue } from "./decimal";

/**
 * Fiyatları AYNI TEMELDE karşılaştırmak için: iskonto düşülmüş, KDV hariç ve dahil; sipariş birimi (kutu) ve
 * temel birim (adet) başına. Kutu fiyatı ile adet fiyatı doğrudan karşılaştırılmaz; dönüşüm açıkça gösterilir.
 */
export interface NormalizedPrice {
  perOrderUnitExcl: string;
  perOrderUnitIncl: string;
  perBaseUnitExcl: string;
  perBaseUnitIncl: string;
}

export function normalizePrice(p: { unitPrice: DecValue; discountPct?: DecValue | null; vatRate: DecValue; packSize: DecValue }): NormalizedPrice {
  const net = dec(p.unitPrice).mul(dec(100).minus(dec(p.discountPct ?? 0))).div(100);
  const incl = net.mul(dec(p.vatRate).div(100).plus(1));
  const pack = dec(p.packSize);
  return {
    perOrderUnitExcl: net.toDecimalPlaces(4).toFixed(4),
    perOrderUnitIncl: incl.toDecimalPlaces(4).toFixed(4),
    perBaseUnitExcl: net.div(pack).toDecimalPlaces(4).toFixed(4),
    perBaseUnitIncl: incl.div(pack).toDecimalPlaces(4).toFixed(4),
  };
}

/** İki birim fiyat arasındaki değişim yüzdesi (1 basamak). Önceki 0 ise null. */
export function changePct(prev: DecValue, next: DecValue): string | null {
  const p = dec(prev);
  if (p.isZero()) return null;
  return dec(next).minus(p).div(p).mul(100).toDecimalPlaces(1).toFixed(1);
}
