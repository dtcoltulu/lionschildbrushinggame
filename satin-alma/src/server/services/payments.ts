import { formatDate } from "@/lib/dates";
import { dec, formatMoney, money } from "@/lib/decimal";
import { CURRENCIES, PAYMENT_METHODS } from "@/lib/labels";
import { asBody, isUuid, Reader } from "@/lib/validate";
import { audit, AUDIT_COLS, type AuditRow } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { ConflictError, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { assertCan } from "../permissions";
import { lockRow, nextNo } from "./common";

/**
 * Ödeme ≠ fatura. Ödeme tedarikçi bakiyesini azaltır; faturalara dağıtılan kısmı faturaların kalanını azaltır,
 * dağıtılmayan kısım "avans" (faturaya bağlanmamış ödeme) olarak ayrı izlenir. Ödemeler ürünlere/harcamaya dağıtılmaz.
 */

export interface PaymentSummary {
  id: string;
  paymentNo: string;
  supplierId: string;
  supplierName: string;
  paidOn: string;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  allocated: string;
  unallocated: string;
  canceledAt: string | null;
}

const SELECT = `select p.id, p.payment_no as "paymentNo", p.supplier_id as "supplierId", s.name as "supplierName", p.paid_on as "paidOn", p.amount,
    p.currency, p.method, p.reference, coalesce(al.v, 0) as allocated, (p.amount - coalesce(al.v, 0)) as unallocated, p.canceled_at as "canceledAt"
  from payments p join suppliers s on s.id = p.supplier_id
  left join lateral (select sum(amount) as v from payment_allocations where payment_id = p.id and released_at is null) al on true`;

export async function listPayments(ctx: Ctx, f: { supplierId?: string | null; from?: string | null; to?: string | null; view?: "avans" | "iptal" | "tumu" } = {}): Promise<PaymentSummary[]> {
  assertCan(ctx.actor, "finance.view");
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.supplierId && isUuid(f.supplierId)) {
    params.push(f.supplierId);
    where.push(`p.supplier_id = $${params.length}`);
  }
  if (f.from) {
    params.push(f.from);
    where.push(`p.paid_on >= $${params.length}`);
  }
  if (f.to) {
    params.push(f.to);
    where.push(`p.paid_on <= $${params.length}`);
  }
  if (f.view === "avans") where.push("p.canceled_at is null and p.amount > coalesce(al.v, 0)");
  if (f.view === "iptal") where.push("p.canceled_at is not null");
  return ctx.db.query<PaymentSummary>(`${SELECT} ${where.length ? `where ${where.join(" and ")}` : ""} order by p.paid_on desc, p.created_at desc limit 1000`, params);
}

interface AllocIn {
  invoiceId: string;
  amount: string;
}

function readAllocations(r: Reader): AllocIn[] {
  return r.list("allocations", "Fatura dağıtımı", { max: 100 }).map((a) => ({
    invoiceId: a.id("invoiceId", "Fatura"),
    amount: a.decimal("amount", "Dağıtılan tutar", { positive: true }),
  }));
}

/** Dağıtımları uygular: fatura ve ödeme satırları kilitlenir; tutarlar kalanları aşamaz (veritabanı tetikleyicisi de denetler). */
async function applyAllocations(q: Queryable, ctx: Ctx, payment: { id: string; payment_no: string; supplier_id: string; currency: string; amount: string }, list: AllocIn[]) {
  if (!list.length) return;
  const [{ used }] = (await q.query<{ used: string }>(`select coalesce(sum(amount), 0) as used from payment_allocations where payment_id = $1 and released_at is null`, [payment.id])) as [{ used: string }];
  const total = list.reduce((a, l) => a.plus(dec(l.amount)), dec(0));
  if (dec(used).plus(total).gt(dec(payment.amount))) {
    throw new ValidationError({ allocations: `Dağıtılan toplam (${formatMoney(dec(used).plus(total), payment.currency)}) ödeme tutarını (${formatMoney(payment.amount, payment.currency)}) aşıyor.` });
  }
  // Kilitlenme sırasını sabitlemek için faturalar kimlik sırasıyla kilitlenir.
  const merged = new Map<string, ReturnType<typeof dec>>();
  for (const l of list) merged.set(l.invoiceId, (merged.get(l.invoiceId) ?? dec(0)).plus(dec(l.amount)));
  for (const invoiceId of [...merged.keys()].sort()) {
    const amount = merged.get(invoiceId)!;
    const inv = await lockRow<{ supplier_id: string; currency: string; canceled_at: string | null; invoice_no: string | null; kind: string }>(q, "invoices", invoiceId, "supplier_id, currency, canceled_at, invoice_no, kind");
    const label = inv.kind === "acilis" ? "Açılış borcu" : `Fatura ${inv.invoice_no}`;
    if (inv.canceled_at) throw new ValidationError({ allocations: `${label} iptal edilmiş.` });
    if (inv.supplier_id !== payment.supplier_id) throw new ValidationError({ allocations: `${label} bu tedarikçiye ait değil.` });
    if (inv.currency !== payment.currency) throw new ValidationError({ allocations: `${label} farklı para biriminde (${inv.currency}); farklı para birimleri birbirine dağıtılmaz.` });
    const [o] = await q.query<{ open: string }>(
      `select (i.total + coalesce((select sum(case when direction = 'borc_artirir' then total_amount else -total_amount end) from financial_adjustments where invoice_id = i.id and status = 'onaylandi'), 0)
         - coalesce((select sum(amount) from payment_allocations where invoice_id = i.id and released_at is null), 0)) as open from invoices i where i.id = $1`,
      [invoiceId],
    );
    if (amount.gt(dec(o!.open))) throw new ValidationError({ allocations: `${label}: kalan borç ${formatMoney(o!.open, payment.currency)}; daha fazlası dağıtılamaz.` });
    const [existing] = await q.query<{ id: string }>(`select id from payment_allocations where payment_id = $1 and invoice_id = $2 and released_at is null`, [payment.id, invoiceId]);
    if (existing) await q.query(`update payment_allocations set amount = amount + $2 where id = $1`, [existing.id, money(amount)]);
    else await q.query(`insert into payment_allocations (payment_id, invoice_id, amount, created_by) values ($1, $2, $3, $4)`, [payment.id, invoiceId, money(amount), ctx.actor.userId]);
    await audit(q, ctx, { entity: "payment", entityId: payment.id, supplierId: payment.supplier_id, action: "allocate", finance: true, summary: `Ödeme ${payment.payment_no}: ${label} için ${formatMoney(amount, payment.currency)} dağıtıldı` });
  }
}

function readFx(r: Reader, currency: string) {
  const fxRate = r.optDecimal("fxRate", "Kur (1 birim = ? TL)", { scale: 6, positive: true });
  const fxDate = r.optDate("fxDate", "Kur tarihi");
  const fxSource = r.optText("fxSource", "Kur kaynağı", { max: 120 });
  if (currency === "TRY" && fxRate) r.error("fxRate", "TL ödemede kur girilmez.");
  if (fxRate && (!fxDate || !fxSource)) r.error("fxSource", "TL karşılığı için kurla birlikte kur tarihi ve kaynağı yazılmalı.");
  return { fxRate: currency === "TRY" ? null : fxRate, fxDate: fxRate ? fxDate : null, fxSource: fxRate ? fxSource : null };
}

export async function createPayment(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  assertCan(ctx.actor, "finance.manage");
  const r = new Reader(asBody(input));
  const supplierId = r.id("supplierId", "Tedarikçi");
  const paidOn = r.date("paidOn", "Ödeme tarihi", { notAfter: ctx.today });
  const amount = r.decimal("amount", "Tutar", { positive: true });
  const currency = r.oneOf("currency", "Para birimi", CURRENCIES.values, "TRY");
  const method = r.oneOf("method", "Ödeme yöntemi", PAYMENT_METHODS.values);
  const reference = r.optText("reference", "Dekont / referans no", { max: 120 });
  const note = r.optText("note", "Açıklama", { multiline: true, max: 1000 });
  const fx = readFx(r, currency);
  const allocations = readAllocations(r);
  const key = r.optKey();
  if (!r.ok) throw new ValidationError(r.errors);
  return ctx.db.tx(async (q) => {
    if (key) {
      const [dup] = await q.query<{ id: string }>(`select id from payments where idempotency_key = $1`, [key]);
      if (dup) return dup;
    }
    const [s] = await q.query<{ name: string }>(`select name from suppliers where id = $1`, [supplierId]);
    if (!s) throw new ValidationError({ supplierId: "Tedarikçi bulunamadı." });
    const paymentNo = await nextNo(q, "OD", ctx.today);
    const [row] = await q.query<{ id: string }>(
      `insert into payments (payment_no, supplier_id, paid_on, amount, currency, method, reference, note, fx_rate, fx_date, fx_source, idempotency_key, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [paymentNo, supplierId, paidOn, amount, currency, method, reference, note, fx.fxRate, fx.fxDate, fx.fxSource, key, ctx.actor.userId],
    );
    await audit(q, ctx, { entity: "payment", entityId: row!.id, supplierId, action: "create", finance: true, summary: `Ödeme ${paymentNo}: ${s.name} ${formatMoney(amount, currency)} (${PAYMENT_METHODS.label(method)}, ${formatDate(paidOn)})` });
    await applyAllocations(q, ctx, { id: row!.id, payment_no: paymentNo, supplier_id: supplierId, currency, amount }, allocations);
    return row!;
  });
}

/** Avans kalan ödemeyi sonradan faturalara dağıtma. */
export async function allocatePayment(ctx: Ctx, id: string, input: unknown): Promise<void> {
  assertCan(ctx.actor, "finance.manage");
  const r = new Reader(asBody(input));
  const allocations = readAllocations(r);
  if (!allocations.length) r.error("allocations", "En az bir fatura seçin.");
  if (!r.ok) throw new ValidationError(r.errors);
  await ctx.db.tx(async (q) => {
    const p = await lockRow<{ id: string; payment_no: string; supplier_id: string; currency: string; amount: string; canceled_at: string | null }>(q, "payments", id, "id, payment_no, supplier_id, currency, amount, canceled_at");
    if (p.canceled_at) throw new ConflictError("canceled", "İptal edilmiş ödeme dağıtılamaz.");
    await applyAllocations(q, ctx, p, allocations);
  });
}

/** Dağıtımı kaldırma (yanlış faturaya dağıtıldıysa). Tutar ödeme üzerinde avans olarak kalır; bakiye değişmez. */
export async function releaseAllocation(ctx: Ctx, allocationId: string, input: unknown): Promise<void> {
  assertCan(ctx.actor, "finance.manage");
  const r = new Reader(asBody(input));
  const reason = r.text("reason", "Gerekçe", { max: 300 });
  if (!r.ok) throw new ValidationError(r.errors);
  await ctx.db.tx(async (q) => {
    const [a] = await q.query<{ payment_id: string; amount: string; invoice_no: string | null; payment_no: string; supplier_id: string; currency: string }>(
      `select pa.payment_id, pa.amount, i.invoice_no, p.payment_no, p.supplier_id, p.currency from payment_allocations pa
       join invoices i on i.id = pa.invoice_id join payments p on p.id = pa.payment_id where pa.id = $1 and pa.released_at is null for update of pa`,
      [allocationId],
    );
    if (!a) throw new NotFoundError("Dağıtım bulunamadı.");
    await q.query(`update payment_allocations set released_at = now(), released_by = $2, release_reason = $3 where id = $1`, [allocationId, ctx.actor.userId, reason]);
    await audit(q, ctx, { entity: "payment", entityId: a.payment_id, supplierId: a.supplier_id, action: "release", finance: true, summary: `Ödeme ${a.payment_no}: fatura ${a.invoice_no ?? "(açılış)"} dağıtımı kaldırıldı (${formatMoney(a.amount, a.currency)}): ${reason}` });
  });
}

/** Gerekçeli iptal (ters kayıt): ödeme bakiyeden çıkar, dağıtımları kaldırılır. Kayıt silinmez. */
export async function cancelPayment(ctx: Ctx, id: string, input: unknown): Promise<void> {
  assertCan(ctx.actor, "finance.manage");
  const r = new Reader(asBody(input));
  const version = r.version();
  const reason = r.text("reason", "İptal gerekçesi", { max: 500 });
  if (!r.ok) throw new ValidationError(r.errors);
  await ctx.db.tx(async (q) => {
    const p = await lockRow<{ version: number; canceled_at: string | null; payment_no: string; supplier_id: string; amount: string; currency: string }>(q, "payments", id, "version, canceled_at, payment_no, supplier_id, amount, currency");
    if (p.version !== version) throw new VersionConflictError();
    if (p.canceled_at) throw new ConflictError("canceled", "Bu ödeme zaten iptal edilmiş.");
    await q.query(`update payment_allocations set released_at = now(), released_by = $2, release_reason = $3 where payment_id = $1 and released_at is null`, [id, ctx.actor.userId, `Ödeme iptal edildi: ${reason}`]);
    await q.query(`update payments set canceled_at = now(), canceled_by = $2, cancel_reason = $3, version = version + 1 where id = $1`, [id, ctx.actor.userId, reason]);
    await audit(q, ctx, { entity: "payment", entityId: id, supplierId: p.supplier_id, action: "cancel", finance: true, summary: `Ödeme ${p.payment_no} iptal edildi (ters kayıt, ${formatMoney(p.amount, p.currency)}): ${reason}` });
  });
}

export interface PaymentDetail extends PaymentSummary {
  note: string | null;
  fxRate: string | null;
  fxDate: string | null;
  fxSource: string | null;
  createdByName: string;
  createdAt: string;
  cancelReason: string | null;
  version: number;
  allocations: { id: string; invoiceId: string; invoiceNo: string | null; kind: string; invoiceDate: string; amount: string; createdAt: string; releasedAt: string | null; releaseReason: string | null }[];
  history: AuditRow[];
}

export async function getPayment(ctx: Ctx, id: string): Promise<PaymentDetail> {
  assertCan(ctx.actor, "finance.view");
  const [head] = await ctx.db.query<Omit<PaymentDetail, "allocations" | "history">>(
    `select x.*, p.note, p.fx_rate as "fxRate", p.fx_date as "fxDate", p.fx_source as "fxSource", u.display_name as "createdByName", p.created_at as "createdAt",
       p.cancel_reason as "cancelReason", p.version
     from (${SELECT} where p.id = $1) x join payments p on p.id = x.id join app_users u on u.id = p.created_by`,
    [id],
  );
  if (!head) throw new NotFoundError("Ödeme bulunamadı.");
  const allocations = await ctx.db.query<PaymentDetail["allocations"][number]>(
    `select pa.id, i.id as "invoiceId", i.invoice_no as "invoiceNo", i.kind, i.invoice_date as "invoiceDate", pa.amount, pa.created_at as "createdAt",
       pa.released_at as "releasedAt", pa.release_reason as "releaseReason"
     from payment_allocations pa join invoices i on i.id = pa.invoice_id where pa.payment_id = $1 order by pa.created_at`,
    [id],
  );
  const history = await ctx.db.query<AuditRow>(`select ${AUDIT_COLS} from audit_log where entity = 'payment' and entity_id = $1 order by at desc, id desc`, [id]);
  return { ...head, allocations, history };
}
