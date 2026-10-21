import { packLabel, variantLabel } from "@/lib/catalog";
import { addDays, formatDate } from "@/lib/dates";
import { dec, excludeVat, formatMoney, formatPrice, formatQty, lineNet, qty as qtyStr } from "@/lib/decimal";
import { CURRENCIES, INVOICE_REVIEWS } from "@/lib/labels";
import { docNoKey, matchesQuery } from "@/lib/normalize";
import { asBody, isUuid, Reader } from "@/lib/validate";
import { audit, AUDIT_COLS, type AuditRow } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { ConflictError, isUniqueViolation, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { assertCan } from "../permissions";
import { lockRow } from "./common";
import { LINE_STATS } from "./order-state";

/**
 * Sipariş tutarı ≠ faturalanmış borç ≠ ödeme. Borç yalnızca faturayla (ve açılış bakiyesiyle) oluşur.
 * Fatura kalemleri kayıttan sonra değişmez; hatalı fatura gerekçeyle iptal edilip yeniden girilir (iptal edilen bakiyeye girmez,
 * ama listede ve geçmişte görünür). Gerçekte alınmış bir fatura uyuşmazlık nedeniyle silinmez/gizlenmez: borçta kalır,
 * uyuşmazlık ayrıca "inceleme" durumuyla izlenir.
 */

export interface InvoiceSummary {
  id: string;
  kind: "fatura" | "acilis";
  supplierId: string;
  supplierName: string;
  invoiceNo: string | null;
  invoiceDate: string;
  dueDate: string | null;
  currency: string;
  totalNet: string;
  totalVat: string;
  total: string;
  adjustments: string;
  allocated: string;
  open: string;
  reviewStatus: string;
  canceledAt: string | null;
  dueState: "odendi" | "gecikti" | "yaklasiyor" | "acik" | "iptal";
  daysToDue: number | null;
}

export const INVOICE_OPEN_SELECT = `select i.id, i.kind, i.supplier_id as "supplierId", s.name as "supplierName", i.invoice_no as "invoiceNo",
    i.invoice_date as "invoiceDate", i.due_date as "dueDate", i.currency, i.total_net as "totalNet", i.total_vat as "totalVat", i.total,
    coalesce(adj.v, 0) as adjustments, coalesce(al.v, 0) as allocated, (i.total + coalesce(adj.v, 0) - coalesce(al.v, 0)) as open,
    i.review_status as "reviewStatus", i.canceled_at as "canceledAt"
  from invoices i join suppliers s on s.id = i.supplier_id
  left join lateral (select sum(case when direction = 'borc_artirir' then total_amount else -total_amount end) as v
                     from financial_adjustments where invoice_id = i.id and status = 'onaylandi') adj on true
  left join lateral (select sum(amount) as v from payment_allocations where invoice_id = i.id and released_at is null) al on true`;

export const DUE_SOON_DAYS = 7;

export function withDueState<T extends Omit<InvoiceSummary, "dueState" | "daysToDue">>(r: T, today: string): T & Pick<InvoiceSummary, "dueState" | "daysToDue"> {
  if (r.canceledAt) return { ...r, dueState: "iptal", daysToDue: null };
  if (dec(r.open).lte(0)) return { ...r, dueState: "odendi", daysToDue: null };
  if (!r.dueDate) return { ...r, dueState: "acik", daysToDue: null };
  const days = Math.round((Date.parse(r.dueDate) - Date.parse(today)) / 86_400_000);
  return { ...r, dueState: days < 0 ? "gecikti" : days <= DUE_SOON_DAYS ? "yaklasiyor" : "acik", daysToDue: days };
}

export interface InvoiceFilters {
  supplierId?: string | null;
  view?: "acik" | "gecikti" | "yaklasiyor" | "inceleme" | "iptal" | "tumu";
  from?: string | null;
  to?: string | null;
  q?: string;
}

export async function listInvoices(ctx: Ctx, f: InvoiceFilters = {}): Promise<InvoiceSummary[]> {
  assertCan(ctx.actor, "finance.view");
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.supplierId && isUuid(f.supplierId)) {
    params.push(f.supplierId);
    where.push(`i.supplier_id = $${params.length}`);
  }
  if (f.from) {
    params.push(f.from);
    where.push(`i.invoice_date >= $${params.length}`);
  }
  if (f.to) {
    params.push(f.to);
    where.push(`i.invoice_date <= $${params.length}`);
  }
  const rows = (await ctx.db.query<Omit<InvoiceSummary, "dueState" | "daysToDue">>(
    `${INVOICE_OPEN_SELECT} ${where.length ? `where ${where.join(" and ")}` : ""} order by i.invoice_date desc, i.created_at desc limit 1000`,
    params,
  )).map((r) => withDueState(r, ctx.today));
  return rows.filter((r) => {
    switch (f.view) {
      case "acik": if (r.canceledAt || dec(r.open).lte(0)) return false; break;
      case "gecikti": if (r.dueState !== "gecikti") return false; break;
      case "yaklasiyor": if (r.dueState !== "yaklasiyor") return false; break;
      case "inceleme": if (r.canceledAt || !["inceleme_bekliyor", "itiraz"].includes(r.reviewStatus)) return false; break;
      case "iptal": if (!r.canceledAt) return false; break;
      default: break;
    }
    if (f.q && !matchesQuery(`${r.invoiceNo ?? ""} ${r.supplierName}`, f.q)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Sipariş ↔ teslimat ↔ fatura karşılaştırması
// ---------------------------------------------------------------------------

export interface Discrepancy {
  kind: "fiyat" | "kdv" | "miktar_teslim" | "miktar_siparis" | "urun" | "siparis_disi" | "kargo" | "toplam";
  lineNo: number | null;
  message: string;
}

export async function invoiceDiscrepancies(q: Queryable, invoiceId: string): Promise<Discrepancy[]> {
  const [inv] = await q.query<{ kind: string; currency: string; shipping_amount: string; declared_total: string | null; total: string; canceled_at: string | null }>(
    `select kind, currency, shipping_amount, declared_total, total, canceled_at from invoices where id = $1`,
    [invoiceId],
  );
  if (!inv || inv.kind !== "fatura") return [];
  const lines = await q.query<{
    lineNo: number; orderLineId: string | null; variantId: string | null; qty: string; unitPrice: string; discountPct: string; vatRate: string; unitLabel: string;
    olVariant: string | null; olPrice: string | null; olDiscount: string | null; olVat: string | null; olQty: string | null; olCanceled: string | null;
    accepted: string | null; invoicedAll: string | null; altAccepted: boolean; orderNo: string | null; olLineNo: number | null;
  }>(
    `select il.line_no as "lineNo", il.order_line_id as "orderLineId", il.variant_id as "variantId", il.qty, il.unit_price as "unitPrice",
       il.discount_pct as "discountPct", il.vat_rate as "vatRate", il.unit_label as "unitLabel",
       ol.variant_id as "olVariant", ol.unit_price as "olPrice", ol.discount_pct as "olDiscount", ol.vat_rate as "olVat", ol.qty as "olQty",
       ol.canceled_qty as "olCanceled", st.accepted, po.order_no as "orderNo", ol.line_no as "olLineNo",
       (select sum(x.qty) from invoice_lines x join invoices xi on xi.id = x.invoice_id where x.order_line_id = il.order_line_id and xi.canceled_at is null) as "invoicedAll",
       exists(select 1 from receipt_lines rl2 join receipts rc2 on rc2.id = rl2.receipt_id where rl2.order_line_id = il.order_line_id
              and rc2.status = 'kaydedildi' and rl2.received_variant_id = il.variant_id and rl2.qty_accepted > 0) as "altAccepted"
     from invoice_lines il
     left join order_lines ol on ol.id = il.order_line_id left join purchase_orders po on po.id = ol.order_id
     ${LINE_STATS}
     where il.invoice_id = $1 order by il.line_no`,
    [invoiceId],
  );
  const out: Discrepancy[] = [];
  for (const l of lines) {
    if (!l.orderLineId) {
      out.push({ kind: "siparis_disi", lineNo: l.lineNo, message: `${l.lineNo}. fatura kalemi hiçbir sipariş kalemine bağlı değil.` });
      continue;
    }
    const ref = `${l.lineNo}. kalem (sipariş ${l.orderNo}, ${l.olLineNo}. kalem)`;
    const invUnit = lineNet(1, l.unitPrice, l.discountPct);
    const ordUnit = lineNet(1, l.olPrice!, l.olDiscount!);
    const invUnit4 = dec(l.unitPrice).mul(dec(100).minus(dec(l.discountPct))).div(100);
    const ordUnit4 = dec(l.olPrice!).mul(dec(100).minus(dec(l.olDiscount!))).div(100);
    if (!invUnit4.toDecimalPlaces(4).eq(ordUnit4.toDecimalPlaces(4))) {
      out.push({ kind: "fiyat", lineNo: l.lineNo, message: `${ref}: faturadaki net birim fiyat ${formatPrice(invUnit4.toFixed(4), inv.currency)}, siparişte ${formatPrice(ordUnit4.toFixed(4), inv.currency)} (KDV hariç, iskonto düşülmüş; fark ${formatPrice(invUnit4.minus(ordUnit4).toFixed(4), inv.currency)}).` });
    } else if (invUnit !== ordUnit) {
      out.push({ kind: "fiyat", lineNo: l.lineNo, message: `${ref}: birim fiyat yuvarlaması siparişten farklı.` });
    }
    if (!dec(l.vatRate).eq(dec(l.olVat!))) out.push({ kind: "kdv", lineNo: l.lineNo, message: `${ref}: KDV oranı faturada %${dec(l.vatRate).toFixed()}, siparişte %${dec(l.olVat!).toFixed()}.` });
    if (l.variantId && l.variantId !== l.olVariant && !l.altAccepted) out.push({ kind: "urun", lineNo: l.lineNo, message: `${ref}: faturadaki ürün siparişteki/kabul edilen üründen farklı.` });
    const invoiced = dec(l.invoicedAll ?? 0);
    if (invoiced.gt(dec(l.accepted ?? 0))) {
      out.push({ kind: "miktar_teslim", lineNo: l.lineNo, message: `${ref}: bu kalem için faturalanan toplam ${formatQty(invoiced)} ${l.unitLabel}, kabul edilen teslimat ${formatQty(l.accepted)} ${l.unitLabel}.` });
    }
    if (invoiced.gt(dec(l.olQty!).minus(dec(l.olCanceled!)))) {
      out.push({ kind: "miktar_siparis", lineNo: l.lineNo, message: `${ref}: faturalanan toplam ${formatQty(invoiced)}, sipariş miktarından (${formatQty(dec(l.olQty!).minus(dec(l.olCanceled!)))}) fazla.` });
    }
  }
  if (dec(inv.shipping_amount).gt(0)) {
    const orderIds = (await q.query<{ id: string }>(
      `select distinct ol.order_id as id from invoice_lines il join order_lines ol on ol.id = il.order_line_id where il.invoice_id = $1`,
      [invoiceId],
    )).map((r) => r.id);
    const [o] = await q.query<{ v: string }>(`select coalesce(sum(shipping_amount), 0) as v from purchase_orders where id = any($1)`, [orderIds]);
    const [b] = await q.query<{ v: string }>(
      `select coalesce(sum(i.shipping_amount), 0) as v from invoices i where i.canceled_at is null and i.kind = 'fatura'
         and (i.id = $2 or exists(select 1 from invoice_lines a join order_lines c on c.id = a.order_line_id where a.invoice_id = i.id and c.order_id = any($1)))`,
      [orderIds, invoiceId],
    );
    if (dec(b!.v).gt(dec(o!.v))) {
      out.push({ kind: "kargo", lineNo: null, message: `Faturalanan kargo (${formatMoney(b!.v, inv.currency)}) siparişlerdeki kargodan (${formatMoney(o!.v, inv.currency)}) fazla.` });
    }
  }
  if (inv.declared_total !== null && !dec(inv.declared_total).eq(dec(inv.total))) {
    out.push({ kind: "toplam", lineNo: null, message: `Faturada yazan genel toplam ${formatMoney(inv.declared_total, inv.currency)}, kalemlerden hesaplanan ${formatMoney(inv.total, inv.currency)} (fark ${formatMoney(dec(inv.declared_total).minus(dec(inv.total)), inv.currency)}).` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kayıt
// ---------------------------------------------------------------------------

function readFx(r: Reader, currency: string) {
  const fxRate = r.optDecimal("fxRate", "Kur (1 birim = ? TL)", { scale: 6, positive: true });
  const fxDate = r.optDate("fxDate", "Kur tarihi");
  const fxSource = r.optText("fxSource", "Kur kaynağı", { max: 120 });
  if (currency === "TRY" && fxRate) r.error("fxRate", "TL belgede kur girilmez.");
  if (fxRate && (!fxDate || !fxSource)) r.error("fxSource", "TL karşılığı için kurla birlikte kur tarihi ve kaynağı (ör. TCMB döviz satış) yazılmalı.");
  return { fxRate: currency === "TRY" ? null : fxRate, fxDate: fxRate ? fxDate : null, fxSource: fxRate ? fxSource : null };
}

/**
 * Fatura kaydı. Aynı tedarikçinin aynı numaralı faturası ikinci kez kaydedilemez (boşluk/tire/büyük harf farkı yok sayılır).
 * Kalemler sipariş kalemlerine bağlanır; fiyat/miktar farkı varsa fatura "inceleme bekliyor" olarak işaretlenir (borç yine oluşur).
 */
export async function createInvoice(ctx: Ctx, input: unknown): Promise<{ id: string; reviewStatus: string; discrepancies: Discrepancy[] }> {
  assertCan(ctx.actor, "finance.manage");
  const r = new Reader(asBody(input));
  const supplierId = r.id("supplierId", "Tedarikçi");
  const invoiceNo = r.text("invoiceNo", "Fatura numarası", { max: 60 });
  const invoiceDate = r.date("invoiceDate", "Fatura tarihi", { notAfter: ctx.today });
  const dueIn = r.optDate("dueDate", "Vade tarihi");
  const currencyIn = r.optOneOf("currency", "Para birimi", CURRENCIES.values);
  const shippingAmount = r.optDecimal("shippingAmount", "Kargo", { min: "0" }) ?? "0.00";
  const shippingVatRate = r.optDecimal("shippingVatRate", "Kargo KDV oranı", { min: "0", max: "100" }) ?? "20.00";
  const declaredTotal = r.optDecimal("declaredTotal", "Faturadaki genel toplam", { min: "0" });
  const note = r.optText("note", "Not", { multiline: true, max: 1000 });
  const receiptIds = r.ids("receiptIds", "İlgili teslimatlar");
  const key = r.optKey();
  const lines = r.list("lines", "Fatura kalemleri", { min: 1, max: 200 }).map((l) => {
    const vatRate = l.decimal("vatRate", "KDV oranı", { min: "0", max: "100" });
    const price = l.decimal("unitPrice", "Birim fiyat", { scale: 4, min: "0" });
    return {
      orderLineId: l.optId("orderLineId", "Sipariş kalemi"),
      variantId: l.optId("variantId", "Ürün"),
      description: l.optText("description", "Kalem açıklaması", { max: 300 }),
      qty: l.decimal("qty", "Miktar", { scale: 3, positive: true }),
      unitPrice: l.bool("priceIncludesVat") ? excludeVat(price, vatRate) : price,
      discountPct: l.optDecimal("discountPct", "İskonto %", { min: "0", max: "100" }) ?? "0.00",
      vatRate,
    };
  });
  if (!r.ok) throw new ValidationError(r.errors);

  return ctx.db.tx(async (q) => {
    if (key) {
      const [dup] = await q.query<{ id: string; reviewStatus: string }>(`select id, review_status as "reviewStatus" from invoices where idempotency_key = $1`, [key]);
      if (dup) return { ...dup, discrepancies: await invoiceDiscrepancies(q, dup.id) };
    }
    const [s] = await q.query<{ name: string; currency: string; due_days: number | null }>(`select name, currency, due_days from suppliers where id = $1`, [supplierId]);
    if (!s) throw new ValidationError({ supplierId: "Tedarikçi bulunamadı." });
    const currency = currencyIn ?? s.currency;
    const r2 = new Reader(asBody(input));
    const fx = readFx(r2, currency);
    if (!r2.ok) throw new ValidationError(r2.errors);
    const dueDate = dueIn ?? (s.due_days !== null ? addDays(invoiceDate, s.due_days) : null);
    if (dueDate && dueDate < invoiceDate) throw new ValidationError({ dueDate: "Vade tarihi fatura tarihinden önce olamaz." });
    const noKey = docNoKey(invoiceNo);
    if (!noKey) throw new ValidationError({ invoiceNo: "Fatura numarasında harf veya rakam olmalı." });
    const [existing] = await q.query<{ id: string; invoice_date: string }>(
      `select id, invoice_date from invoices where supplier_id = $1 and invoice_no_key = $2 and kind = 'fatura' and canceled_at is null`,
      [supplierId, noKey],
    );
    if (existing) {
      throw new ConflictError("duplicate_invoice", `Bu fatura zaten kayıtlı: ${s.name}, no ${invoiceNo} (${formatDate(existing.invoice_date)}). Aynı fatura ikinci kez borç olarak yazılmadı.`, { existingId: existing.id }, { invoiceNo: "Bu tedarikçinin bu numaralı faturası zaten kayıtlı." });
    }
    // Kalemleri çöz ve doğrula
    const resolved: { orderLineId: string | null; variantId: string | null; description: string | null; qty: string; unitLabel: string; packSize: string; unitPrice: string; discountPct: string; vatRate: string }[] = [];
    for (const [i, l] of lines.entries()) {
      if (l.orderLineId) {
        const [ol] = await q.query<{ variant_id: string; unit_label: string; pack_size: string; supplier_id: string; currency: string; status: string }>(
          `select ol.variant_id, ol.unit_label, ol.pack_size, po.supplier_id, po.currency, po.status from order_lines ol join purchase_orders po on po.id = ol.order_id where ol.id = $1`,
          [l.orderLineId],
        );
        if (!ol) throw new ValidationError({ [`lines.${i}.orderLineId`]: "Sipariş kalemi bulunamadı." });
        if (ol.supplier_id !== supplierId) throw new ValidationError({ [`lines.${i}.orderLineId`]: "Sipariş kalemi başka bir tedarikçinin siparişine ait." });
        if (ol.currency !== currency) throw new ValidationError({ [`lines.${i}.orderLineId`]: "Sipariş başka para biriminde; farklı para birimleri tek faturada karıştırılmaz." });
        if (!["verildi", "kapandi"].includes(ol.status)) throw new ValidationError({ [`lines.${i}.orderLineId`]: "Sipariş verilmemiş veya iptal edilmiş." });
        resolved.push({ ...l, variantId: l.variantId ?? ol.variant_id, unitLabel: ol.unit_label, packSize: ol.pack_size });
      } else if (l.variantId) {
        const [v] = await q.query<{ order_unit: string; pack_size: string }>(`select order_unit, pack_size from variants where id = $1`, [l.variantId]);
        if (!v) throw new ValidationError({ [`lines.${i}.variantId`]: "Ürün bulunamadı." });
        resolved.push({ ...l, unitLabel: v.order_unit, packSize: v.pack_size });
      } else if (l.description) {
        resolved.push({ ...l, unitLabel: "adet", packSize: "1" });
      } else throw new ValidationError({ [`lines.${i}.description`]: "Kalemi bir sipariş kalemine bağlayın, ürün seçin ya da açıklama yazın." });
    }
    let row: { id: string } | undefined;
    try {
      [row] = await q.query<{ id: string }>(
        `insert into invoices (supplier_id, kind, invoice_no, invoice_no_key, invoice_date, due_date, currency, shipping_amount, shipping_vat_rate,
           total, declared_total, fx_rate, fx_date, fx_source, note, idempotency_key, created_by)
         values ($1, 'fatura', $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11, $12, $13, $14, $15) returning id`,
        [supplierId, invoiceNo, noKey, invoiceDate, dueDate, currency, shippingAmount, shippingVatRate, declaredTotal, fx.fxRate, fx.fxDate, fx.fxSource, note, key, ctx.actor.userId],
      );
    } catch (e) {
      if (isUniqueViolation(e, "invoices_no_uq")) throw new ConflictError("duplicate_invoice", "Bu fatura zaten kayıtlı (aynı anda iki kez gönderildi). Aynı fatura ikinci kez borç olarak yazılmadı.", undefined, { invoiceNo: "Bu tedarikçinin bu numaralı faturası zaten kayıtlı." });
      throw e;
    }
    const id = row!.id;
    for (const [i, l] of resolved.entries()) {
      await q.query(
        `insert into invoice_lines (invoice_id, line_no, order_line_id, variant_id, description, qty, unit_label, pack_size, unit_price, discount_pct, vat_rate)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, i + 1, l.orderLineId, l.variantId, l.description, l.qty, l.unitLabel, l.packSize, l.unitPrice, l.discountPct, l.vatRate],
      );
    }
    await q.query(
      `update invoices i set total_net = t.net + i.shipping_amount, total_vat = t.vat + round(i.shipping_amount * i.shipping_vat_rate / 100, 2),
         total = t.net + t.vat + i.shipping_amount + round(i.shipping_amount * i.shipping_vat_rate / 100, 2)
       from (select coalesce(sum(net_amount), 0) as net, coalesce(sum(vat_amount), 0) as vat from invoice_lines where invoice_id = $1) t where i.id = $1`,
      [id],
    );
    for (const rid of receiptIds) {
      const [rc] = await q.query<{ supplier_id: string }>(`select po.supplier_id from receipts r join purchase_orders po on po.id = r.order_id where r.id = $1 and r.status = 'kaydedildi'`, [rid]);
      if (!rc || rc.supplier_id !== supplierId) throw new ValidationError({ receiptIds: "Seçilen teslimat bu tedarikçiye ait değil veya kaydedilmemiş." });
      await q.query(`insert into invoice_receipts (invoice_id, receipt_id) values ($1, $2) on conflict do nothing`, [id, rid]);
    }
    const discrepancies = await invoiceDiscrepancies(q, id);
    const reviewStatus = discrepancies.length ? "inceleme_bekliyor" : "yok";
    await q.query(`update invoices set review_status = $2 where id = $1`, [id, reviewStatus]);
    const [t] = await q.query<{ total: string }>(`select total from invoices where id = $1`, [id]);
    await audit(q, ctx, {
      entity: "invoice", entityId: id, supplierId, action: "create", finance: true,
      summary: `Fatura kaydedildi: ${s.name} no ${invoiceNo}, ${formatDate(invoiceDate)}, ${formatMoney(t!.total, currency)}${discrepancies.length ? ` · ${discrepancies.length} fark uyarısı` : ""}`,
    });
    return { id, reviewStatus, discrepancies };
  });
}

/** Başlangıç (açılış) borcu: tedarikçi ve para birimi başına bir tane; ödemeler buna da dağıtılabilir. */
export async function createOpeningBalance(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  assertCan(ctx.actor, "finance.manage");
  const r = new Reader(asBody(input));
  const supplierId = r.id("supplierId", "Tedarikçi");
  const date = r.date("date", "Bakiye tarihi", { notAfter: ctx.today });
  const amount = r.decimal("amount", "Açılış borcu", { positive: true });
  const currency = r.oneOf("currency", "Para birimi", CURRENCIES.values, "TRY");
  const description = r.text("description", "Açıklama (ör. 30.09.2026 itibarıyla cari ekstre)", { max: 300 });
  const dueDate = r.optDate("dueDate", "Vade tarihi");
  const invoiceNo = r.optText("documentNo", "Belge / ekstre no", { max: 60 });
  if (!r.ok) throw new ValidationError(r.errors);
  return ctx.db.tx(async (q) => {
    const [s] = await q.query<{ name: string }>(`select name from suppliers where id = $1`, [supplierId]);
    if (!s) throw new ValidationError({ supplierId: "Tedarikçi bulunamadı." });
    try {
      const [row] = await q.query<{ id: string }>(
        `insert into invoices (supplier_id, kind, invoice_no, invoice_date, due_date, currency, total_net, total, description, created_by)
         values ($1, 'acilis', $2, $3, $4, $5, $6, $6, $7, $8) returning id`,
        [supplierId, invoiceNo, date, dueDate && dueDate >= date ? dueDate : null, currency, amount, description, ctx.actor.userId],
      );
      await audit(q, ctx, { entity: "invoice", entityId: row!.id, supplierId, action: "opening", finance: true, summary: `Açılış borcu girildi: ${s.name} ${formatMoney(amount, currency)} (${formatDate(date)}) – ${description}` });
      return row!;
    } catch (e) {
      if (isUniqueViolation(e, "invoices_opening_uq")) throw new ConflictError("duplicate_opening", "Bu tedarikçi için bu para biriminde açılış borcu zaten girilmiş. Değiştirmek için önce mevcut kaydı gerekçeyle iptal edin.");
      throw e;
    }
  });
}

export interface InvoiceDetail extends InvoiceSummary {
  description: string | null;
  note: string | null;
  shippingAmount: string;
  shippingVatRate: string;
  declaredTotal: string | null;
  fxRate: string | null;
  fxDate: string | null;
  fxSource: string | null;
  reviewNote: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  createdByName: string;
  createdAt: string;
  cancelReason: string | null;
  canceledByName: string | null;
  version: number;
  lines: { lineNo: number; orderLineId: string | null; orderId: string | null; orderNo: string | null; label: string; qty: string; unitLabel: string; packText: string; unitPrice: string; discountPct: string; vatRate: string; netAmount: string; vatAmount: string }[];
  receipts: { id: string; receiptNo: string; receivedOn: string }[];
  allocations: { id: string; paymentId: string; paymentNo: string; paidOn: string; amount: string; method: string }[];
  adjustmentDocs: { id: string; adjustmentNo: string; type: string; direction: string; totalAmount: string; status: string; adjDate: string }[];
  discrepancies: Discrepancy[];
  history: AuditRow[];
}

export async function getInvoice(ctx: Ctx, id: string): Promise<InvoiceDetail> {
  assertCan(ctx.actor, "finance.view");
  const [head] = await ctx.db.query<Omit<InvoiceDetail, "lines" | "receipts" | "allocations" | "adjustmentDocs" | "discrepancies" | "history" | "dueState" | "daysToDue">>(
    `select x.*, i.description, i.note, i.shipping_amount as "shippingAmount", i.shipping_vat_rate as "shippingVatRate", i.declared_total as "declaredTotal",
       i.fx_rate as "fxRate", i.fx_date as "fxDate", i.fx_source as "fxSource", i.review_note as "reviewNote", rv.display_name as "reviewedByName",
       i.reviewed_at as "reviewedAt", cb.display_name as "createdByName", i.created_at as "createdAt", i.cancel_reason as "cancelReason",
       xb.display_name as "canceledByName", i.version
     from (${INVOICE_OPEN_SELECT} where i.id = $1) x join invoices i on i.id = x.id join app_users cb on cb.id = i.created_by
     left join app_users rv on rv.id = i.reviewed_by left join app_users xb on xb.id = i.canceled_by`,
    [id],
  );
  if (!head) throw new NotFoundError("Fatura bulunamadı.");
  const lines = await ctx.db.query<InvoiceDetail["lines"][number] & { productName: string | null; brand: string | null; model: string | null; attributes: string | null; description: string | null; baseUnit: string | null; packSize: string }>(
    `select il.line_no as "lineNo", il.order_line_id as "orderLineId", po.id as "orderId", po.order_no as "orderNo", p.name as "productName", v.brand, v.model,
       v.attributes, il.description, il.qty, il.unit_label as "unitLabel", il.pack_size as "packSize", v.base_unit as "baseUnit", il.unit_price as "unitPrice",
       il.discount_pct as "discountPct", il.vat_rate as "vatRate", il.net_amount as "netAmount", il.vat_amount as "vatAmount"
     from invoice_lines il left join variants v on v.id = il.variant_id left join products p on p.id = v.product_id
     left join order_lines ol on ol.id = il.order_line_id left join purchase_orders po on po.id = ol.order_id
     where il.invoice_id = $1 order by il.line_no`,
    [id],
  );
  const receipts = await ctx.db.query<InvoiceDetail["receipts"][number]>(
    `select r.id, r.receipt_no as "receiptNo", r.received_on as "receivedOn" from invoice_receipts ir join receipts r on r.id = ir.receipt_id where ir.invoice_id = $1 order by r.received_on`,
    [id],
  );
  const allocations = await ctx.db.query<InvoiceDetail["allocations"][number]>(
    `select pa.id, p.id as "paymentId", p.payment_no as "paymentNo", p.paid_on as "paidOn", pa.amount, p.method
     from payment_allocations pa join payments p on p.id = pa.payment_id where pa.invoice_id = $1 and pa.released_at is null order by p.paid_on`,
    [id],
  );
  const adjustmentDocs = await ctx.db.query<InvoiceDetail["adjustmentDocs"][number]>(
    `select id, adjustment_no as "adjustmentNo", type, direction, total_amount as "totalAmount", status, adj_date as "adjDate" from financial_adjustments where invoice_id = $1 order by adj_date`,
    [id],
  );
  const history = await ctx.db.query<AuditRow>(`select ${AUDIT_COLS} from audit_log where entity = 'invoice' and entity_id = $1 order by at desc, id desc`, [id]);
  return {
    ...withDueState(head, ctx.today),
    lines: lines.map(({ productName, brand, model, attributes, description, baseUnit, packSize, ...l }) => ({
      ...l,
      label: productName ? variantLabel({ productName, brand, model, attributes }) : description ?? "—",
      packText: baseUnit ? packLabel({ orderUnit: l.unitLabel, baseUnit, packSize }) : l.unitLabel,
    })),
    receipts,
    allocations,
    adjustmentDocs,
    discrepancies: head.canceledAt ? [] : await invoiceDiscrepancies(ctx.db, id),
    history,
  };
}

/** Fark incelemesi: yetkili farkı kabul eder ya da tedarikçiye itiraz edildiğini kaydeder. Borç tutarı değişmez. */
export async function reviewInvoice(ctx: Ctx, id: string, input: unknown): Promise<void> {
  assertCan(ctx.actor, "finance.manage");
  const r = new Reader(asBody(input));
  const version = r.version();
  const decision = r.oneOf("decision", "İnceleme kararı", ["onaylandi", "itiraz"] as const);
  const note = r.text("note", "İnceleme notu", { max: 1000 });
  if (!r.ok) throw new ValidationError(r.errors);
  await ctx.db.tx(async (q) => {
    const cur = await lockRow<{ version: number; review_status: string; invoice_no: string | null; supplier_id: string; canceled_at: string | null }>(q, "invoices", id, "version, review_status, invoice_no, supplier_id, canceled_at");
    if (cur.version !== version) throw new VersionConflictError();
    if (cur.canceled_at) throw new ConflictError("canceled", "İptal edilmiş fatura incelenmez.");
    await q.query(`update invoices set review_status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now(), version = version + 1, updated_at = now() where id = $1`, [
      id, decision, note, ctx.actor.userId,
    ]);
    await audit(q, ctx, {
      entity: "invoice", entityId: id, supplierId: cur.supplier_id, action: "review", finance: true, summary: `Fatura ${cur.invoice_no ?? ""} farkı incelendi: ${INVOICE_REVIEWS.label(decision)} – ${note}`,
      changes: { reviewStatus: { label: "İnceleme", from: INVOICE_REVIEWS.label(cur.review_status), to: INVOICE_REVIEWS.label(decision) } },
    });
  });
}

/** Vade, not ve kur bilgisi düzeltmesi (tutarlar değişmez). Eski/yeni değerler geçmişe yazılır. */
export async function updateInvoiceMeta(ctx: Ctx, id: string, input: unknown): Promise<void> {
  assertCan(ctx.actor, "finance.manage");
  const r = new Reader(asBody(input));
  const version = r.version();
  const dueDate = r.optDate("dueDate", "Vade tarihi");
  const note = r.optText("note", "Not", { multiline: true, max: 1000 });
  if (!r.ok) throw new ValidationError(r.errors);
  await ctx.db.tx(async (q) => {
    const cur = await lockRow<{ version: number; due_date: string | null; note: string | null; invoice_date: string; currency: string; fx_rate: string | null; fx_date: string | null; fx_source: string | null; supplier_id: string; invoice_no: string | null }>(
      q, "invoices", id, "version, due_date, note, invoice_date, currency, fx_rate, fx_date, fx_source, supplier_id, invoice_no",
    );
    if (cur.version !== version) throw new VersionConflictError();
    const fx = readFx(r, cur.currency);
    if (dueDate && dueDate < cur.invoice_date) r.error("dueDate", "Vade tarihi fatura tarihinden önce olamaz.");
    if (!r.ok) throw new ValidationError(r.errors);
    await q.query(`update invoices set due_date = $2, note = $3, fx_rate = $4, fx_date = $5, fx_source = $6, version = version + 1, updated_at = now() where id = $1`, [
      id, dueDate, note, fx.fxRate, fx.fxDate, fx.fxSource,
    ]);
    const same = (a: string | null, b: string | null) => (a === null || b === null ? a === b : /^[\d.]+$/.test(a) && /^[\d.]+$/.test(b) ? dec(a).eq(dec(b)) : a === b);
    const pairs: [string, string, string | null, string | null][] = [
      ["dueDate", "Vade", cur.due_date, dueDate], ["note", "Not", cur.note, note], ["fxRate", "Kur", cur.fx_rate, fx.fxRate],
      ["fxDate", "Kur tarihi", cur.fx_date, fx.fxDate], ["fxSource", "Kur kaynağı", cur.fx_source, fx.fxSource],
    ];
    const changes = Object.fromEntries(pairs.filter(([, , a, b]) => !same(a, b)).map(([k, label, from, to]) => [k, { label, from, to }]));
    if (Object.keys(changes).length) await audit(q, ctx, { entity: "invoice", entityId: id, supplierId: cur.supplier_id, action: "update", finance: true, summary: `Fatura ${cur.invoice_no ?? "(açılış)"} bilgileri güncellendi`, changes });
  });
}

/** Gerekçeli iptal (ters kayıt). Ödeme dağıtılmışsa veya onaylı düzeltme bağlıysa önce onlar kaldırılmalı. Kayıt silinmez. */
export async function cancelInvoice(ctx: Ctx, id: string, input: unknown): Promise<void> {
  assertCan(ctx.actor, "finance.manage");
  const r = new Reader(asBody(input));
  const version = r.version();
  const reason = r.text("reason", "İptal gerekçesi", { max: 500 });
  if (!r.ok) throw new ValidationError(r.errors);
  await ctx.db.tx(async (q) => {
    const cur = await lockRow<{ version: number; canceled_at: string | null; invoice_no: string | null; supplier_id: string; total: string; currency: string; kind: string }>(
      q, "invoices", id, "version, canceled_at, invoice_no, supplier_id, total, currency, kind",
    );
    if (cur.version !== version) throw new VersionConflictError();
    if (cur.canceled_at) throw new ConflictError("canceled", "Bu fatura zaten iptal edilmiş.");
    const [{ alloc }] = (await q.query<{ alloc: string }>(`select coalesce(sum(amount), 0) as alloc from payment_allocations where invoice_id = $1 and released_at is null`, [id])) as [{ alloc: string }];
    if (dec(alloc).gt(0)) throw new ConflictError("has_payments", `Bu faturaya ${formatMoney(alloc, cur.currency)} ödeme dağıtılmış. Önce ödeme sayfasından dağıtımı kaldırın (ödeme avans olarak kalır).`);
    if ((await q.query(`select 1 from financial_adjustments where invoice_id = $1 and status <> 'iptal'`, [id])).length) {
      throw new ConflictError("has_adjustments", "Bu faturaya bağlı finansal düzeltme var; önce onu iptal edin.");
    }
    await q.query(`update invoices set canceled_at = now(), canceled_by = $2, cancel_reason = $3, version = version + 1, updated_at = now() where id = $1`, [id, ctx.actor.userId, reason]);
    await audit(q, ctx, {
      entity: "invoice", entityId: id, supplierId: cur.supplier_id, action: "cancel", finance: true,
      summary: `${cur.kind === "acilis" ? "Açılış borcu" : `Fatura ${cur.invoice_no}`} iptal edildi (ters kayıt, ${formatMoney(cur.total, cur.currency)}): ${reason}`,
    });
  });
}

/** Fatura formu için: tedarikçinin faturalanacak sipariş kalemleri (kabul edilen, faturalanan miktar ve sipariş fiyatıyla). */
export async function invoiceableLines(ctx: Ctx, supplierId: string) {
  assertCan(ctx.actor, "finance.manage");
  const rows = await ctx.db.query<{
    orderLineId: string; orderId: string; orderNo: string; lineNo: number; currency: string; variantId: string; productName: string; brand: string | null; model: string | null;
    attributes: string | null; qty: string; canceledQty: string; unitLabel: string; unitPrice: string; discountPct: string; vatRate: string; accepted: string; invoiced: string; placedAt: string;
  }>(
    `select ol.id as "orderLineId", po.id as "orderId", po.order_no as "orderNo", ol.line_no as "lineNo", po.currency, ol.variant_id as "variantId",
       p.name as "productName", v.brand, v.model, v.attributes, ol.qty, ol.canceled_qty as "canceledQty", ol.unit_label as "unitLabel",
       ol.unit_price as "unitPrice", ol.discount_pct as "discountPct", ol.vat_rate as "vatRate", st.accepted, po.placed_at as "placedAt",
       coalesce((select sum(il.qty) from invoice_lines il join invoices i on i.id = il.invoice_id where il.order_line_id = ol.id and i.canceled_at is null), 0) as invoiced
     from order_lines ol join purchase_orders po on po.id = ol.order_id join variants v on v.id = ol.variant_id join products p on p.id = v.product_id
     ${LINE_STATS}
     where po.supplier_id = $1 and po.status in ('verildi', 'kapandi') order by po.placed_at, ol.line_no`,
    [supplierId],
  );
  const receipts = await ctx.db.query<{ id: string; receiptNo: string; receivedOn: string; orderNo: string; invoiced: boolean }>(
    `select r.id, r.receipt_no as "receiptNo", r.received_on as "receivedOn", po.order_no as "orderNo",
       exists(select 1 from invoice_receipts ir join invoices i on i.id = ir.invoice_id where ir.receipt_id = r.id and i.canceled_at is null) as invoiced
     from receipts r join purchase_orders po on po.id = r.order_id where po.supplier_id = $1 and r.status = 'kaydedildi' order by r.received_on desc limit 100`,
    [supplierId],
  );
  return {
    lines: rows.map((r) => ({ ...r, label: variantLabel(r), uninvoicedAccepted: qtyStr(dec(r.accepted).minus(dec(r.invoiced))) })),
    receipts,
  };
}
