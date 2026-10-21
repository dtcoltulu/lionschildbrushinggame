import { formatDate } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/decimal";
import { ADJ_DIRECTIONS, ADJ_TYPES, CURRENCIES } from "@/lib/labels";
import { asBody, isUuid, Reader } from "@/lib/validate";
import { audit } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { ConflictError, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { assertCan } from "../permissions";
import { lockRow, nextNo } from "./common";

/**
 * Finansal düzeltmeler (iade faturası, fiyat farkı, iskonto, kur farkı). Bakiyeye yalnızca ONAYLANINCA yansır.
 * Fiziksel iade (teslimat sorunu) tek başına borcu düşürmez: tedarikçinin düzeltme belgesi buraya girilip onaylanmalıdır.
 */

export interface Adjustment {
  id: string;
  adjustmentNo: string;
  supplierId: string;
  supplierName: string;
  adjDate: string;
  currency: string;
  type: string;
  direction: string;
  netAmount: string;
  vatAmount: string;
  totalAmount: string;
  documentNo: string | null;
  description: string;
  invoiceId: string | null;
  invoiceNo: string | null;
  issueId: string | null;
  issueNo: string | null;
  status: string;
  createdByName: string;
  approvedByName: string | null;
  approvedAt: string | null;
  cancelReason: string | null;
  version: number;
}

const SELECT = `select a.id, a.adjustment_no as "adjustmentNo", a.supplier_id as "supplierId", s.name as "supplierName", a.adj_date as "adjDate", a.currency,
    a.type, a.direction, a.net_amount as "netAmount", a.vat_amount as "vatAmount", a.total_amount as "totalAmount", a.document_no as "documentNo",
    a.description, a.invoice_id as "invoiceId", i.invoice_no as "invoiceNo", a.issue_id as "issueId", di.issue_no as "issueNo", a.status,
    cb.display_name as "createdByName", ab.display_name as "approvedByName", a.approved_at as "approvedAt", a.cancel_reason as "cancelReason", a.version
  from financial_adjustments a join suppliers s on s.id = a.supplier_id join app_users cb on cb.id = a.created_by
  left join app_users ab on ab.id = a.approved_by left join invoices i on i.id = a.invoice_id left join delivery_issues di on di.id = a.issue_id`;

export async function listAdjustments(ctx: Ctx, f: { supplierId?: string | null; status?: string | null } = {}): Promise<Adjustment[]> {
  assertCan(ctx.actor, "finance.view");
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.supplierId && isUuid(f.supplierId)) {
    params.push(f.supplierId);
    where.push(`a.supplier_id = $${params.length}`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`a.status = $${params.length}`);
  }
  return ctx.db.query<Adjustment>(`${SELECT} ${where.length ? `where ${where.join(" and ")}` : ""} order by a.adj_date desc, a.created_at desc limit 500`, params);
}

export async function getAdjustment(ctx: Ctx, id: string): Promise<Adjustment> {
  assertCan(ctx.actor, "finance.view");
  const [a] = await ctx.db.query<Adjustment>(`${SELECT} where a.id = $1`, [id]);
  if (!a) throw new NotFoundError("Düzeltme kaydı bulunamadı.");
  return a;
}

export async function createAdjustment(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  assertCan(ctx.actor, "finance.manage");
  const r = new Reader(asBody(input));
  const supplierId = r.id("supplierId", "Tedarikçi");
  const adjDate = r.date("adjDate", "Belge tarihi", { notAfter: ctx.today });
  const currency = r.oneOf("currency", "Para birimi", CURRENCIES.values, "TRY");
  const type = r.oneOf("type", "Düzeltme türü", ADJ_TYPES.values);
  const direction = r.oneOf("direction", "Etkisi", ADJ_DIRECTIONS.values, "borc_azaltir");
  const netAmount = r.decimal("netAmount", "Tutar (KDV hariç)", { min: "0" });
  const vatAmount = r.optDecimal("vatAmount", "KDV tutarı", { min: "0" }) ?? "0.00";
  const documentNo = r.optText("documentNo", "Belge no", { max: 60 });
  const description = r.text("description", "Açıklama", { max: 1000 });
  const invoiceId = r.optId("invoiceId", "İlgili fatura");
  const issueId = r.optId("issueId", "İlgili teslimat sorunu");
  if (dec(netAmount).plus(dec(vatAmount)).lte(0)) r.error("netAmount", "Tutar sıfırdan büyük olmalı.");
  if (!r.ok) throw new ValidationError(r.errors);
  return ctx.db.tx(async (q) => {
    const [s] = await q.query<{ name: string }>(`select name from suppliers where id = $1`, [supplierId]);
    if (!s) throw new ValidationError({ supplierId: "Tedarikçi bulunamadı." });
    if (invoiceId) {
      const [i] = await q.query<{ supplier_id: string; currency: string; canceled_at: string | null }>(`select supplier_id, currency, canceled_at from invoices where id = $1`, [invoiceId]);
      if (!i || i.canceled_at || i.supplier_id !== supplierId || i.currency !== currency) throw new ValidationError({ invoiceId: "Fatura bu tedarikçiye ve para birimine ait, iptal edilmemiş bir fatura olmalı." });
    }
    if (issueId) {
      const [di] = await q.query<{ supplier_id: string }>(`select po.supplier_id from delivery_issues di join purchase_orders po on po.id = di.order_id where di.id = $1`, [issueId]);
      if (!di || di.supplier_id !== supplierId) throw new ValidationError({ issueId: "Teslimat sorunu bu tedarikçiye ait değil." });
    }
    const no = await nextNo(q, "FD", ctx.today);
    const [row] = await q.query<{ id: string }>(
      `insert into financial_adjustments (adjustment_no, supplier_id, adj_date, currency, type, direction, net_amount, vat_amount, document_no, description, invoice_id, issue_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [no, supplierId, adjDate, currency, type, direction, netAmount, vatAmount, documentNo, description, invoiceId, issueId, ctx.actor.userId],
    );
    await audit(q, ctx, {
      entity: "adjustment", entityId: row!.id, supplierId, action: "create", finance: true,
      summary: `Finansal düzeltme ${no} girildi (onay bekliyor): ${s.name} ${ADJ_TYPES.label(type)}, ${ADJ_DIRECTIONS.label(direction)} ${formatMoney(dec(netAmount).plus(dec(vatAmount)), currency)} (${formatDate(adjDate)})`,
    });
    return row!;
  });
}

async function invoiceRoom(q: Queryable, invoiceId: string): Promise<string> {
  const [o] = await q.query<{ open: string }>(
    `select (i.total + coalesce((select sum(case when direction = 'borc_artirir' then total_amount else -total_amount end) from financial_adjustments where invoice_id = i.id and status = 'onaylandi'), 0)
       - coalesce((select sum(amount) from payment_allocations where invoice_id = i.id and released_at is null), 0)) as open from invoices i where i.id = $1`,
    [invoiceId],
  );
  return o!.open;
}

/** Onay: bakiyeye yansır. Faturaya bağlı borç azaltan düzeltme, faturanın ödenmemiş kalanını aşamaz. */
export async function approveAdjustment(ctx: Ctx, id: string, input: unknown): Promise<void> {
  assertCan(ctx.actor, "adjustment.approve");
  const r = new Reader(asBody(input));
  const version = r.version();
  if (!r.ok) throw new ValidationError(r.errors);
  await ctx.db.tx(async (q) => {
    const a = await lockRow<{ version: number; status: string; invoice_id: string | null; direction: string; total_amount: string; adjustment_no: string; supplier_id: string; currency: string }>(
      q, "financial_adjustments", id, "version, status, invoice_id, direction, total_amount, adjustment_no, supplier_id, currency",
    );
    if (a.version !== version) throw new VersionConflictError();
    if (a.status !== "onay_bekliyor") throw new ConflictError("not_pending", "Bu düzeltme onay beklemiyor.");
    if (a.invoice_id && a.direction === "borc_azaltir") {
      await lockRow(q, "invoices", a.invoice_id, "id");
      const room = await invoiceRoom(q, a.invoice_id);
      if (dec(a.total_amount).gt(dec(room))) {
        throw new ConflictError("exceeds_invoice", `Faturanın ödenmemiş kalanı ${formatMoney(room, a.currency)}; ${formatMoney(a.total_amount, a.currency)} düzeltme faturaya bağlanamaz. Fazla ödeme varsa önce dağıtımı azaltın veya düzeltmeyi faturasız (tedarikçi bakiyesine) girin.`);
      }
    }
    await q.query(`update financial_adjustments set status = 'onaylandi', approved_by = $2, approved_at = now(), version = version + 1 where id = $1`, [id, ctx.actor.userId]);
    await audit(q, ctx, { entity: "adjustment", entityId: id, supplierId: a.supplier_id, action: "approve", finance: true, summary: `Finansal düzeltme ${a.adjustment_no} onaylandı; bakiyeye yansıdı (${formatMoney(a.total_amount, a.currency)})` });
  });
}

export async function cancelAdjustment(ctx: Ctx, id: string, input: unknown): Promise<void> {
  assertCan(ctx.actor, "finance.manage");
  const r = new Reader(asBody(input));
  const version = r.version();
  const reason = r.text("reason", "İptal gerekçesi", { max: 500 });
  if (!r.ok) throw new ValidationError(r.errors);
  await ctx.db.tx(async (q) => {
    const a = await lockRow<{ version: number; status: string; invoice_id: string | null; direction: string; total_amount: string; adjustment_no: string; supplier_id: string; currency: string }>(
      q, "financial_adjustments", id, "version, status, invoice_id, direction, total_amount, adjustment_no, supplier_id, currency",
    );
    if (a.version !== version) throw new VersionConflictError();
    if (a.status === "iptal") throw new ConflictError("canceled", "Bu düzeltme zaten iptal edilmiş.");
    if (a.status === "onaylandi" && a.invoice_id && a.direction === "borc_artirir") {
      const room = await invoiceRoom(q, a.invoice_id);
      if (dec(room).lt(dec(a.total_amount))) throw new ConflictError("allocated", "Bu düzeltmeyle artan tutara ödeme dağıtılmış; önce dağıtımı azaltın.");
    }
    await q.query(`update financial_adjustments set status = 'iptal', canceled_at = now(), canceled_by = $2, cancel_reason = $3, version = version + 1 where id = $1`, [id, ctx.actor.userId, reason]);
    await audit(q, ctx, { entity: "adjustment", entityId: id, supplierId: a.supplier_id, action: "cancel", finance: true, summary: `Finansal düzeltme ${a.adjustment_no} iptal edildi${a.status === "onaylandi" ? " (bakiyeden çıkarıldı)" : ""}: ${reason}` });
  });
}
