import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packLabel, variantLabel } from "@/lib/catalog";
import { documentTotals, excludeVat, formatMoney, formatPrice, formatQty, lineNet, lineVat, parseDecimalInput } from "@/lib/decimal";
import { docNoKey, looksSimilar, normalizeKey } from "@/lib/normalize";
import { normalizePrice } from "@/lib/pricing";
import { forClinic, type Db } from "@/server/db";
import { ConflictError } from "@/server/errors";
import { createVariant, searchVariants } from "@/server/services/catalog";
import { FIRST_CLINIC, freshDb, world, type World } from "./helpers";

describe("ondalık hesap (kayan nokta yok)", () => {
  it("Türkçe tutar girişleri", () => {
    expect(parseDecimalInput("1.250,50")).toBe("1250.50");
    expect(parseDecimalInput("1250,5")).toBe("1250.50");
    expect(parseDecimalInput("1 250 TL")).toBe("1250.00");
    expect(parseDecimalInput("₺1.250")).toBe("1250.00");
    expect(parseDecimalInput("0,1", 3)).toBe("0.100");
    expect(parseDecimalInput("12,3456", 4)).toBe("12.3456");
    expect(parseDecimalInput("12,345")).toBe("invalid");
    expect(parseDecimalInput("abc")).toBe("invalid");
    expect(parseDecimalInput("")).toBeNull();
  });

  it("0,1 + 0,2 gibi toplamlarda kuruş kaybı olmaz", () => {
    const t = documentTotals(
      Array.from({ length: 10 }, () => ({ qty: "1", unitPrice: "0.1", vatRate: "0" })),
    );
    expect(t.total).toBe("1.00");
  });

  it("satır yuvarlaması yarım yukarı ve veritabanıyla aynı", () => {
    expect(lineNet("3", "12.3456", "10")).toBe("33.33");
    expect(lineVat("0.05", "10")).toBe("0.01");
    expect(lineVat("0.04", "10")).toBe("0.00");
    expect(documentTotals([{ qty: "10", unitPrice: "250", vatRate: "10" }], { amount: "50", vatRate: "20" })).toEqual({ net: "2550.00", vat: "260.00", total: "2810.00" });
  });

  it("KDV dahil fiyattan hariç fiyat (4 basamak)", () => {
    expect(excludeVat("110", "10")).toBe("100.0000");
    expect(excludeVat("100", "20")).toBe("83.3333");
  });

  it("gösterim", () => {
    expect(formatMoney("1250.5")).toBe("1.250,50 TL");
    expect(formatMoney("-22", "EUR")).toBe("−22,00 EUR");
    expect(formatPrice("12.3456")).toBe("12,3456 TL");
    expect(formatPrice("12.5000")).toBe("12,50 TL");
    expect(formatQty("10.000")).toBe("10");
    expect(formatQty("2.500")).toBe("2,5");
    expect(formatQty("1250")).toBe("1.250");
  });

  it("kutu ve adet fiyatı aynı temelde karşılaştırılır", () => {
    const p = normalizePrice({ unitPrice: "250", discountPct: "10", vatRate: "10", packSize: "100" });
    expect(p).toEqual({ perOrderUnitExcl: "225.0000", perOrderUnitIncl: "247.5000", perBaseUnitExcl: "2.2500", perBaseUnitIncl: "2.4750" });
  });
});

describe("katalog metinleri", () => {
  it("varyant adı ve paket içeriği", () => {
    expect(variantLabel({ productName: "Nitril eldiven", brand: "X", attributes: "M" })).toBe("Nitril eldiven – X · M");
    expect(packLabel({ orderUnit: "kutu", baseUnit: "adet", packSize: "100.000" })).toBe("1 kutu = 100 adet");
    expect(packLabel({ orderUnit: "adet", baseUnit: "adet", packSize: "1" })).toBe("adet");
  });

  it("benzer ürün adları ve fatura numarası anahtarı", () => {
    expect(looksSimilar("Nitril muayene eldivenleri", "nitril muayene eldiveni")).toBe(true);
    expect(looksSimilar("Nitril-eldiven", "nitril eldiven")).toBe(true);
    expect(looksSimilar("Kompozit dolgu", "Nitril eldiven")).toBe(false);
    expect(docNoKey("abc-2026 / 001")).toBe("ABC2026001");
    expect(docNoKey("e2e cift 1")).toBe(docNoKey("E2E-CIFT-1"));
    expect(docNoKey("İşçi-çiğ")).toBe(docNoKey("isci CIG"));
    expect(normalizeKey("ÖLÇÜ Kaşığı")).toBe("olcu kasigi");
  });
});

describe("katalogda mükerrer kayıt önleme ve arama", () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(async () => w.db.close());

  it("aynı varyant farklı yazımla tekrar açılamaz; benzer ürün adı için onay istenir", async () => {
    const cat = (await w.satinalma.db.query<{ id: string }>(`select id from categories limit 1`))[0]!.id;
    await expect(createVariant(w.satinalma, { productName: "NİTRİL muayene eldiveni", categoryId: cat, brand: "test marka", model: "pudrasız", attributes: "M  beden", orderUnit: "kutu", baseUnit: "adet", packSize: "100" }))
      .rejects.toMatchObject({ code: "duplicate_variant" });
    const e = await createVariant(w.satinalma, { productName: "Nitril muayene eldivenleri", categoryId: cat, orderUnit: "kutu", baseUnit: "adet", packSize: "100" }).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictError);
    expect(e.code).toBe("similar_product");
    // Farklı paket içeriği ayrı varyanttır
    const v = await createVariant(w.satinalma, { productName: "Nitril muayene eldiveni", categoryId: cat, brand: "Test Marka", model: "Pudrasız", attributes: "M beden", orderUnit: "kutu", baseUnit: "adet", packSize: "200" });
    expect(v.packText).toBe("1 kutu = 200 adet");
  });

  it("kutu birimi için paket içeriği yazılmalı", async () => {
    const cat = (await w.satinalma.db.query<{ id: string }>(`select id from categories limit 1`))[0]!.id;
    await expect(createVariant(w.satinalma, { productName: "Tükürük emici", categoryId: cat, orderUnit: "paket", baseUnit: "adet" })).rejects.toMatchObject({ status: 422 });
  });

  it("arama Türkçe karakter ve büyük/küçük harf farkını yok sayar", async () => {
    const found = await searchVariants(w.satinalma.db, "nitril m beden");
    expect(found.map((v) => v.label)).toContain("Nitril muayene eldiveni – Test Marka · Pudrasız · M beden");
    expect((await searchVariants(w.satinalma.db, "KOMPOZİT a2")).length).toBe(1);
  });

  it("asistan katalogda ürün açamaz", async () => {
    const cat = (await w.asistan.db.query<{ id: string }>(`select id from categories limit 1`))[0]!.id;
    await expect(createVariant(w.asistan, { productName: "X ürün", categoryId: cat, orderUnit: "adet", baseUnit: "adet" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("klinik ayrımı (RLS): başka kliniğin verisi görünmez", () => {
  let db: Db;
  beforeAll(async () => {
    db = await freshDb();
  });
  afterAll(async () => db.close());

  it("ikinci klinik ilk kliniğin satırlarını göremez ve onlara yazamaz", async () => {
    const other = "00000000-0000-4000-8000-0000000000b2";
    await db.query(`insert into clinics (id, name, short_name) values ($1, 'Örnek Klinik B', 'B')`, [other]);
    const a = forClinic(db, FIRST_CLINIC);
    const b = forClinic(db, other);
    await a.query(`insert into suppliers (name, name_key) values ('A deposu', 'a deposu')`);
    expect((await a.query(`select * from suppliers`)).length).toBe(1);
    expect((await b.query(`select * from suppliers`)).length).toBe(0);
    expect((await b.query(`select * from categories`)).length).toBe(0);
    await expect(b.query(`insert into suppliers (clinic_id, name, name_key) values ($1, 'x', 'x')`, [FIRST_CLINIC])).rejects.toThrow();
    expect((await b.query(`update suppliers set notes = 'x' returning id`)).length).toBe(0);
  });
});
