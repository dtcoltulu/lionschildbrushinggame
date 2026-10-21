/** Katalog formunun alanları (sunucu ve istemci bileşenleri ortak kullanır). */
export interface VariantValues {
  productName: string;
  categoryId: string;
  brand: string;
  model: string;
  attributes: string;
  code: string;
  orderUnit: string;
  baseUnit: string;
  packSize: string;
  defaultVatRate: string;
  trackExpiry: boolean;
  trackLot: boolean;
  minShelfLifeDays: string;
  active: boolean;
  suppliers: string[];
}

export const EMPTY_VARIANT: VariantValues = {
  productName: "", categoryId: "", brand: "", model: "", attributes: "", code: "", orderUnit: "kutu", baseUnit: "adet", packSize: "", defaultVatRate: "20",
  trackExpiry: false, trackLot: false, minShelfLifeDays: "", active: true, suppliers: [],
};

