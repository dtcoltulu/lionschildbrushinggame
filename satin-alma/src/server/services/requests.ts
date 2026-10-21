import { variantLabel } from "@/lib/catalog";
import { cmp, dec, formatQty, isPositive, qty as qtyStr } from "@/lib/decimal";
import { REQUEST_PROGRESS, STOCK_STATES, UNITS, URGENCIES, type RequestProgress } from "@/lib/labels";
import { matchesQuery } from "@/lib/normalize";
import { asBody, Reader } from "@/lib/validate";
import { audit, AUDIT_COLS, type AuditRow } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { ConflictError, ForbiddenError, isUniqueViolation, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { assertCan, can } from "../permissions";
import { createVariant, getVariant } from "./catalog";
import { lockRow, nextNo } from "./common";

/**
 * Talebin ilerlemesi: ihtiyaç (temel birim), siparişe bağlanan, verilmiş siparişte olan ve kabul edilen miktarlar.
 * Bir sipariş kalemi birden fazla talebi karşılıyorsa kabul edilen miktar talepler arasında bağlanma sırasıyla dağıtılır.
 * İptal edilen sipariş ve gerekçeyle iptal edilen kalan miktar karşılanmış sayılmaz.
 */
export const REQUEST_PROGRESS_CTE = `
  req_need as (
    select r.id, case when r.unit_kind = 'siparis' then r.qty * v.pack_size else r.qty end as need_base
    from requests r left join variants v on v.id = r.variant_id
  ),
  line_acc as (
    select ol.id, po.status as order_status, (ol.qty - ol.canceled_qty) * ol.pack_size as cap_base,
      coalesce((select sum(rl.qty_accepted) from receipt_lines rl join receipts rc on rc.id = rl.receipt_id
                where rl.order_line_id = ol.id and rc.status = 'kaydedildi'), 0) * ol.pack_size as acc_base
    from order_lines ol join purchase_orders po on po.id = ol.order_id where po.status <> 'iptal'
  ),
  alloc as (
    select ra.request_id, ra.order_line_id, ra.qty_base,
      coalesce(sum(ra.qty_base) over (partition by ra.order_line_id order by ra.created_at, ra.id rows between unbounded preceding and 1 preceding), 0) as before_base
    from request_allocations ra
  ),
  req_prog as (
    select a.request_id,
      sum(greatest(0, least(a.qty_base, la.cap_base - a.before_base))) as alloc_base,
      sum(case when la.order_status in ('verildi', 'kapandi') then greatest(0, least(a.qty_base, la.cap_base - a.before_base)) else 0 end) as ordered_base,
      sum(greatest(0, least(a.qty_base, la.acc_base - a.before_base))) as recv_base
    from alloc a join line_acc la on la.id = a.order_line_id group by a.request_id
  )`;

export interface RequestRow {
  id: string;
  requestNo: string;
  variantId: string | null;
  label: string;
  productName: string | null;
  brand: string | null;
  model: string | null;
  attributes: string | null;
  tempProductText: string | null;
  stockState: string;
  qty: string;
  unitKind: "siparis" | "temel" | null;
  unitLabel: string;
  remainingQty: string | null;
  neededBy: string | null;
  urgency: string;
  locationId: string | null;
  locationName: string | null;
  note: string | null;
  extraNeedReason: string | null;
  status: string;
  decisionNote: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  requestedBy: string;
  requesterName: string;
  requestedAt: string;
  version: number;
  baseUnit: string | null;
  orderUnit: string | null;
  packSize: string | null;
  needBase: string;
  allocBase: string;
  orderedBase: string;
  recvBase: string;
  progress: RequestProgress;
  progressLabel: string;
}

const SELECT = `with ${REQUEST_PROGRESS_CTE}
  select r.id, r.request_no as "requestNo", r.variant_id as "variantId", p.name as "productName", v.brand, v.model, v.attributes,
    r.temp_product_text as "tempProductText", r.stock_state as "stockState", r.qty, r.unit_kind as "unitKind", r.unit_label as "unitLabel",
    r.remaining_qty as "remainingQty", r.needed_by as "neededBy", r.urgency, r.location_id as "locationId", l.name as "locationName",
    r.note, r.extra_need_reason as "extraNeedReason", r.status, r.decision_note as "decisionNote", d.display_name as "decidedByName",
    r.decided_at as "decidedAt", r.requested_by as "requestedBy", u.display_name as "requesterName", r.requested_at as "requestedAt",
    r.version, v.base_unit as "baseUnit", v.order_unit as "orderUnit", v.pack_size as "packSize",
    coalesce(n.need_base, 0) as "needBase", coalesce(pg.alloc_base, 0) as "allocBase", coalesce(pg.ordered_base, 0) as "orderedBase",
    coalesce(pg.recv_base, 0) as "recvBase"
  from requests r
  join app_users u on u.id = r.requested_by
  left join app_users d on d.id = r.decided_by
  left join variants v on v.id = r.variant_id
  left join products p on p.id = v.product_id
  left join locations l on l.id = r.location_id
  left join req_need n on n.id = r.id
  left join req_prog pg on pg.request_id = r.id`;

export function progressOf(r: Pick<RequestRow, "status" | "variantId" | "needBase" | "allocBase" | "orderedBase" | "recvBase">): RequestProgress {
  if (r.status === "reddedildi" || r.status === "iptal") return r.status;
  if (!r.variantId) return "eslestirme";
  if (cmp(r.recvBase, r.needBase) >= 0) return "teslim_alindi";
  if (isPositive(r.recvBase)) return "kismen_teslim";
  if (cmp(r.orderedBase, r.needBase) >= 0) return "sipariste";
  if (cmp(r.allocBase, r.needBase) >= 0) return "hazirlaniyor";
  if (isPositive(r.allocBase)) return "kismen_hazirlaniyor";
  if (r.status === "beklemede") return "degerlendirme";
  return "siparis_bekliyor";
}

type RawRequest = Omit<RequestRow, "label" | "progress" | "progressLabel">;

function finish(r: RawRequest): RequestRow {
  const progress = progressOf(r);
  const label = r.productName ? variantLabel({ productName: r.productName, brand: r.brand, model: r.model, attributes: r.attributes }) : `${r.tempProductText} (katalog dışı)`;
  return { ...r, label, progress, progressLabel: REQUEST_PROGRESS.label(progress) };
}

export const OPEN_PROGRESS: RequestProgress[] = ["degerlendirme", "eslestirme", "siparis_bekliyor", "kismen_hazirlaniyor", "hazirlaniyor", "sipariste", "kismen_teslim"];

export interface RequestFilters {
  view?: "acik" | "kapali" | "tumu" | "benim";
  progress?: RequestProgress;
  urgency?: string;
  q?: string;
  from?: string | null;
  to?: string | null;
}

/** Asistan yalnızca KENDİ taleplerini görür (sunucuda süzülür). */
export async function listRequests(ctx: Ctx, f: RequestFilters = {}): Promise<RequestRow[]> {
  assertCan(ctx.actor, "request.create");
  const params: unknown[] = [];
  const where: string[] = [];
  if (!can(ctx.actor, "request.viewAll") || f.view === "benim") {
    params.push(ctx.actor.userId);
    where.push(`r.requested_by = $${params.length}`);
  }
  if (f.urgency) {
    params.push(f.urgency);
    where.push(`r.urgency = $${params.length}`);
  }
  if (f.from) {
    params.push(f.from);
    where.push(`(r.requested_at at time zone 'Europe/Istanbul')::date >= $${params.length}`);
  }
  if (f.to) {
    params.push(f.to);
    where.push(`(r.requested_at at time zone 'Europe/Istanbul')::date <= $${params.length}`);
  }
  const rows = (await ctx.db.query<RawRequest>(`${SELECT} ${where.length ? `where ${where.join(" and ")}` : ""} order by r.requested_at desc limit 1000`, params)).map(finish);
  return rows.filter((r) => {
    if (f.progress && r.progress !== f.progress) return false;
    if (f.view === "acik" && !OPEN_PROGRESS.includes(r.progress)) return false;
    if (f.view === "kapali" && OPEN_PROGRESS.includes(r.progress)) return false;
    if (f.q) {
      if (!matchesQuery(`${r.requestNo} ${r.label} ${r.requesterName} ${r.locationName ?? ""} ${r.note ?? ""}`, f.q)) return false;
    }
    return true;
  });
}

async function getRequestRow(q: Queryable, id: string): Promise<RequestRow | null> {
  const [r] = await q.query<RawRequest>(`${SELECT} where r.id = $1`, [id]);
  return r ? finish(r) : null;
}

function assertCanSee(ctx: Ctx, r: RequestRow) {
  if (r.requestedBy !== ctx.actor.userId && !can(ctx.actor, "request.viewAll")) throw new ForbiddenError("Bu talep size ait değil.");
}

export interface OpenNeeds {
  requests: { id: string; requestNo: string; qty: string; unitLabel: string; progressLabel: string; requesterName: string; requestedAt: string; neededBy: string | null }[];
  orders: { orderId: string; orderNo: string; status: string; pendingQty: string; unitLabel: string; expectedOn: string | null; supplierName: string }[];
}

/** Aynı ürün için açık talepler ve teslimatı beklenen siparişler (mükerrer alımı önlemek için). */
export async function openNeeds(q: Queryable, variantId: string, opts: { excludeRequestId?: string; showSupplier?: boolean } = {}): Promise<OpenNeeds> {
  const reqs = (await q.query<RawRequest>(`${SELECT} where r.variant_id = $1 and r.status in ('beklemede', 'onaylandi') order by r.requested_at`, [variantId]))
    .map(finish)
    .filter((r) => r.id !== opts.excludeRequestId && OPEN_PROGRESS.includes(r.progress));
  const orders = await q.query<OpenNeeds["orders"][number]>(
    `select po.id as "orderId", po.order_no as "orderNo", po.status, po.expected_on as "expectedOn", s.name as "supplierName", ol.unit_label as "unitLabel",
       (ol.qty - ol.canceled_qty - coalesce((select sum(rl.qty_accepted) from receipt_lines rl join receipts rc on rc.id = rl.receipt_id
          where rl.order_line_id = ol.id and rc.status = 'kaydedildi'), 0)) as "pendingQty"
     from order_lines ol join purchase_orders po on po.id = ol.order_id join suppliers s on s.id = po.supplier_id
     where ol.variant_id = $1 and po.status in ('taslak', 'verildi') order by po.created_at`,
    [variantId],
  );
  return {
    requests: reqs.map((r) => ({
      id: r.id, requestNo: r.requestNo, qty: r.qty, unitLabel: r.unitLabel, progressLabel: r.progressLabel, requesterName: r.requesterName,
      requestedAt: r.requestedAt, neededBy: r.neededBy,
    })),
    orders: orders.filter((o) => isPositive(o.pendingQty)).map((o) => ({ ...o, supplierName: opts.showSupplier === false ? "" : o.supplierName })),
  };
}

export const hasOpenNeeds = (n: OpenNeeds) => n.requests.length > 0 || n.orders.length > 0;

/**
 * Asistanın hızlı talebi. Talep eden kişi ve tarih otomatik kaydedilir.
 * Aynı ürün için açık talep veya beklenen sipariş varsa 409 döner (liste ile); gerçekten ek ihtiyaç varsa gerekçe yazılarak açılır.
 * Aynı form iki kez gönderilirse (çift dokunma, bağlantı tekrarı) ikinci istek ilk kaydı döndürür.
 */
export async function createRequest(ctx: Ctx, input: unknown): Promise<RequestRow> {
  assertCan(ctx.actor, "request.create");
  const r = new Reader(asBody(input));
  const variantId = r.optId("variantId", "Ürün");
  const tempProductText = variantId ? null : r.optText("tempProductText", "Ürün tanımı", { max: 300 });
  if (!variantId && !tempProductText) r.error("variantId", "Katalogdan ürün seçin ya da katalogda yoksa ürünü tarif edin.");
  const stockState = r.oneOf("stockState", "Durum (azaldı / bitti)", STOCK_STATES.values);
  const qty = r.decimal("qty", "İstenen miktar", { scale: 3, positive: true, max: "100000" });
  const unitKind = variantId ? r.oneOf("unitKind", "Birim", ["siparis", "temel"] as const, "siparis") : null;
  const tempUnit = variantId ? null : r.oneOf("unitLabel", "Birim", UNITS, "adet");
  const remainingQty = r.optDecimal("remainingQty", "Kalan miktar", { scale: 3, min: "0", max: "100000" });
  const neededBy = r.optDate("neededBy", "İhtiyaç tarihi");
  if (neededBy && neededBy < ctx.today) r.error("neededBy", "İhtiyaç tarihi geçmiş bir gün olamaz.");
  const urgency = r.oneOf("urgency", "Aciliyet", URGENCIES.values, "normal");
  const locationId = r.optId("locationId", "Oda / bölüm");
  const note = r.optText("note", "Açıklama", { multiline: true, max: 1000 });
  const extraNeedReason = r.optText("extraNeedReason", "Ek ihtiyaç gerekçesi", { multiline: true, max: 500 });
  const key = r.optKey();
  if (!r.ok) throw new ValidationError(r.errors);

  return ctx.db.tx(async (q) => {
    if (key) {
      const [dup] = await q.query<{ id: string }>(`select id from requests where requested_by = $1 and idempotency_key = $2`, [ctx.actor.userId, key]);
      if (dup) return (await getRequestRow(q, dup.id))!;
    }
    let unitLabel = tempUnit ?? "";
    if (variantId) {
      const v = await getVariant(q, variantId);
      if (!v || !v.active) throw new ValidationError({ variantId: "Ürün katalogda bulunamadı veya pasif." });
      unitLabel = unitKind === "temel" ? v.baseUnit : v.orderUnit;
      const needs = await openNeeds(q, variantId, { showSupplier: false });
      if (hasOpenNeeds(needs) && !extraNeedReason) {
        throw new ConflictError(
          "duplicate_open",
          "Bu ürün için açık talep veya teslimatı beklenen sipariş var. Mükerrer alımı önlemek için kontrol edin; gerçekten ek ihtiyaç varsa gerekçesini yazarak yine de talep açabilirsiniz.",
          { openNeeds: needs },
          { extraNeedReason: "Ek ihtiyaç gerekçesi yazın ya da mevcut talebi/siparişi bekleyin." },
        );
      }
    }
    if (locationId && !(await q.query(`select 1 from locations where id = $1`, [locationId])).length) throw new ValidationError({ locationId: "Oda / bölüm bulunamadı." });
    const requestNo = await nextNo(q, "T", ctx.today);
    let row: { id: string } | undefined;
    try {
      [row] = await q.query<{ id: string }>(
        `insert into requests (request_no, variant_id, temp_product_text, stock_state, qty, unit_kind, unit_label, remaining_qty, needed_by,
           urgency, location_id, note, extra_need_reason, idempotency_key, requested_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
        [requestNo, variantId, tempProductText, stockState, qty, unitKind, unitLabel, remainingQty, neededBy, urgency, locationId, note,
          extraNeedReason, key, ctx.actor.userId],
      );
    } catch (e) {
      if (isUniqueViolation(e, "requests_idem_uq")) throw new ConflictError("duplicate_submit", "Bu talep zaten gönderildi.");
      throw e;
    }
    const created = (await getRequestRow(q, row!.id))!;
    await audit(q, ctx, {
      entity: "request", entityId: created.id, action: "create",
      summary: `Talep ${requestNo}: ${created.label} – ${formatQty(qty)} ${unitLabel} (${STOCK_STATES.label(stockState)}, ${URGENCIES.label(urgency)})${extraNeedReason ? ` · ek ihtiyaç: ${extraNeedReason}` : ""}`,
    });
    return created;
  });
}

export interface RequestDetail extends RequestRow {
  allocations: { orderLineId: string; orderId: string; orderNo: string; orderStatus: string; supplierName: string; qtyBase: string }[];
  openNeeds: OpenNeeds | null;
  history: AuditRow[];
}

export async function getRequest(ctx: Ctx, id: string): Promise<RequestDetail> {
  assertCan(ctx.actor, "request.create");
  const r = await getRequestRow(ctx.db, id);
  if (!r) throw new NotFoundError("Talep bulunamadı.");
  assertCanSee(ctx, r);
  const allocations = await ctx.db.query<RequestDetail["allocations"][number]>(
    `select ra.order_line_id as "orderLineId", po.id as "orderId", po.order_no as "orderNo", po.status as "orderStatus", s.name as "supplierName", ra.qty_base as "qtyBase"
     from request_allocations ra join order_lines ol on ol.id = ra.order_line_id join purchase_orders po on po.id = ol.order_id
     join suppliers s on s.id = po.supplier_id where ra.request_id = $1 order by ra.created_at`,
    [id],
  );
  const history = await ctx.db.query<AuditRow>(`select ${AUDIT_COLS} from audit_log where entity = 'request' and entity_id = $1 order by at desc, id desc`, [id]);
  return {
    ...r,
    allocations,
    openNeeds: r.variantId && can(ctx.actor, "request.viewAll") ? await openNeeds(ctx.db, r.variantId, { excludeRequestId: id }) : null,
    history,
  };
}

/** Yönetim: onay veya ret (ret gerekçesi zorunlu). Siparişe bağlanmış talep reddedilemez. */
export async function decideRequest(ctx: Ctx, id: string, input: unknown): Promise<RequestRow> {
  assertCan(ctx.actor, "request.decide");
  const r = new Reader(asBody(input));
  const version = r.version();
  const decision = r.oneOf("decision", "Karar", ["onayla", "reddet"] as const);
  const note = r.optText("note", "Karar notu", { multiline: true, max: 500 });
  if (decision === "reddet" && !note) r.error("note", "Ret gerekçesi yazılmalı (talep eden kişi görür).");
  if (!r.ok) throw new ValidationError(r.errors);
  return ctx.db.tx(async (q) => {
    const cur = await lockRow<{ status: string; version: number; request_no: string }>(q, "requests", id, "status, version, request_no");
    if (cur.version !== version) throw new VersionConflictError();
    if (!["beklemede", "onaylandi"].includes(cur.status)) throw new ConflictError("closed", "Bu talep kapanmış (reddedilmiş veya iptal edilmiş).");
    if (decision === "reddet" && (await q.query(`select 1 from request_allocations where request_id = $1`, [id])).length) {
      throw new ConflictError("allocated", "Bu talep bir siparişe bağlanmış; reddetmek için önce sipariş kaleminden bağlantıyı kaldırın.");
    }
    const status = decision === "onayla" ? "onaylandi" : "reddedildi";
    await q.query(
      `update requests set status = $2, decided_by = $3, decided_at = now(), decision_note = $4, version = version + 1, updated_at = now() where id = $1`,
      [id, status, ctx.actor.userId, note],
    );
    await audit(q, ctx, {
      entity: "request", entityId: id, action: decision, summary: `Talep ${cur.request_no} ${decision === "onayla" ? "onaylandı" : "reddedildi"}${note ? `: ${note}` : ""}`,
      changes: { status: { label: "Durum", from: cur.status, to: status } },
    });
    return (await getRequestRow(q, id))!;
  });
}

/** Talep eden kişi değerlendirilmemiş talebini geri çekebilir; yönetim her açık talebi gerekçeyle iptal edebilir. */
export async function cancelRequest(ctx: Ctx, id: string, input: unknown): Promise<RequestRow> {
  const r = new Reader(asBody(input));
  const version = r.version();
  const reason = r.optText("reason", "İptal gerekçesi", { max: 300 });
  if (!r.ok) throw new ValidationError(r.errors);
  return ctx.db.tx(async (q) => {
    const cur = await lockRow<{ status: string; version: number; requested_by: string; request_no: string }>(q, "requests", id, "status, version, requested_by, request_no");
    const own = cur.requested_by === ctx.actor.userId;
    if (!own && !can(ctx.actor, "request.decide")) throw new ForbiddenError("Bu talebi yalnızca talep eden kişi veya yönetim iptal edebilir.");
    if (own && !can(ctx.actor, "request.decide") && cur.status !== "beklemede") throw new ConflictError("decided", "Değerlendirilmiş talebi iptal etmek için yönetime başvurun.");
    if (cur.version !== version) throw new VersionConflictError();
    if (!["beklemede", "onaylandi"].includes(cur.status)) throw new ConflictError("closed", "Bu talep zaten kapanmış.");
    if ((await q.query(`select 1 from request_allocations where request_id = $1`, [id])).length) {
      throw new ConflictError("allocated", "Bu talep bir siparişe bağlanmış; iptal için önce sipariş kaleminden bağlantıyı kaldırın.");
    }
    if (!own && !reason) throw new ValidationError({ reason: "İptal gerekçesi yazılmalı." });
    await q.query(`update requests set status = 'iptal', decided_by = $2, decided_at = now(), decision_note = $3, version = version + 1, updated_at = now() where id = $1`, [
      id, ctx.actor.userId, reason,
    ]);
    await audit(q, ctx, { entity: "request", entityId: id, action: "cancel", summary: `Talep ${cur.request_no} iptal edildi${reason ? `: ${reason}` : ""}` });
    return (await getRequestRow(q, id))!;
  });
}

/**
 * Katalog dışı (geçici) talebi yönetim mevcut bir ürünle eşleştirir ya da talepteki tanımdan yeni ürün varyantı açar.
 * Eşleşmeden talep siparişe bağlanamaz.
 */
export async function matchRequest(ctx: Ctx, id: string, input: unknown): Promise<RequestRow> {
  assertCan(ctx.actor, "request.decide");
  const body = asBody(input);
  const r = new Reader(body);
  const version = r.version();
  const newVariant = body.newVariant && typeof body.newVariant === "object" ? body.newVariant : null;
  const variantIdIn = newVariant ? null : r.id("variantId", "Eşleşen ürün");
  const unitKind = r.oneOf("unitKind", "Talepteki birim", ["siparis", "temel"] as const, "siparis");
  if (!r.ok) throw new ValidationError(r.errors);
  return ctx.db.tx(async (q) => {
    const cur = await lockRow<{ variant_id: string | null; version: number; temp_product_text: string | null; request_no: string; status: string }>(
      q, "requests", id, "variant_id, version, temp_product_text, request_no, status",
    );
    if (cur.version !== version) throw new VersionConflictError();
    if (cur.variant_id) throw new ConflictError("already_matched", "Bu talep zaten katalogdaki bir ürüne bağlı.");
    if (!["beklemede", "onaylandi"].includes(cur.status)) throw new ConflictError("closed", "Bu talep kapanmış.");
    const variant = newVariant ? await createVariant(ctx, newVariant, q) : await getVariant(q, variantIdIn!);
    if (!variant) throw new ValidationError({ variantId: "Ürün bulunamadı." });
    const unitLabel = unitKind === "temel" ? variant.baseUnit : variant.orderUnit;
    await q.query(`update requests set variant_id = $2, unit_kind = $3, unit_label = $4, version = version + 1, updated_at = now() where id = $1`, [
      id, variant.id, unitKind, unitLabel,
    ]);
    await audit(q, ctx, {
      entity: "request", entityId: id, action: "match",
      summary: `Talep ${cur.request_no}: katalog dışı “${cur.temp_product_text}” → ${variant.label}${newVariant ? " (yeni ürün olarak açıldı)" : ""}`,
    });
    return (await getRequestRow(q, id))!;
  });
}

/** Siparişe eklenmeyi bekleyen talepler (yönetimin planlama ekranı): ihtiyaç > siparişe bağlanan. */
export async function planningQueue(ctx: Ctx): Promise<RequestRow[]> {
  assertCan(ctx.actor, "request.decide");
  const rows = (await ctx.db.query<RawRequest>(`${SELECT} where r.status in ('beklemede', 'onaylandi') order by r.urgency = 'cok_acil' desc, r.urgency = 'acil' desc, r.needed_by nulls last, r.requested_at`)).map(finish);
  return rows.filter((r) => !r.variantId || cmp(r.allocBase, r.needBase) < 0);
}

/** Talebin henüz siparişe bağlanmamış ihtiyacı (temel birim). */
export function unallocatedBase(r: Pick<RequestRow, "needBase" | "allocBase">): string {
  const rest = dec(r.needBase).minus(dec(r.allocBase));
  return qtyStr(rest.isNegative() ? 0 : rest);
}

export { getRequestRow };
