import { orderText, packLabel, variantLabel } from "@/lib/catalog";
import { formatDate } from "@/lib/dates";
import { dec, documentTotals, excludeVat, formatPrice, formatQty, isPositive, qty as qtyStr, type Totals } from "@/lib/decimal";
import { CURRENCIES, ORDER_CHANNELS, ORDER_STATUSES } from "@/lib/labels";
import { matchesQuery } from "@/lib/normalize";
import { asBody, isUuid, Reader } from "@/lib/validate";
import { audit, AUDIT_COLS, diff, type AuditRow, type Changes } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { assertCan, can } from "../permissions";
import { getVariant } from "./catalog";
import { lockRow, nextNo } from "./common";
import { autoResolveShortages, closeBlockers, deliveryState, LINE_STATS } from "./order-state";
import { getRequestRow } from "./requests";

export interface OrderLine {
  id: string;
  lineNo: number;
  variantId: string;
  label: string;
  productName: string;
  brand: string | null;
  model: string | null;
  attributes: string | null;
  code: string | null;
  supplierCode: string | null;
  qty: string;
  unitLabel: string;
  packSize: string;
  baseUnit: string;
  orderUnit: string;
  packText: string;
  unitPrice: string | null;
  discountPct: string | null;
  vatRate: string | null;
  netAmount: string | null;
  vatAmount: string | null;
  canceledQty: string;
  accepted: string;
  rejected: string;
  held: string;
  physical: string;
  pending: string;
  invoicedQty: string | null;
  trackExpiry: boolean;
  trackLot: boolean;
  minShelfLifeDays: number | null;
  note: string | null;
  version: number;
  allocations: { requestId: string; requestNo: string; requesterName: string; qtyBase: string }[];
}

export interface OrderSummary {
  id: string;
  orderNo: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  status: string;
  expectedOn: string | null;
  receiverUserId: string | null;
  receiverName: string | null;
  placedAt: string | null;
  createdAt: string;
  lineCount: number;
  pendingLines: number;
  acceptedAny: boolean;
  openIssues: number;
  draftReceiptId: string | null;
  deliveryState: "bekleniyor" | "kismi" | "tamam" | "yok";
  overdue: boolean;
  total: string | null;
}

export interface Order extends Omit<OrderSummary, "total"> {
  supplierPhone: string | null;
  supplierEmail: string | null;
  note: string | null;
  supplierRef: string | null;
  shippingAmount: string | null;
  shippingVatRate: string | null;
  totals: Totals | null;
  placedByName: string | null;
  placedChannel: string | null;
  closedAt: string | null;
  closedByName: string | null;
  closeNote: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  createdByName: string;
  version: number;
  lines: OrderLine[];
  receipts: { id: string; receiptNo: string; status: string; receivedOn: string; postedAt: string | null; postedByName: string | null; startedByName: string; deliveryNoteNo: string | null }[];
  issues: { id: string; issueNo: string; type: string; status: string; action: string | null; qty: string | null; lineNo: number | null; description: string | null; reportedAt: string }[];
  closeBlockers: string[];
  history: AuditRow[];
  showPrices: boolean;
}

const LINE_SELECT = `select ol.id, ol.order_id as "orderId", ol.line_no as "lineNo", ol.variant_id as "variantId", p.name as "productName", v.brand, v.model,
    v.attributes, v.code, vs.supplier_code as "supplierCode", ol.qty, ol.unit_label as "unitLabel", ol.pack_size as "packSize",
    v.base_unit as "baseUnit", v.order_unit as "orderUnit", ol.unit_price as "unitPrice", ol.discount_pct as "discountPct",
    ol.vat_rate as "vatRate", ol.net_amount as "netAmount", ol.vat_amount as "vatAmount", ol.canceled_qty as "canceledQty",
    st.accepted, st.rejected, st.held, st.physical, (ol.qty - ol.canceled_qty - st.accepted) as pending,
    coalesce((select sum(il.qty) from invoice_lines il join invoices i on i.id = il.invoice_id
              where il.order_line_id = ol.id and i.canceled_at is null), 0) as "invoicedQty",
    v.track_expiry as "trackExpiry", v.track_lot as "trackLot", v.min_shelf_life_days as "minShelfLifeDays", ol.note, ol.version
  from order_lines ol join purchase_orders po on po.id = ol.order_id join variants v on v.id = ol.variant_id
  join products p on p.id = v.product_id
  left join variant_suppliers vs on vs.variant_id = ol.variant_id and vs.supplier_id = po.supplier_id
  ${LINE_STATS}`;

const SUMMARY_SELECT = `select po.id, po.order_no as "orderNo", po.supplier_id as "supplierId", s.name as "supplierName", po.currency, po.status,
    po.expected_on as "expectedOn", po.receiver_user_id as "receiverUserId", ru.display_name as "receiverName", po.placed_at as "placedAt",
    po.created_at as "createdAt",
    (select count(*) from order_lines where order_id = po.id) as "lineCount",
    (select count(*) from order_lines ol ${LINE_STATS} where ol.order_id = po.id and ol.qty - ol.canceled_qty - st.accepted > 0) as "pendingLines",
    exists(select 1 from receipt_lines rl join receipts rc on rc.id = rl.receipt_id join order_lines ol on ol.id = rl.order_line_id
           where ol.order_id = po.id and rc.status = 'kaydedildi' and rl.qty_accepted > 0) as "acceptedAny",
    (select count(*) from delivery_issues di where di.order_id = po.id and di.status = 'acik') as "openIssues",
    (select id from receipts where order_id = po.id and status = 'taslak') as "draftReceiptId",
    coalesce((select sum(net_amount + vat_amount) from order_lines where order_id = po.id), 0) + po.shipping_amount
      + round(po.shipping_amount * po.shipping_vat_rate / 100, 2) as total
  from purchase_orders po join suppliers s on s.id = po.supplier_id left join app_users ru on ru.id = po.receiver_user_id`;

type RawSummary = Omit<OrderSummary, "deliveryState" | "overdue">;

function summarize(r: RawSummary, today: string, showPrices: boolean): OrderSummary {
  const ds: OrderSummary["deliveryState"] =
    r.status === "taslak" || r.status === "iptal" ? "yok" : r.pendingLines === 0 ? "tamam" : r.acceptedAny ? "kismi" : "bekleniyor";
  return {
    ...r,
    total: showPrices ? r.total : null,
    deliveryState: ds,
    overdue: r.status === "verildi" && r.pendingLines > 0 && !!r.expectedOn && r.expectedOn < today,
  };
}

/** Teslimat sorumlusu (satın alma/finans rolü yoksa) yalnızca kendisine atanan siparişleri görür. */
function scopeWhere(ctx: Ctx, params: unknown[]): string | null {
  if (can(ctx.actor, "order.view")) return null;
  if (can(ctx.actor, "receipt.record")) {
    params.push(ctx.actor.userId);
    return `po.receiver_user_id = $${params.length} and po.status <> 'taslak'`;
  }
  throw new ForbiddenError("Siparişleri görme yetkiniz yok.");
}

export interface OrderFilters {
  view?: "taslak" | "bekleyen" | "geciken" | "kontrol" | "sorunlu" | "kapali" | "tumu";
  supplierId?: string | null;
  q?: string;
  from?: string | null;
  to?: string | null;
}

export async function listOrders(ctx: Ctx, f: OrderFilters = {}): Promise<OrderSummary[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  const scope = scopeWhere(ctx, params);
  if (scope) where.push(scope);
  if (f.supplierId && isUuid(f.supplierId)) {
    params.push(f.supplierId);
    where.push(`po.supplier_id = $${params.length}`);
  }
  if (f.from) {
    params.push(f.from);
    where.push(`coalesce((po.placed_at at time zone 'Europe/Istanbul')::date, (po.created_at at time zone 'Europe/Istanbul')::date) >= $${params.length}`);
  }
  if (f.to) {
    params.push(f.to);
    where.push(`coalesce((po.placed_at at time zone 'Europe/Istanbul')::date, (po.created_at at time zone 'Europe/Istanbul')::date) <= $${params.length}`);
  }
  const rows = (await ctx.db.query<RawSummary>(`${SUMMARY_SELECT} ${where.length ? `where ${where.join(" and ")}` : ""} order by po.created_at desc limit 1000`, params))
    .map((r) => summarize(r, ctx.today, can(ctx.actor, "price.view")));
  return rows.filter((o) => {
    switch (f.view) {
      case "taslak": if (o.status !== "taslak") return false; break;
      case "bekleyen": if (!(o.status === "verildi" && o.pendingLines > 0)) return false; break;
      case "geciken": if (!o.overdue) return false; break;
      case "kontrol": if (!o.draftReceiptId) return false; break;
      case "sorunlu": if (o.openIssues === 0) return false; break;
      case "kapali": if (!["kapandi", "iptal"].includes(o.status)) return false; break;
      default: break;
    }
    if (f.q && !matchesQuery(`${o.orderNo} ${o.supplierName} ${o.receiverName ?? ""}`, f.q)) return false;
    return true;
  });
}

async function loadLines(q: Queryable, orderId: string, showPrices: boolean): Promise<OrderLine[]> {
  const rows = await q.query<Omit<OrderLine, "label" | "packText" | "allocations">>(`${LINE_SELECT} where ol.order_id = $1 order by ol.line_no`, [orderId]);
  const allocs = await q.query<{ orderLineId: string; requestId: string; requestNo: string; requesterName: string; qtyBase: string }>(
    `select ra.order_line_id as "orderLineId", ra.request_id as "requestId", r.request_no as "requestNo", u.display_name as "requesterName", ra.qty_base as "qtyBase"
     from request_allocations ra join requests r on r.id = ra.request_id join app_users u on u.id = r.requested_by
     join order_lines ol on ol.id = ra.order_line_id where ol.order_id = $1 order by ra.created_at`,
    [orderId],
  );
  return rows.map((l) => ({
    ...l,
    label: variantLabel(l),
    packText: packLabel({ orderUnit: l.unitLabel, baseUnit: l.baseUnit, packSize: l.packSize }),
    unitPrice: showPrices ? l.unitPrice : null,
    discountPct: showPrices ? l.discountPct : null,
    vatRate: showPrices ? l.vatRate : null,
    netAmount: showPrices ? l.netAmount : null,
    vatAmount: showPrices ? l.vatAmount : null,
    invoicedQty: showPrices ? l.invoicedQty : null,
    allocations: allocs.filter((a) => a.orderLineId === l.id),
  }));
}

export async function getOrder(ctx: Ctx, id: string, qx?: Queryable): Promise<Order> {
  const q = qx ?? ctx.db;
  const params: unknown[] = [id];
  const scope = scopeWhere(ctx, params);
  const showPrices = can(ctx.actor, "price.view");
  const [raw] = await q.query<RawSummary & Record<string, unknown>>(
    `select x.*, po.note, po.supplier_ref as "supplierRef", po.shipping_amount as "shippingAmount", po.shipping_vat_rate as "shippingVatRate",
       pb.display_name as "placedByName", po.placed_channel as "placedChannel", po.closed_at as "closedAt", cb.display_name as "closedByName",
       po.close_note as "closeNote", po.canceled_at as "canceledAt", po.cancel_reason as "cancelReason", crb.display_name as "createdByName",
       po.version, s.phone as "supplierPhone", s.email as "supplierEmail"
     from (${SUMMARY_SELECT} where po.id = $1 ${scope ? `and ${scope}` : ""}) x
     join purchase_orders po on po.id = x.id join suppliers s on s.id = po.supplier_id
     left join app_users pb on pb.id = po.placed_by left join app_users cb on cb.id = po.closed_by join app_users crb on crb.id = po.created_by`,
    params,
  );
  if (!raw) throw new NotFoundError("Sipariş bulunamadı (veya size atanmış değil).");
  const sum = summarize(raw, ctx.today, showPrices);
  const lines = await loadLines(q, id, showPrices);
  const receipts = await q.query<Order["receipts"][number]>(
    `select r.id, r.receipt_no as "receiptNo", r.status, r.received_on as "receivedOn", r.posted_at as "postedAt", pb.display_name as "postedByName",
       sb.display_name as "startedByName", r.delivery_note_no as "deliveryNoteNo"
     from receipts r join app_users sb on sb.id = r.started_by left join app_users pb on pb.id = r.posted_by where r.order_id = $1 order by r.started_at`,
    [id],
  );
  const issues = await q.query<Order["issues"][number]>(
    `select di.id, di.issue_no as "issueNo", di.type, di.status, di.action, di.qty, ol.line_no as "lineNo", di.description, di.reported_at as "reportedAt"
     from delivery_issues di left join order_lines ol on ol.id = di.order_line_id where di.order_id = $1 order by di.reported_at`,
    [id],
  );
  const history = can(ctx.actor, "order.view")
    ? await q.query<AuditRow>(`select ${AUDIT_COLS} from audit_log where order_id = $1 and visibility = 'genel' order by at desc, id desc limit 300`, [id])
    : [];
  const shipping = { amount: raw.shippingAmount as string, vatRate: raw.shippingVatRate as string };
  return {
    ...(sum as Omit<OrderSummary, "total">),
    supplierPhone: raw.supplierPhone as string | null,
    supplierEmail: raw.supplierEmail as string | null,
    note: raw.note as string | null,
    supplierRef: raw.supplierRef as string | null,
    shippingAmount: showPrices ? shipping.amount : null,
    shippingVatRate: showPrices ? shipping.vatRate : null,
    totals: showPrices ? documentTotals(lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice!, discountPct: l.discountPct!, vatRate: l.vatRate! })), shipping) : null,
    placedByName: raw.placedByName as string | null,
    placedChannel: raw.placedChannel as string | null,
    closedAt: raw.closedAt as string | null,
    closedByName: raw.closedByName as string | null,
    closeNote: raw.closeNote as string | null,
    canceledAt: raw.canceledAt as string | null,
    cancelReason: raw.cancelReason as string | null,
    createdByName: raw.createdByName as string,
    version: raw.version as number,
    deliveryState: deliveryState(sum.status, lines),
    lines,
    receipts,
    issues,
    closeBlockers: sum.status === "verildi" ? await closeBlockers(q, id) : [],
    history,
    showPrices,
  };
}

// ---------------------------------------------------------------------------
// Oluşturma ve düzenleme
// ---------------------------------------------------------------------------

const CHANNELS = ORDER_CHANNELS.values;

async function assertReceiver(q: Queryable, userId: string) {
  const [u] = await q.query<{ ok: boolean }>(`select (active and roles && array['teslimat','satinalma']) as ok from app_users where id = $1`, [userId]);
  if (!u?.ok) throw new ValidationError({ receiverUserId: "Teslim alacak kişi teslimat sorumlusu veya satın alma rolünde, aktif bir kullanıcı olmalı." });
}

export async function createOrder(ctx: Ctx, input: unknown, qx?: Queryable): Promise<{ id: string; orderNo: string }> {
  assertCan(ctx.actor, "order.manage");
  const r = new Reader(asBody(input));
  const supplierId = r.id("supplierId", "Tedarikçi");
  const currencyIn = r.optOneOf("currency", "Para birimi", CURRENCIES.values);
  const expectedOn = r.optDate("expectedOn", "Beklenen teslim tarihi");
  const receiverUserId = r.optId("receiverUserId", "Teslim alacak kişi");
  const note = r.optText("note", "Sipariş notu", { multiline: true, max: 1000 });
  if (!r.ok) throw new ValidationError(r.errors);
  const run = async (q: Queryable) => {
    const [s] = await q.query<{ name: string; currency: string; active: boolean }>(`select name, currency, active from suppliers where id = $1`, [supplierId]);
    if (!s || !s.active) throw new ValidationError({ supplierId: "Tedarikçi bulunamadı veya pasif." });
    if (receiverUserId) await assertReceiver(q, receiverUserId);
    const orderNo = await nextNo(q, "SA", ctx.today);
    const [row] = await q.query<{ id: string }>(
      `insert into purchase_orders (order_no, supplier_id, currency, expected_on, receiver_user_id, note, created_by)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [orderNo, supplierId, currencyIn ?? s.currency, expectedOn, receiverUserId, note, ctx.actor.userId],
    );
    await audit(q, ctx, { entity: "order", entityId: row!.id, orderId: row!.id, supplierId, action: "create", summary: `Sipariş taslağı ${orderNo} açıldı (${s.name})` });
    return { id: row!.id, orderNo };
  };
  return qx ? run(qx) : ctx.db.tx(run);
}

interface OrderRow {
  id: string;
  order_no: string;
  status: string;
  supplier_id: string;
  currency: string;
  version: number;
  expected_on: string | null;
  receiver_user_id: string | null;
}

const lockOrder = (q: Queryable, id: string) =>
  lockRow<OrderRow>(q, "purchase_orders", id, "id, order_no, status, supplier_id, currency, version, expected_on, receiver_user_id");

/** Sipariş verildikten sonra yapılan her değişiklik gerekçeyle ve eski/yeni değerleriyle geçmişe yazılır. */
function changeReason(r: Reader, status: string): string | null {
  const reason = r.optText("changeReason", "Değişiklik gerekçesi", { max: 500 });
  if (status === "verildi" && !reason) r.error("changeReason", "Sipariş verildikten sonraki değişikliklerde gerekçe zorunludur (tedarikçiyle konuşuldu mu?).");
  return reason;
}

export async function updateOrder(ctx: Ctx, id: string, input: unknown): Promise<Order> {
  assertCan(ctx.actor, "order.manage");
  const r = new Reader(asBody(input));
  const version = r.version();
  const expectedOn = r.optDate("expectedOn", "Beklenen teslim tarihi");
  const receiverUserId = r.optId("receiverUserId", "Teslim alacak kişi");
  const note = r.optText("note", "Sipariş notu", { multiline: true, max: 1000 });
  const supplierRef = r.optText("supplierRef", "Tedarikçi referansı", { max: 120 });
  const shippingAmount = r.optDecimal("shippingAmount", "Kargo", { min: "0" }) ?? "0.00";
  const shippingVatRate = r.optDecimal("shippingVatRate", "Kargo KDV oranı", { min: "0", max: "100" }) ?? "20.00";
  await ctx.db.tx(async (q) => {
    const cur = await lockOrder(q, id);
    const reason = changeReason(r, cur.status);
    if (!r.ok) throw new ValidationError(r.errors);
    if (cur.version !== version) throw new VersionConflictError();
    if (!["taslak", "verildi"].includes(cur.status)) throw new ConflictError("closed", "Kapanmış veya iptal edilmiş sipariş değiştirilemez.");
    if (receiverUserId) await assertReceiver(q, receiverUserId);
    const before = await q.query<Record<string, unknown>>(
      `select po.expected_on as "expectedOn", ru.display_name as "receiver", po.note, po.supplier_ref as "supplierRef",
         po.shipping_amount as "shippingAmount", po.shipping_vat_rate as "shippingVatRate"
       from purchase_orders po left join app_users ru on ru.id = po.receiver_user_id where po.id = $1`,
      [id],
    );
    await q.query(
      `update purchase_orders set expected_on = $2, receiver_user_id = $3, note = $4, supplier_ref = $5, shipping_amount = $6, shipping_vat_rate = $7,
         version = version + 1, updated_at = now(), updated_by = $8 where id = $1`,
      [id, expectedOn, receiverUserId, note, supplierRef, shippingAmount, shippingVatRate, ctx.actor.userId],
    );
    const [rec] = receiverUserId ? await q.query<{ n: string }>(`select display_name as n from app_users where id = $1`, [receiverUserId]) : [];
    const changes = diff(before[0]!, { expectedOn, receiver: rec?.n ?? null, note, supplierRef, shippingAmount, shippingVatRate }, {
      expectedOn: "Beklenen teslim", receiver: "Teslim alacak kişi", note: "Not", supplierRef: "Tedarikçi referansı", shippingAmount: "Kargo", shippingVatRate: "Kargo KDV %",
    });
    if (Object.keys(changes).length) {
      await audit(q, ctx, { entity: "order", entityId: id, orderId: id, supplierId: cur.supplier_id, action: "update", summary: `Sipariş ${cur.order_no} güncellendi${reason ? ` – gerekçe: ${reason}` : ""}`, changes });
    }
  });
  return getOrder(ctx, id);
}

interface LineInput {
  variantId: string;
  qty: string;
  unitPrice: string;
  discountPct: string;
  vatRate: string | null;
  note: string | null;
  allocations: { requestId: string; qtyBase: string }[];
}

function readLine(r: Reader, opts: { needVariant: boolean }): LineInput {
  const variantId = opts.needVariant ? r.id("variantId", "Ürün") : "";
  const qty = r.decimal("qty", "Miktar", { scale: 3, positive: true, max: "100000" });
  const vatRate = r.optDecimal("vatRate", "KDV oranı", { min: "0", max: "100" });
  const price = r.decimal("unitPrice", "Birim fiyat", { scale: 4, min: "0" });
  const inclVat = r.bool("priceIncludesVat");
  if (inclVat && vatRate === null) r.error("vatRate", "KDV dahil fiyat girildiyse KDV oranı seçilmelidir.");
  const unitPrice = inclVat && vatRate !== null ? excludeVat(price, vatRate) : price;
  const discountPct = r.optDecimal("discountPct", "İskonto %", { min: "0", max: "100" }) ?? "0.00";
  const note = r.optText("note", "Kalem notu", { max: 300 });
  const allocations = r.list("allocations", "Bağlanan talepler", { max: 50 }).map((a) => ({
    requestId: a.id("requestId", "Talep"),
    qtyBase: a.decimal("qtyBase", "Karşılanacak miktar", { scale: 3, positive: true }),
  }));
  return { variantId, qty, unitPrice, discountPct, vatRate, note, allocations };
}

/**
 * Talebi sipariş kalemine bağlar. Bir talep birden fazla kaleme (tedarikçiye) bölünebilir; bir kalem birden fazla talebi karşılayabilir.
 * Bağlanan miktar talebin henüz bağlanmamış ihtiyacını ve kalemin kapasitesini aşamaz. Değerlendirme bekleyen talep böylece onaylanmış olur.
 */
async function allocate(q: Queryable, ctx: Ctx, line: { id: string; variant_id: string; qty: string; canceled_qty: string; pack_size: string; order_id: string }, list: LineInput["allocations"]) {
  for (const a of list) {
    await lockRow(q, "requests", a.requestId, "id");
    const req = await getRequestRow(q, a.requestId);
    if (!req) throw new ValidationError({ allocations: "Talep bulunamadı." });
    if (!["beklemede", "onaylandi"].includes(req.status)) throw new ValidationError({ allocations: `Talep ${req.requestNo} kapanmış (reddedilmiş/iptal).` });
    if (req.variantId !== line.variant_id) throw new ValidationError({ allocations: `Talep ${req.requestNo} başka bir ürün için (${req.label}).` });
    const free = dec(req.needBase).minus(dec(req.allocBase));
    if (dec(a.qtyBase).gt(free)) {
      throw new ValidationError({ allocations: `Talep ${req.requestNo}: en fazla ${formatQty(free.isNegative() ? 0 : free)} ${req.baseUnit} bağlanabilir (geri kalanı başka siparişte).` });
    }
    const [{ used }] = (await q.query<{ used: string }>(`select coalesce(sum(qty_base), 0) as used from request_allocations where order_line_id = $1`, [line.id])) as [{ used: string }];
    const cap = dec(line.qty).minus(dec(line.canceled_qty)).mul(dec(line.pack_size));
    if (dec(used).plus(dec(a.qtyBase)).gt(cap)) {
      throw new ValidationError({ allocations: `Kalemin miktarı bağlanan taleplere yetmiyor (kalem: ${formatQty(cap)} ${req.baseUnit}).` });
    }
    await q.query(
      `insert into request_allocations (request_id, order_line_id, qty_base, created_by) values ($1, $2, $3, $4)
       on conflict (request_id, order_line_id) do update set qty_base = request_allocations.qty_base + excluded.qty_base`,
      [a.requestId, line.id, a.qtyBase, ctx.actor.userId],
    );
    if (req.status === "beklemede") {
      await q.query(`update requests set status = 'onaylandi', decided_by = $2, decided_at = now(), decision_note = coalesce(decision_note, 'Siparişe eklenerek onaylandı.'), version = version + 1, updated_at = now() where id = $1`, [
        a.requestId, ctx.actor.userId,
      ]);
    }
    await audit(q, ctx, { entity: "request", entityId: a.requestId, orderId: line.order_id, action: "allocate", summary: `Talep ${req.requestNo} siparişe bağlandı: ${formatQty(a.qtyBase)} ${req.baseUnit}` });
  }
}

export async function addLine(ctx: Ctx, orderId: string, input: unknown, qx?: Queryable): Promise<{ lineId: string }> {
  assertCan(ctx.actor, "order.manage");
  const r = new Reader(asBody(input));
  const l = readLine(r, { needVariant: true });
  const run = async (q: Queryable) => {
    const order = await lockOrder(q, orderId);
    const reason = changeReason(r, order.status);
    if (!r.ok) throw new ValidationError(r.errors);
    if (!["taslak", "verildi"].includes(order.status)) throw new ConflictError("closed", "Kapanmış veya iptal edilmiş siparişe kalem eklenemez.");
    const v = await getVariant(q, l.variantId);
    if (!v || !v.active) throw new ValidationError({ variantId: "Ürün bulunamadı veya pasif." });
    const vatRate = l.vatRate ?? v.defaultVatRate;
    const [{ n }] = (await q.query<{ n: number }>(`select coalesce(max(line_no), 0) + 1 as n from order_lines where order_id = $1`, [orderId])) as [{ n: number }];
    const [line] = await q.query<{ id: string; variant_id: string; qty: string; canceled_qty: string; pack_size: string; order_id: string }>(
      `insert into order_lines (order_id, line_no, variant_id, qty, unit_label, pack_size, unit_price, discount_pct, vat_rate, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id, variant_id, qty, canceled_qty, pack_size, order_id`,
      [orderId, n, v.id, l.qty, v.orderUnit, v.packSize, l.unitPrice, l.discountPct, vatRate, l.note],
    );
    await allocate(q, ctx, line!, l.allocations);
    await audit(q, ctx, {
      entity: "order", entityId: orderId, orderId, supplierId: order.supplier_id, action: "add_line",
      summary: `Sipariş ${order.order_no}: kalem eklendi – ${v.label}, ${formatQty(l.qty)} ${v.orderUnit} × ${formatPrice(l.unitPrice, order.currency)} (KDV hariç)${reason ? ` – gerekçe: ${reason}` : ""}`,
    });
    await q.query(`update purchase_orders set version = version + 1, updated_at = now(), updated_by = $2 where id = $1`, [orderId, ctx.actor.userId]);
    return { lineId: line!.id };
  };
  return qx ? run(qx) : ctx.db.tx(run);
}

/**
 * Planlama ekranından: seçilen talepleri bir tedarikçinin sipariş taslağına ekler. O tedarikçinin açık taslağı varsa ona eklenir,
 * yoksa yeni taslak açılır. Tedarikçiyi ve fiyatı yönetim seçer (sistem en ucuzu otomatik seçmez).
 */
export async function planToOrder(ctx: Ctx, input: unknown): Promise<{ orderId: string; lineId: string }> {
  assertCan(ctx.actor, "order.manage");
  const body = asBody(input);
  const r = new Reader(body);
  const supplierId = r.id("supplierId", "Tedarikçi");
  const orderIdIn = r.optId("orderId", "Sipariş taslağı");
  if (!r.ok) throw new ValidationError(r.errors);
  return ctx.db.tx(async (q) => {
    let orderId = orderIdIn;
    if (orderId) {
      const o = await lockOrder(q, orderId);
      if (o.status !== "taslak" || o.supplier_id !== supplierId) throw new ValidationError({ orderId: "Seçilen sipariş bu tedarikçinin taslağı değil." });
    } else {
      const [s] = await q.query<{ currency: string }>(`select currency from suppliers where id = $1`, [supplierId]);
      const [draft] = await q.query<{ id: string }>(
        `select id from purchase_orders where supplier_id = $1 and status = 'taslak' and currency = $2 order by created_at desc limit 1`,
        [supplierId, s?.currency ?? "TRY"],
      );
      orderId = draft?.id ?? (await createOrder(ctx, { supplierId }, q)).id;
    }
    const { lineId } = await addLine(ctx, orderId, body, q);
    return { orderId, lineId };
  });
}

/** Mevcut bir sipariş kalemine (taslak veya verilmiş) talep bağlar: ör. talep, zaten verilmiş fazla siparişle karşılanacaksa. */
export async function linkRequest(ctx: Ctx, input: unknown): Promise<void> {
  assertCan(ctx.actor, "order.manage");
  const r = new Reader(asBody(input));
  const orderLineId = r.id("orderLineId", "Sipariş kalemi");
  const requestId = r.id("requestId", "Talep");
  const qtyBase = r.decimal("qtyBase", "Karşılanacak miktar", { scale: 3, positive: true });
  if (!r.ok) throw new ValidationError(r.errors);
  await ctx.db.tx(async (q) => {
    const [line] = await q.query<{ id: string; variant_id: string; qty: string; canceled_qty: string; pack_size: string; order_id: string }>(
      `select id, variant_id, qty, canceled_qty, pack_size, order_id from order_lines where id = $1`,
      [orderLineId],
    );
    if (!line) throw new NotFoundError("Sipariş kalemi bulunamadı.");
    const o = await lockOrder(q, line.order_id);
    if (!["taslak", "verildi"].includes(o.status)) throw new ConflictError("closed", "Kapanmış veya iptal edilmiş siparişe talep bağlanamaz.");
    await allocate(q, ctx, line, [{ requestId, qtyBase }]);
  });
}

export async function unlinkRequest(ctx: Ctx, input: unknown): Promise<void> {
  assertCan(ctx.actor, "order.manage");
  const r = new Reader(asBody(input));
  const orderLineId = r.id("orderLineId", "Sipariş kalemi");
  const requestId = r.id("requestId", "Talep");
  if (!r.ok) throw new ValidationError(r.errors);
  await ctx.db.tx(async (q) => {
    const [line] = await q.query<{ order_id: string }>(`select order_id from order_lines where id = $1`, [orderLineId]);
    if (!line) throw new NotFoundError("Sipariş kalemi bulunamadı.");
    const o = await lockOrder(q, line.order_id);
    if (o.status === "kapandi") throw new ConflictError("closed", "Kapanmış siparişte talep bağlantısı değiştirilemez.");
    const rows = await q.query<{ request_no: string }>(
      `delete from request_allocations ra using requests r where r.id = ra.request_id and ra.request_id = $1 and ra.order_line_id = $2 returning r.request_no`,
      [requestId, orderLineId],
    );
    if (!rows.length) throw new NotFoundError("Bağlantı bulunamadı.");
    await audit(q, ctx, { entity: "request", entityId: requestId, orderId: line.order_id, action: "unlink", summary: `Talep ${rows[0]!.request_no} sipariş ${o.order_no} kaleminden ayrıldı` });
  });
}

export async function updateLine(ctx: Ctx, lineId: string, input: unknown): Promise<Order> {
  assertCan(ctx.actor, "order.manage");
  const r = new Reader(asBody(input));
  const version = r.version();
  const l = readLine(r, { needVariant: false });
  const orderId = await ctx.db.tx(async (q) => {
    const [cur] = await q.query<{ order_id: string; version: number; qty: string; canceled_qty: string; pack_size: string; unit_price: string; discount_pct: string; vat_rate: string; note: string | null; line_no: number; unit_label: string }>(
      `select order_id, version, qty, canceled_qty, pack_size, unit_price, discount_pct, vat_rate, note, line_no, unit_label from order_lines where id = $1`,
      [lineId],
    );
    if (!cur) throw new NotFoundError("Sipariş kalemi bulunamadı.");
    const order = await lockOrder(q, cur.order_id);
    const reason = changeReason(r, order.status);
    if (!r.ok) throw new ValidationError(r.errors);
    if (!["taslak", "verildi"].includes(order.status)) throw new ConflictError("closed", "Kapanmış veya iptal edilmiş sipariş değiştirilemez.");
    if (cur.version !== version) throw new VersionConflictError();
    const [st] = await q.query<{ accepted: string; held: string }>(`select st.accepted, st.held from order_lines ol ${LINE_STATS} where ol.id = $1`, [lineId]);
    const floor = dec(st!.accepted).plus(dec(st!.held)).plus(dec(cur.canceled_qty));
    if (dec(l.qty).lt(floor)) {
      throw new ValidationError({ qty: `Miktar, teslim alınan + incelemede + iptal edilen toplamından (${formatQty(floor)} ${cur.unit_label}) az olamaz.` });
    }
    const [{ used }] = (await q.query<{ used: string }>(`select coalesce(sum(qty_base), 0) as used from request_allocations where order_line_id = $1`, [lineId])) as [{ used: string }];
    if (dec(used).gt(dec(l.qty).minus(dec(cur.canceled_qty)).mul(dec(cur.pack_size)))) {
      throw new ValidationError({ qty: "Bu kaleme bağlı taleplerin toplamı yeni miktardan fazla; önce talep bağlantısını azaltın." });
    }
    const vatRate = l.vatRate ?? cur.vat_rate;
    await q.query(
      `update order_lines set qty = $2, unit_price = $3, discount_pct = $4, vat_rate = $5, note = $6, version = version + 1, updated_at = now() where id = $1`,
      [lineId, l.qty, l.unitPrice, l.discountPct, vatRate, l.note],
    );
    const changes: Changes = diff(
      { qty: qtyStr(cur.qty), unitPrice: dec(cur.unit_price).toFixed(4), discountPct: dec(cur.discount_pct).toFixed(2), vatRate: dec(cur.vat_rate).toFixed(2), note: cur.note },
      { qty: qtyStr(l.qty), unitPrice: dec(l.unitPrice).toFixed(4), discountPct: dec(l.discountPct).toFixed(2), vatRate: dec(vatRate).toFixed(2), note: l.note },
      { qty: "Miktar", unitPrice: "Birim fiyat (KDV hariç)", discountPct: "İskonto %", vatRate: "KDV %", note: "Not" },
    );
    if (Object.keys(changes).length) {
      await audit(q, ctx, { entity: "order", entityId: order.id, orderId: order.id, supplierId: order.supplier_id, action: "update_line", summary: `Sipariş ${order.order_no}: ${cur.line_no}. kalem değiştirildi${reason ? ` – gerekçe: ${reason}` : ""}`, changes });
      await q.query(`update purchase_orders set version = version + 1, updated_at = now(), updated_by = $2 where id = $1`, [order.id, ctx.actor.userId]);
    }
    return order.id;
  });
  return getOrder(ctx, orderId);
}

/** Yalnızca taslak siparişten kalem silinir. Verilmiş siparişte "kalan miktarı iptal et" kullanılır (geçmiş kaybolmaz). */
export async function removeLine(ctx: Ctx, lineId: string): Promise<void> {
  assertCan(ctx.actor, "order.manage");
  await ctx.db.tx(async (q) => {
    const [cur] = await q.query<{ order_id: string; line_no: number }>(`select order_id, line_no from order_lines where id = $1`, [lineId]);
    if (!cur) throw new NotFoundError("Sipariş kalemi bulunamadı.");
    const order = await lockOrder(q, cur.order_id);
    if (order.status !== "taslak") throw new ConflictError("placed", "Verilmiş siparişten kalem silinmez; gelmeyecek miktar için “Kalan miktarı iptal et” kullanın.");
    await q.query(`delete from order_lines where id = $1`, [lineId]);
    await audit(q, ctx, { entity: "order", entityId: order.id, orderId: order.id, action: "remove_line", summary: `Sipariş taslağı ${order.order_no}: ${cur.line_no}. kalem silindi` });
  });
}

/** "Verildi": kullanıcı, tarih ve sipariş kanalı kaydedilir. Uygulama tedarikçiye mesaj GÖNDERMEZ (metin kopyalanır). */
export async function placeOrder(ctx: Ctx, id: string, input: unknown): Promise<Order> {
  assertCan(ctx.actor, "order.manage");
  const r = new Reader(asBody(input));
  const version = r.version();
  const channel = r.oneOf("channel", "Sipariş kanalı", CHANNELS);
  const expectedIn = r.optDate("expectedOn", "Beklenen teslim tarihi");
  const receiverIn = r.optId("receiverUserId", "Teslim alacak kişi");
  const supplierRef = r.optText("supplierRef", "Tedarikçi referansı", { max: 120 });
  if (!r.ok) throw new ValidationError(r.errors);
  await ctx.db.tx(async (q) => {
    const o = await lockOrder(q, id);
    if (o.version !== version) throw new VersionConflictError();
    if (o.status !== "taslak") throw new ConflictError("placed", "Bu sipariş zaten verilmiş veya kapanmış.");
    const expectedOn = expectedIn ?? o.expected_on;
    const receiver = receiverIn ?? o.receiver_user_id;
    const errors: Record<string, string> = {};
    if (!expectedOn) errors.expectedOn = "Beklenen teslim tarihi girilmeli (geciken teslimatlar buna göre izlenir).";
    else if (expectedOn < ctx.today) errors.expectedOn = "Beklenen teslim tarihi geçmiş bir gün olamaz.";
    if (!receiver) errors.receiverUserId = "Teslim alacak sorumlu kişi seçilmeli.";
    if (Object.keys(errors).length) throw new ValidationError(errors);
    await assertReceiver(q, receiver!);
    const [{ n }] = (await q.query<{ n: number }>(`select count(*) as n from order_lines where order_id = $1`, [id])) as [{ n: number }];
    if (n === 0) throw new ConflictError("empty", "Siparişte kalem yok.");
    await q.query(
      `update purchase_orders set status = 'verildi', placed_at = now(), placed_by = $2, placed_channel = $3, expected_on = $4, receiver_user_id = $5,
         supplier_ref = coalesce($6, supplier_ref), version = version + 1, updated_at = now(), updated_by = $2 where id = $1`,
      [id, ctx.actor.userId, channel, expectedOn, receiver, supplierRef],
    );
    await audit(q, ctx, {
      entity: "order", entityId: id, orderId: id, supplierId: o.supplier_id, action: "place",
      summary: `Sipariş ${o.order_no} verildi (${ORDER_CHANNELS.label(channel)}), beklenen teslim ${formatDate(expectedOn)}`,
      changes: { status: { label: "Durum", from: ORDER_STATUSES.label("taslak"), to: ORDER_STATUSES.label("verildi") } },
    });
  });
  return getOrder(ctx, id);
}

/** Hiç teslimat kaydı olmayan sipariş gerekçeyle iptal edilir. Bağlı talepler yeniden siparişe eklenmeyi bekler. */
export async function cancelOrder(ctx: Ctx, id: string, input: unknown): Promise<Order> {
  assertCan(ctx.actor, "order.manage");
  const r = new Reader(asBody(input));
  const version = r.version();
  const reason = r.text("reason", "İptal gerekçesi", { max: 500 });
  if (!r.ok) throw new ValidationError(r.errors);
  await ctx.db.tx(async (q) => {
    const o = await lockOrder(q, id);
    if (o.version !== version) throw new VersionConflictError();
    if (!["taslak", "verildi"].includes(o.status)) throw new ConflictError("closed", "Bu sipariş zaten kapanmış veya iptal edilmiş.");
    if ((await q.query(`select 1 from receipts where order_id = $1 and status <> 'iptal'`, [id])).length) {
      throw new ConflictError("has_receipts", "Teslimat kaydı olan sipariş iptal edilemez; gelmeyecek miktar için “Kalan miktarı iptal et”, sonra “Siparişi kapat” kullanın.");
    }
    await q.query(`update purchase_orders set status = 'iptal', canceled_at = now(), canceled_by = $2, cancel_reason = $3, version = version + 1, updated_at = now() where id = $1`, [
      id, ctx.actor.userId, reason,
    ]);
    await audit(q, ctx, { entity: "order", entityId: id, orderId: id, supplierId: o.supplier_id, action: "cancel", summary: `Sipariş ${o.order_no} iptal edildi: ${reason}` });
  });
  return getOrder(ctx, id);
}

/**
 * Gelmeyecek kalan miktarı gerekçeyle iptal eder (kalemin tamamı ya da seçilen kalemler). İptal edilen miktar kabul edilmiş
 * SAYILMAZ; ayrıca gösterilir. Bu kalemlerdeki açık "eksik teslimat" sorunları "kalan iptal edildi" olarak kapanır.
 */
export async function cancelRemaining(ctx: Ctx, id: string, input: unknown, qx?: Queryable): Promise<void> {
  assertCan(ctx.actor, "order.manage");
  const r = new Reader(asBody(input));
  const reason = r.text("reason", "İptal gerekçesi", { max: 500 });
  const lineIds = r.ids("lineIds", "Kalemler");
  const limitQty = r.optDecimal("qty", "İptal edilecek miktar", { scale: 3, positive: true });
  if (!r.ok) throw new ValidationError(r.errors);
  const run = async (q: Queryable) => {
    const o = await lockOrder(q, id);
    if (o.status !== "verildi") throw new ConflictError("not_placed", "Yalnızca verilmiş (açık) siparişte kalan miktar iptal edilir.");
    const lines = await q.query<{ id: string; line_no: number; unit_label: string; pending: string; held: string; canceled_qty: string }>(
      `select ol.id, ol.line_no, ol.unit_label, (ol.qty - ol.canceled_qty - st.accepted) as pending, st.held, ol.canceled_qty
       from order_lines ol ${LINE_STATS} where ol.order_id = $1 order by ol.line_no`,
      [id],
    );
    const targets = lines.filter((l) => (!lineIds.length || lineIds.includes(l.id)) && isPositive(dec(l.pending).minus(dec(l.held))));
    if (!targets.length) throw new ConflictError("nothing", "İptal edilecek bekleyen miktar yok (incelemedeki ürünler önce karara bağlanmalı).");
    const changes: Changes = {};
    for (const l of targets) {
      const cancellable = dec(l.pending).minus(dec(l.held));
      const amount = limitQty && dec(limitQty).lt(cancellable) ? dec(limitQty) : cancellable;
      await q.query(`update order_lines set canceled_qty = canceled_qty + $2, version = version + 1, updated_at = now() where id = $1`, [l.id, amount.toFixed(3)]);
      changes[`line${l.line_no}`] = { label: `${l.line_no}. kalem iptal edilen`, from: formatQty(l.canceled_qty), to: formatQty(dec(l.canceled_qty).plus(amount)) };
    }
    const now = await lineStatesAfter(q, id);
    await q.query(
      `update delivery_issues set status = 'cozuldu', action = 'iptal', resolved_by = $3, resolved_at = now(), resolution_note = $4, version = version + 1, updated_at = now()
       where order_id = $1 and type = 'eksik' and status = 'acik' and order_line_id = any($2)`,
      [id, now.filter((l) => !isPositive(l.pending)).map((l) => l.id), ctx.actor.userId, `Kalan miktar iptal edildi: ${reason}`],
    );
    await audit(q, ctx, { entity: "order", entityId: id, orderId: id, supplierId: o.supplier_id, action: "cancel_remaining", summary: `Sipariş ${o.order_no}: kalan miktar iptal edildi – gerekçe: ${reason}`, changes });
    await q.query(`update purchase_orders set version = version + 1, updated_at = now(), updated_by = $2 where id = $1`, [id, ctx.actor.userId]);
  };
  if (qx) await run(qx);
  else await ctx.db.tx(run);
}

async function lineStatesAfter(q: Queryable, orderId: string) {
  return q.query<{ id: string; pending: string }>(`select ol.id, (ol.qty - ol.canceled_qty - st.accepted) as pending from order_lines ol ${LINE_STATS} where ol.order_id = $1`, [orderId]);
}

/** Normal kapanış: bekleyen miktar, incelemedeki ürün, çözülmemiş sorun ve devam eden teslimat kontrolü yoksa. */
export async function closeOrder(ctx: Ctx, id: string, input: unknown): Promise<Order> {
  assertCan(ctx.actor, "order.manage");
  const r = new Reader(asBody(input));
  const version = r.version();
  const note = r.optText("note", "Kapanış notu", { max: 500 });
  if (!r.ok) throw new ValidationError(r.errors);
  await ctx.db.tx(async (q) => {
    const o = await lockOrder(q, id);
    if (o.version !== version) throw new VersionConflictError();
    if (o.status !== "verildi") throw new ConflictError("not_placed", "Yalnızca verilmiş (açık) sipariş kapatılabilir.");
    await autoResolveShortages(q, ctx, id);
    const blockers = await closeBlockers(q, id);
    if (blockers.length) throw new ConflictError("cannot_close", `Sipariş kapatılamaz: ${blockers.join(" ")}`, { blockers });
    await q.query(`update purchase_orders set status = 'kapandi', closed_at = now(), closed_by = $2, close_note = $3, version = version + 1, updated_at = now() where id = $1`, [
      id, ctx.actor.userId, note,
    ]);
    await audit(q, ctx, { entity: "order", entityId: id, orderId: id, supplierId: o.supplier_id, action: "close", summary: `Sipariş ${o.order_no} kapatıldı${note ? `: ${note}` : ""}` });
  });
  return getOrder(ctx, id);
}

/** Tedarikçiye gönderilecek kopyalanabilir sipariş metni. Fiyatlar yalnızca istenirse ve yetki varsa eklenir. */
export async function orderMessage(ctx: Ctx, id: string, withPrices: boolean): Promise<string> {
  const o = await getOrder(ctx, id);
  const prices = withPrices && o.showPrices;
  return orderText(
    {
      clinicName: ctx.actor.clinicName,
      orderNo: o.orderNo,
      supplierName: o.supplierName,
      expectedOn: o.expectedOn,
      note: o.note,
      lines: o.lines.map((l) => ({
        label: l.label, code: l.code, supplierCode: l.supplierCode, qty: dec(l.qty).minus(dec(l.canceledQty)).toFixed(3), unitLabel: l.unitLabel,
        packText: l.packText, unitPrice: prices ? l.unitPrice : null, discountPct: prices ? l.discountPct : null, currency: o.currency,
      })),
    },
    formatDate,
    prices ? formatPrice : undefined,
  );
}

