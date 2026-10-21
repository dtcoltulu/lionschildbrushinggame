import { packLabel, variantLabel } from "@/lib/catalog";
import { cmp, excludeVat, formatQty } from "@/lib/decimal";
import { UNITS } from "@/lib/labels";
import { looksSimilar, normalizeKey } from "@/lib/normalize";
import { normalizePrice, type NormalizedPrice } from "@/lib/pricing";
import { asBody, isUuid, Reader } from "@/lib/validate";
import { audit, diff } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { ConflictError, isUniqueViolation, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { assertCan, can } from "../permissions";
import { istDate } from "./common";

export interface Variant {
  id: string;
  productId: string;
  productName: string;
  categoryId: string;
  categoryName: string;
  brand: string | null;
  model: string | null;
  attributes: string | null;
  code: string | null;
  orderUnit: string;
  baseUnit: string;
  packSize: string;
  defaultVatRate: string;
  trackExpiry: boolean;
  trackLot: boolean;
  minShelfLifeDays: number | null;
  imageFileId: string | null;
  active: boolean;
  version: number;
  label: string;
  packText: string;
}

export const VARIANT_SELECT = `select v.id, v.product_id as "productId", p.name as "productName", p.category_id as "categoryId",
  c.name as "categoryName", v.brand, v.model, v.attributes, v.code, v.order_unit as "orderUnit", v.base_unit as "baseUnit",
  v.pack_size as "packSize", v.default_vat_rate as "defaultVatRate", v.track_expiry as "trackExpiry", v.track_lot as "trackLot",
  v.min_shelf_life_days as "minShelfLifeDays", v.image_file_id as "imageFileId", (v.active and p.active) as active, v.version
  from variants v join products p on p.id = v.product_id join categories c on c.id = p.category_id`;

export function withLabels<T extends Omit<Variant, "label" | "packText">>(v: T): T & { label: string; packText: string } {
  return { ...v, label: variantLabel(v), packText: packLabel(v) };
}

export async function getVariant(q: Queryable, id: string): Promise<Variant | null> {
  const [v] = await q.query<Omit<Variant, "label" | "packText">>(`${VARIANT_SELECT} where v.id = $1`, [id]);
  return v ? withLabels(v) : null;
}

/** Arama: sorgudaki her kelime ürün adı, kategori, marka, tip, özellik veya kodda geçmelidir (Türkçe karakter/büyük harf farkı yok). */
export async function searchVariants(q: Queryable, text: string, opts: { limit?: number; includeInactive?: boolean; categoryId?: string | null } = {}): Promise<Variant[]> {
  const words = normalizeKey(text).split(" ").filter(Boolean).slice(0, 6);
  const params: unknown[] = [];
  const where: string[] = [];
  for (const w of words) {
    params.push(`%${w}%`);
    where.push(`(v.search_key like $${params.length} or replace(v.search_key, ' ', '') like $${params.length})`);
  }
  if (!opts.includeInactive) where.push("v.active and p.active");
  if (opts.categoryId && isUuid(opts.categoryId)) {
    params.push(opts.categoryId);
    where.push(`p.category_id = $${params.length}`);
  }
  params.push(Math.min(opts.limit ?? 30, 500));
  const rows = await q.query<Omit<Variant, "label" | "packText">>(
    `${VARIANT_SELECT} ${where.length ? `where ${where.join(" and ")}` : ""} order by p.name, v.brand nulls first, v.model nulls first, v.attributes nulls first limit $${params.length}`,
    params,
  );
  return rows.map(withLabels);
}

export interface VariantSupplier {
  supplierId: string;
  supplierName: string;
  preference: number;
  supplierCode: string | null;
}

export async function variantSuppliers(q: Queryable, variantId: string): Promise<VariantSupplier[]> {
  return q.query<VariantSupplier>(
    `select vs.supplier_id as "supplierId", s.name as "supplierName", vs.preference, vs.supplier_code as "supplierCode"
     from variant_suppliers vs join suppliers s on s.id = vs.supplier_id where vs.variant_id = $1 order by vs.preference, s.name`,
    [variantId],
  );
}

// ---------------------------------------------------------------------------
// Ekleme / düzenleme
// ---------------------------------------------------------------------------

interface VariantInput {
  productId: string | null;
  productName: string | null;
  categoryId: string | null;
  brand: string | null;
  model: string | null;
  attributes: string | null;
  code: string | null;
  orderUnit: string;
  baseUnit: string;
  packSize: string;
  defaultVatRate: string;
  trackExpiry: boolean;
  trackLot: boolean;
  minShelfLifeDays: number | null;
  active: boolean;
  suppliers: { supplierId: string; preference: number; supplierCode: string | null }[];
  confirmSimilar: boolean;
}

function readVariant(r: Reader, opts: { update: boolean }): VariantInput {
  const productId = r.optId("productId", "Ürün");
  const productName = r.optText("productName", "Ürün adı", { max: 160 });
  const categoryId = r.optId("categoryId", "Kategori");
  if (!productId && !opts.update) {
    if (!productName) r.error("productName", "Ürün adı boş bırakılamaz (ör. Nitril muayene eldiveni).");
    else if (productName.length < 2) r.error("productName", "Ürün adı en az 2 karakter olmalı.");
    if (!categoryId) r.error("categoryId", "Kategori seçilmelidir.");
  }
  const orderUnit = r.oneOf("orderUnit", "Sipariş birimi", UNITS);
  const baseUnit = r.oneOf("baseUnit", "Temel birim", UNITS, orderUnit);
  const packSize = r.optDecimal("packSize", "Paket içeriği", { scale: 3, positive: true, max: "100000" }) ?? "1.000";
  if (orderUnit === baseUnit && cmp(packSize, 1) !== 0) r.error("packSize", "Sipariş birimi ile temel birim aynıysa paket içeriği 1 olmalı.");
  if (orderUnit !== baseUnit && cmp(packSize, 1) === 0 && !r.bool("packSizeOneOk")) {
    // 1 kutu = 1 adet gibi bir tanım çoğunlukla yanlıştır; yine de bilerek seçilebilir.
    r.error("packSize", `Paket içeriğini yazın: 1 ${orderUnit} kaç ${baseUnit}? (ör. 100)`);
  }
  const rawShelf = r.raw("minShelfLifeDays");
  const minShelfLifeDays = rawShelf === null || rawShelf === undefined || rawShelf === "" ? null : r.int("minShelfLifeDays", "En az kalan raf ömrü (gün)", 0, 3650, 0);
  const trackExpiry = r.bool("trackExpiry");
  if (minShelfLifeDays !== null && !trackExpiry) r.error("minShelfLifeDays", "En az raf ömrü için son kullanma tarihi takibi açık olmalı.");
  const suppliers = r.list("suppliers", "Tercih edilen tedarikçiler", { max: 9 }).map((s, i) => ({
    supplierId: s.id("supplierId", "Tedarikçi"),
    preference: s.int("preference", "Tercih sırası", 1, 9, i + 1),
    supplierCode: s.optText("supplierCode", "Tedarikçi ürün kodu", { max: 60 }),
  }));
  return {
    productId,
    productName,
    categoryId,
    brand: r.optText("brand", "Marka", { max: 80 }),
    model: r.optText("model", "Tip / model / seri", { max: 120 }),
    attributes: r.optText("attributes", "Ölçü / boyut / renk", { max: 160 }),
    code: r.optText("code", "Ürün kodu / barkod", { max: 60 }),
    orderUnit,
    baseUnit,
    packSize,
    defaultVatRate: r.optDecimal("defaultVatRate", "Varsayılan KDV oranı", { min: "0", max: "100" }) ?? "20.00",
    trackExpiry,
    trackLot: r.bool("trackLot"),
    minShelfLifeDays,
    active: r.bool("active", true),
    suppliers,
    confirmSimilar: r.bool("confirmSimilar"),
  };
}

const keyPart = (v: string | null | undefined) => normalizeKey(v ?? "");

function variantKey(productName: string, v: Pick<VariantInput, "brand" | "model" | "attributes" | "orderUnit" | "baseUnit" | "packSize">): string {
  return [productName, v.brand, v.model, v.attributes, v.orderUnit, formatQty(v.packSize), v.baseUnit].map(keyPart).join("|");
}

const compact = (key: string) => key.replace(/[ |]/g, "");

function searchKey(productName: string, categoryName: string, v: Pick<VariantInput, "brand" | "model" | "attributes" | "code" | "orderUnit">): string {
  return normalizeKey([productName, categoryName, v.brand, v.model, v.attributes, v.code, v.orderUnit].filter(Boolean).join(" "));
}

async function setSuppliers(q: Queryable, variantId: string, list: VariantInput["suppliers"]) {
  await q.query(`delete from variant_suppliers where variant_id = $1`, [variantId]);
  const seen = new Set<string>();
  for (const s of list) {
    if (seen.has(s.supplierId)) continue;
    seen.add(s.supplierId);
    if (!(await q.query(`select 1 from suppliers where id = $1`, [s.supplierId])).length) throw new ValidationError({ suppliers: "Tedarikçi bulunamadı." });
    await q.query(`insert into variant_suppliers (variant_id, supplier_id, preference, supplier_code) values ($1, $2, $3, $4)`, [
      variantId, s.supplierId, s.preference, s.supplierCode,
    ]);
  }
}

/** Aynı varyantın (boşluk/noktalama farkıyla) tekrar açılmasını engeller. */
async function assertNoDuplicate(q: Queryable, productId: string, key: string, exceptId?: string) {
  const rows = await q.query<{ id: string; key: string }>(`select id, variant_key as key from variants where product_id = $1`, [productId]);
  const dup = rows.find((r) => r.id !== exceptId && compact(r.key) === compact(key));
  if (dup) {
    throw new ConflictError("duplicate_variant", "Bu ürün varyantı katalogda zaten var (aynı ürün, marka, tip, ölçü ve paket). Yeni kayıt açmak yerine mevcut kaydı kullanın.", { existingId: dup.id });
  }
}

/**
 * Yeni ürün varyantı. Ürün adı mevcut bir ürünle aynıysa (Türkçe karakter/büyük harf farkı yok sayılır) o ürünün altına eklenir;
 * benzer bir ürün adı varsa (ör. "Nitril eldivenler" ↔ "Nitril eldiven") açık onay istenir.
 */
export async function createVariant(ctx: Ctx, input: unknown, qx?: Queryable): Promise<Variant> {
  assertCan(ctx.actor, "catalog.manage");
  const r = new Reader(asBody(input));
  const v = readVariant(r, { update: false });
  if (!r.ok) throw new ValidationError(r.errors);
  const run = async (q: Queryable) => {
    let productId = v.productId;
    if (!productId) {
      const [same] = await q.query<{ id: string }>(`select id from products where name_key = $1`, [normalizeKey(v.productName!)]);
      if (same) productId = same.id;
      else {
        if (!v.confirmSimilar) {
          const products = await q.query<{ id: string; name: string }>(`select id, name from products`);
          const similar = products.filter((p) => looksSimilar(p.name, v.productName!));
          if (similar.length) {
            throw new ConflictError("similar_product", `Benzer adlı ürün${similar.length > 1 ? "ler" : ""} var: ${similar.map((s) => s.name).join(", ")}. Aynı ürünse onu seçin; gerçekten farklıysa "Yine de yeni ürün olarak ekle" ile devam edin.`, { similar });
          }
        }
        if (!(await q.query(`select 1 from categories where id = $1`, [v.categoryId])).length) throw new ValidationError({ categoryId: "Kategori bulunamadı." });
        const [p] = await q.query<{ id: string }>(`insert into products (category_id, name, name_key) values ($1, $2, $3) returning id`, [
          v.categoryId, v.productName, normalizeKey(v.productName!),
        ]);
        productId = p!.id;
      }
    }
    const [prod] = await q.query<{ name: string; categoryName: string }>(
      `select p.name, c.name as "categoryName" from products p join categories c on c.id = p.category_id where p.id = $1`,
      [productId],
    );
    if (!prod) throw new ValidationError({ productId: "Ürün bulunamadı." });
    const key = variantKey(prod.name, v);
    await assertNoDuplicate(q, productId, key);
    let row: { id: string } | undefined;
    try {
      [row] = await q.query<{ id: string }>(
        `insert into variants (product_id, brand, model, attributes, code, code_key, order_unit, base_unit, pack_size, default_vat_rate,
           track_expiry, track_lot, min_shelf_life_days, variant_key, search_key, active, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning id`,
        [productId, v.brand, v.model, v.attributes, v.code, v.code ? normalizeKey(v.code).replace(/ /g, "") : null, v.orderUnit, v.baseUnit,
          v.packSize, v.defaultVatRate, v.trackExpiry, v.trackLot, v.minShelfLifeDays, key, searchKey(prod.name, prod.categoryName, v), v.active,
          ctx.actor.userId],
      );
    } catch (e) {
      if (isUniqueViolation(e, "variants_code_uq")) throw new ValidationError({ code: "Bu ürün kodu / barkod başka bir varyantta kayıtlı." });
      if (isUniqueViolation(e, "variants_key_uq")) throw new ConflictError("duplicate_variant", "Bu ürün varyantı katalogda zaten var.");
      throw e;
    }
    await setSuppliers(q, row!.id, v.suppliers);
    const created = (await getVariant(q, row!.id))!;
    await audit(q, ctx, { entity: "variant", entityId: created.id, action: "create", summary: `Katalog: yeni ürün varyantı ${created.label} (${created.packText})` });
    return created;
  };
  return qx ? run(qx) : ctx.db.tx(run);
}

async function variantInUse(q: Queryable, id: string): Promise<boolean> {
  const [r] = await q.query<{ used: boolean }>(
    `select exists(select 1 from order_lines where variant_id = $1) or exists(select 1 from requests where variant_id = $1)
       or exists(select 1 from invoice_lines where variant_id = $1) or exists(select 1 from receipt_lines where received_variant_id = $1) as used`,
    [id],
  );
  return !!r?.used;
}

export async function updateVariant(ctx: Ctx, id: string, input: unknown): Promise<Variant> {
  assertCan(ctx.actor, "catalog.manage");
  const r = new Reader(asBody(input));
  const version = r.version();
  const v = readVariant(r, { update: true });
  if (!r.ok) throw new ValidationError(r.errors);
  return ctx.db.tx(async (q) => {
    const cur = await getVariant(q, id);
    if (!cur) throw new NotFoundError("Ürün bulunamadı.");
    if ((cur.orderUnit !== v.orderUnit || cur.baseUnit !== v.baseUnit || cmp(cur.packSize, v.packSize) !== 0) && (await variantInUse(q, id))) {
      throw new ConflictError(
        "unit_locked",
        "Bu ürün taleplerde/siparişlerde kullanıldığı için birim ve paket içeriği değiştirilemez (geçmiş miktarlar bozulur). Farklı paket için yeni varyant açın, bunu pasif yapın.",
      );
    }
    // Ürün adı / kategori değişirse aynı ürünün bütün varyantlarına uygulanır.
    if ((v.productName && normalizeKey(v.productName) !== normalizeKey(cur.productName)) || (v.categoryId && v.categoryId !== cur.categoryId)) {
      try {
        await q.query(`update products set name = $2, name_key = $3, category_id = $4, version = version + 1, updated_at = now() where id = $1`, [
          cur.productId, v.productName ?? cur.productName, normalizeKey(v.productName ?? cur.productName), v.categoryId ?? cur.categoryId,
        ]);
      } catch (e) {
        if (isUniqueViolation(e)) throw new ValidationError({ productName: "Bu adla başka bir ürün var." });
        throw e;
      }
    }
    const [prod] = await q.query<{ name: string; categoryName: string }>(
      `select p.name, c.name as "categoryName" from products p join categories c on c.id = p.category_id where p.id = $1`,
      [cur.productId],
    );
    const key = variantKey(prod!.name, v);
    await assertNoDuplicate(q, cur.productId, key, id);
    try {
      const rows = await q.query(
        `update variants set brand = $3, model = $4, attributes = $5, code = $6, code_key = $7, order_unit = $8, base_unit = $9, pack_size = $10,
           default_vat_rate = $11, track_expiry = $12, track_lot = $13, min_shelf_life_days = $14, variant_key = $15, search_key = $16,
           active = $17, version = version + 1, updated_at = now()
         where id = $1 and version = $2 returning id`,
        [id, version, v.brand, v.model, v.attributes, v.code, v.code ? normalizeKey(v.code).replace(/ /g, "") : null, v.orderUnit, v.baseUnit, v.packSize,
          v.defaultVatRate, v.trackExpiry, v.trackLot, v.minShelfLifeDays, key, searchKey(prod!.name, prod!.categoryName, v), v.active],
      );
      if (!rows.length) throw new VersionConflictError({ current: cur });
    } catch (e) {
      if (isUniqueViolation(e, "variants_code_uq")) throw new ValidationError({ code: "Bu ürün kodu / barkod başka bir varyantta kayıtlı." });
      throw e;
    }
    // Ürün adı değiştiyse kardeş varyantların arama anahtarları da güncellenir.
    const siblings = await q.query<{ id: string; brand: string | null; model: string | null; attributes: string | null; code: string | null; orderUnit: string; baseUnit: string; packSize: string }>(
      `select id, brand, model, attributes, code, order_unit as "orderUnit", base_unit as "baseUnit", pack_size as "packSize" from variants where product_id = $1 and id <> $2`,
      [cur.productId, id],
    );
    for (const s of siblings) {
      await q.query(`update variants set variant_key = $2, search_key = $3 where id = $1`, [s.id, variantKey(prod!.name, s), searchKey(prod!.name, prod!.categoryName, s)]);
    }
    if (r.has("suppliers")) await setSuppliers(q, id, v.suppliers);
    const after = (await getVariant(q, id))!;
    const changes = diff(cur, after, {
      productName: "Ürün adı", categoryName: "Kategori", brand: "Marka", model: "Tip / model", attributes: "Ölçü / özellik", code: "Kod / barkod",
      orderUnit: "Sipariş birimi", baseUnit: "Temel birim", packSize: "Paket içeriği", defaultVatRate: "KDV oranı", trackExpiry: "SKT takibi",
      trackLot: "Lot takibi", minShelfLifeDays: "En az raf ömrü (gün)", active: "Aktif",
    });
    if (Object.keys(changes).length) await audit(q, ctx, { entity: "variant", entityId: id, action: "update", summary: `Katalog güncellendi: ${after.label}`, changes });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Fiyat geçmişi ve teklifler (yalnızca fiyat görme yetkisi olanlara)
// ---------------------------------------------------------------------------

export interface PricePoint extends NormalizedPrice {
  source: "fatura" | "siparis" | "teklif";
  date: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  unitPrice: string;
  discountPct: string;
  vatRate: string;
  packSize: string;
  unitLabel: string;
  qty: string | null;
  ref: string | null;
  refId: string;
  validUntil?: string | null;
  note?: string | null;
}

export async function priceHistory(ctx: Ctx, variantId: string): Promise<PricePoint[]> {
  assertCan(ctx.actor, "price.view");
  const rows = await ctx.db.query<Omit<PricePoint, keyof NormalizedPrice> & { at: string }>(
    `select * from (
       select 'fatura' as source, i.invoice_date as date, i.supplier_id as "supplierId", s.name as "supplierName", i.currency,
         il.unit_price as "unitPrice", il.discount_pct as "discountPct", il.vat_rate as "vatRate", il.pack_size as "packSize",
         il.unit_label as "unitLabel", il.qty, i.invoice_no as ref, i.id as "refId", null::date as "validUntil", null as note, i.created_at as at
       from invoice_lines il join invoices i on i.id = il.invoice_id join suppliers s on s.id = i.supplier_id
       where il.variant_id = $1 and i.canceled_at is null and i.kind = 'fatura'
       union all
       select 'siparis', ${istDate("po.placed_at")}, po.supplier_id, s.name, po.currency, ol.unit_price, ol.discount_pct, ol.vat_rate, ol.pack_size,
         ol.unit_label, ol.qty, po.order_no, po.id, null::date, null, po.placed_at
       from order_lines ol join purchase_orders po on po.id = ol.order_id join suppliers s on s.id = po.supplier_id
       where ol.variant_id = $1 and po.status in ('verildi', 'kapandi')
       union all
       select 'teklif', pq.quoted_on, pq.supplier_id, s.name, pq.currency, pq.unit_price, pq.discount_pct, pq.vat_rate, v.pack_size,
         v.order_unit, pq.min_qty, null, pq.id, pq.valid_until, pq.note, pq.created_at
       from price_quotes pq join suppliers s on s.id = pq.supplier_id join variants v on v.id = pq.variant_id
       where pq.variant_id = $1 and pq.canceled_at is null
     ) x order by date desc, at desc limit 100`,
    [variantId],
  );
  // "at" yalnızca sıralama içindir; yanıtta kalması zararsızdır.
  return rows.map((r) => ({ ...r, ...normalizePrice(r) }));
}

/** Son satın alma: en son fatura kalemi; fatura yoksa en son verilen sipariş. */
export function lastPurchase(history: PricePoint[]): PricePoint | null {
  return history.find((h) => h.source === "fatura") ?? history.find((h) => h.source === "siparis") ?? null;
}

export async function createQuote(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  assertCan(ctx.actor, "quote.manage");
  const r = new Reader(asBody(input));
  const variantId = r.id("variantId", "Ürün");
  const supplierId = r.id("supplierId", "Tedarikçi");
  const quotedOn = r.optDate("quotedOn", "Teklif tarihi", { notAfter: ctx.today }) ?? ctx.today;
  const validUntil = r.optDate("validUntil", "Geçerlilik tarihi");
  const currency = r.oneOf("currency", "Para birimi", ["TRY", "EUR", "USD", "GBP", "CHF"] as const, "TRY");
  const vatRate = r.decimal("vatRate", "KDV oranı", { min: "0", max: "100" });
  const price = r.decimal("unitPrice", "Birim fiyat", { scale: 4, min: "0" });
  const inclVat = r.bool("priceIncludesVat");
  const discountPct = r.optDecimal("discountPct", "İskonto %", { min: "0", max: "100" }) ?? "0";
  const minQty = r.optDecimal("minQty", "En az sipariş miktarı", { scale: 3, positive: true });
  const note = r.optText("note", "Not", { max: 300 });
  if (validUntil && validUntil < quotedOn) r.error("validUntil", "Geçerlilik tarihi teklif tarihinden önce olamaz.");
  if (!r.ok) throw new ValidationError(r.errors);
  const unitPrice = inclVat ? excludeVat(price, vatRate) : price;
  return ctx.db.tx(async (q) => {
    const v = await getVariant(q, variantId);
    if (!v) throw new ValidationError({ variantId: "Ürün bulunamadı." });
    const [s] = await q.query<{ name: string }>(`select name from suppliers where id = $1`, [supplierId]);
    if (!s) throw new ValidationError({ supplierId: "Tedarikçi bulunamadı." });
    const [row] = await q.query<{ id: string }>(
      `insert into price_quotes (variant_id, supplier_id, quoted_on, valid_until, currency, unit_price, discount_pct, vat_rate, min_qty, note, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [variantId, supplierId, quotedOn, validUntil, currency, unitPrice, discountPct, vatRate, minQty, note, ctx.actor.userId],
    );
    await audit(q, ctx, { entity: "quote", entityId: row!.id, supplierId, action: "create", summary: `Teklif girildi: ${s.name} – ${v.label}` });
    return { id: row!.id };
  });
}

export async function cancelQuote(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx.actor, "quote.manage");
  await ctx.db.tx(async (q) => {
    const rows = await q.query(`update price_quotes set canceled_at = now(), canceled_by = $2 where id = $1 and canceled_at is null returning id`, [id, ctx.actor.userId]);
    if (!rows.length) throw new NotFoundError("Teklif bulunamadı.");
    await audit(q, ctx, { entity: "quote", entityId: id, action: "cancel", summary: "Teklif kaldırıldı" });
  });
}

export function canSeePrices(ctx: Ctx): boolean {
  return can(ctx.actor, "price.view");
}
