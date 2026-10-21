import { dec, excludeVat, formatQty, isPositive } from "@/lib/decimal";
import { ISSUE_ACTIONS, ISSUE_TYPES, type IssueAction } from "@/lib/labels";
import { asBody, isUuid, Reader } from "@/lib/validate";
import { audit } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { assertCan, can } from "../permissions";
import { lockRow } from "./common";
import { autoResolveShortages, LINE_STATS } from "./order-state";

export interface IssueRow {
  id: string;
  issueNo: string;
  orderId: string;
  orderNo: string;
  supplierName: string;
  orderLineId: string | null;
  lineNo: number | null;
  orderedLabel: string | null;
  receiptId: string | null;
  receiptNo: string | null;
  receiptLineId: string | null;
  type: string;
  qty: string | null;
  unitLabel: string | null;
  description: string | null;
  action: string | null;
  status: string;
  returnedOn: string | null;
  resolutionNote: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  reportedByName: string;
  reportedAt: string;
  version: number;
  receiverUserId: string | null;
  // Teslimat satırı (gerçekte gelen ürün ve miktarlar)
  receivedLabel: string | null;
  receivedDesc: string | null;
  qtyHeld: string | null;
  qtyRejected: string | null;
  qtyAccepted: string | null;
  lotNo: string | null;
  expiryDate: string | null;
  checkDate: string | null;
  linePending: string | null;
  hasAdjustment: boolean;
}

const SELECT = `select di.id, di.issue_no as "issueNo", di.order_id as "orderId", po.order_no as "orderNo", s.name as "supplierName",
    di.order_line_id as "orderLineId", ol.line_no as "lineNo",
    case when ol.id is null then null else concat_ws(' – ', op.name, nullif(concat_ws(' · ', ov.brand, ov.model, ov.attributes), '')) end as "orderedLabel",
    di.receipt_id as "receiptId", rcp.receipt_no as "receiptNo", di.receipt_line_id as "receiptLineId", di.type, di.qty,
    coalesce(ol.unit_label, rv.order_unit) as "unitLabel", di.description, di.action, di.status, di.returned_on as "returnedOn",
    di.resolution_note as "resolutionNote", rb.display_name as "resolvedByName", di.resolved_at as "resolvedAt",
    pb.display_name as "reportedByName", di.reported_at as "reportedAt", di.version, po.receiver_user_id as "receiverUserId",
    case when rv.id is null then null else concat_ws(' – ', rp.name, nullif(concat_ws(' · ', rv.brand, rv.model, rv.attributes), '')) end as "receivedLabel",
    rln.received_desc as "receivedDesc", rln.qty_held as "qtyHeld", rln.qty_rejected as "qtyRejected", rln.qty_accepted as "qtyAccepted",
    rln.lot_no as "lotNo", rln.expiry_date as "expiryDate", rln.check_date as "checkDate",
    case when ol.id is null then null else (ol.qty - ol.canceled_qty - st.accepted) end as "linePending",
    exists(select 1 from financial_adjustments fa where fa.issue_id = di.id and fa.status <> 'iptal') as "hasAdjustment"
  from delivery_issues di
  join purchase_orders po on po.id = di.order_id join suppliers s on s.id = po.supplier_id
  left join order_lines ol on ol.id = di.order_line_id
  left join variants ov on ov.id = ol.variant_id left join products op on op.id = ov.product_id
  left join receipts rcp on rcp.id = di.receipt_id
  left join receipt_lines rln on rln.id = di.receipt_line_id
  left join variants rv on rv.id = rln.received_variant_id left join products rp on rp.id = rv.product_id
  left join app_users rb on rb.id = di.resolved_by join app_users pb on pb.id = di.reported_by
  ${LINE_STATS}`;

function assertIssueAccess(ctx: Ctx, receiverUserId: string | null) {
  if (can(ctx.actor, "order.view")) return;
  if (can(ctx.actor, "issue.report") && receiverUserId === ctx.actor.userId) return;
  throw new ForbiddenError("Bu sorunu görme yetkiniz yok.");
}

export async function listIssues(ctx: Ctx, f: { status?: "acik" | "cozuldu" | "tumu"; orderId?: string | null; type?: string | null } = {}): Promise<IssueRow[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (!can(ctx.actor, "order.view")) {
    assertCan(ctx.actor, "issue.report");
    params.push(ctx.actor.userId);
    where.push(`po.receiver_user_id = $${params.length}`);
  }
  if (f.status && f.status !== "tumu") {
    params.push(f.status);
    where.push(`di.status = $${params.length}`);
  }
  if (f.orderId && isUuid(f.orderId)) {
    params.push(f.orderId);
    where.push(`di.order_id = $${params.length}`);
  }
  if (f.type) {
    params.push(f.type);
    where.push(`di.type = $${params.length}`);
  }
  return ctx.db.query<IssueRow>(`${SELECT} ${where.length ? `where ${where.join(" and ")}` : ""} order by di.status = 'acik' desc, di.reported_at desc limit 500`, params);
}

export async function getIssue(ctx: Ctx, id: string, qx?: Queryable): Promise<IssueRow> {
  const [row] = await (qx ?? ctx.db).query<IssueRow>(`${SELECT} where di.id = $1`, [id]);
  if (!row) throw new NotFoundError("Sorun kaydı bulunamadı.");
  assertIssueAccess(ctx, row.receiverUserId);
  return row;
}

/**
 * Sorunu güncelleme: teslimat sorumlusu açıklama ve "tedarikçiye geri verildi" tarihini girer; yönetim çözüm yolunu seçer
 * (karar vermeden de seçilebilir: ör. "değişim" seçilir, ürün geri verilince çözülür).
 */
export async function updateIssue(ctx: Ctx, id: string, input: unknown): Promise<IssueRow> {
  const r = new Reader(asBody(input));
  const version = r.version();
  const description = r.optText("description", "Açıklama", { multiline: true, max: 1000 });
  const returnedOn = r.optDate("returnedOn", "Tedarikçiye geri verildiği gün", { notAfter: ctx.today });
  const action = r.optOneOf("action", "Çözüm yolu", ISSUE_ACTIONS.values);
  if (!r.ok) throw new ValidationError(r.errors);
  return ctx.db.tx(async (q) => {
    const cur = await getIssue(ctx, id, q);
    if (!can(ctx.actor, "issue.report") && !can(ctx.actor, "issue.resolve")) throw new ForbiddenError();
    if (action && action !== cur.action && !can(ctx.actor, "issue.resolve")) throw new ForbiddenError("Çözüm yolunu yalnızca yönetim / satın alma seçebilir.");
    if (cur.status !== "acik") throw new ConflictError("resolved", "Çözülmüş sorun değiştirilemez.");
    const rows = await q.query(
      `update delivery_issues set description = $3, returned_on = $4, action = $5, version = version + 1, updated_at = now() where id = $1 and version = $2 returning id`,
      [id, version, description, returnedOn, action ?? cur.action],
    );
    if (!rows.length) throw new VersionConflictError();
    await audit(q, ctx, {
      entity: "issue", entityId: id, orderId: cur.orderId, action: "update", summary: `Sorun ${cur.issueNo} güncellendi`,
      changes: {
        ...(cur.description !== description ? { description: { label: "Açıklama", from: cur.description, to: description } } : {}),
        ...(cur.returnedOn !== returnedOn ? { returnedOn: { label: "Tedarikçiye geri verildi", from: cur.returnedOn, to: returnedOn } } : {}),
        ...(action && cur.action !== action ? { action: { label: "Çözüm yolu", from: ISSUE_ACTIONS.label(cur.action), to: ISSUE_ACTIONS.label(action) } } : {}),
      },
    });
    return getIssue(ctx, id, q);
  });
}

const ACCEPTING: IssueAction[] = ["alternatif_kabul", "kabul", "fiyat_duzeltmesi"];
const RETURNING: IssueAction[] = ["degisim", "iade"];

/**
 * Yönetim kararı ve çözüm. Kurallar:
 *  - Kabul eden kararlar (alternatif ürün, kısa miat/lotsuz/hasarlı kabul, fiyat düzeltmesiyle kabul) incelemedeki miktarı kabule çevirir;
 *    farklı marka kabul edilirse gerçek gelen ürün teslimat satırında kalır, sipariş kalemi DEĞİŞMEZ. SKT geçmiş ürün hiçbir kararla kabul edilmez.
 *  - Fazla gelen ürünün kabulü sipariş miktarını artırır; sipariş dışı ürünün kabulü siparişe yeni kalem açar (fiyat girilir). İkisi de geçmişe yazılır.
 *  - Değişim / iade: incelemedeki miktar redde çevrilir; ürünün tedarikçiye geri verildiği gün girilmeden çözülmez.
 *    İade, kalemin bekleyen miktarını iptal eder (yerine ürün gelmeyecek). Borç, ancak finansal düzeltme belgesiyle düşer.
 *  - "Kalan iptal": ilgili kalemin bekleyen miktarı gerekçeyle iptal edilir.
 */
export async function resolveIssue(ctx: Ctx, id: string, input: unknown): Promise<IssueRow> {
  assertCan(ctx.actor, "issue.resolve");
  const r = new Reader(asBody(input));
  const version = r.version();
  const action = r.oneOf("action", "Karar / çözüm", ISSUE_ACTIONS.values);
  const note = r.text("note", "Karar açıklaması", { max: 1000 });
  const returnedOnIn = r.optDate("returnedOn", "Tedarikçiye geri verildiği gün", { notAfter: ctx.today });
  const acceptQtyIn = r.optDecimal("acceptQty", "Kabul edilecek miktar", { scale: 3, positive: true });
  const vatRateIn = r.optDecimal("vatRate", "KDV oranı", { min: "0", max: "100" });
  const priceIn = r.optDecimal("unitPrice", "Birim fiyat", { scale: 4, min: "0" });
  const inclVat = r.bool("priceIncludesVat");
  if (!r.ok) throw new ValidationError(r.errors);

  return ctx.db.tx(async (q) => {
    const pre = await getIssue(ctx, id, q);
    // Kilit sırası: sipariş → teslimat → sorun
    const order = await lockRow<{ id: string; order_no: string; status: string; supplier_id: string; currency: string }>(q, "purchase_orders", pre.orderId, "id, order_no, status, supplier_id, currency");
    const cur = await lockRow<{ version: number; status: string }>(q, "delivery_issues", id, "version, status");
    if (cur.version !== version) throw new VersionConflictError();
    if (cur.status !== "acik") throw new ConflictError("resolved", "Bu sorun zaten çözülmüş.");
    const issue = await getIssue(ctx, id, q);
    const returnedOn = returnedOnIn ?? issue.returnedOn;
    const held = dec(issue.qtyHeld ?? 0);

    if (action === "eksik_bekleniyor") {
      if (issue.type !== "eksik") throw new ValidationError({ action: "“Eksik ürün bekleniyor” yalnızca eksik teslimat sorununda seçilir." });
      if (isPositive(issue.linePending)) {
        throw new ConflictError("still_pending", "Eksik miktar henüz gelmedi; sorun, kalan miktar teslim alınınca otomatik çözülür. Gelmeyecekse “Kalan miktar iptal edildi” seçin.");
      }
    }

    if (ACCEPTING.includes(action) && held.gt(0)) {
      if (issue.type === "skt_gecmis") throw new ValidationError({ action: "Son kullanma tarihi geçmiş ürün kabul edilemez." });
      if (issue.expiryDate && issue.expiryDate < ctx.today) throw new ValidationError({ action: "Ürünün son kullanma tarihi geçmiş; kabul edilemez." });
      const acceptQty = acceptQtyIn ? dec(acceptQtyIn) : held;
      if (acceptQty.gt(held)) throw new ValidationError({ acceptQty: `İncelemede ${formatQty(held)} var; daha fazlası kabul edilemez.` });
      const [rl] = await q.query<{ order_line_id: string | null; received_variant_id: string | null; lot_no: string | null }>(
        `select order_line_id, received_variant_id, lot_no from receipt_lines where id = $1 for update`,
        [issue.receiptLineId],
      );
      let orderLineId = rl!.order_line_id;
      if (!orderLineId) {
        // Sipariş dışı ürün: siparişe yeni kalem olarak eklenir.
        if (!rl!.received_variant_id) throw new ValidationError({ action: "Sipariş dışı ürünü kabul etmek için teslimat satırında ürün katalogdan seçilmiş olmalı (önce kataloğa ekleyin)." });
        if (priceIn === null) throw new ValidationError({ unitPrice: "Sipariş dışı ürün siparişe eklenecek: birim fiyatı girin." });
        const [v] = await q.query<{ order_unit: string; pack_size: string; default_vat_rate: string }>(`select order_unit, pack_size, default_vat_rate from variants where id = $1`, [rl!.received_variant_id]);
        const vat = vatRateIn ?? v!.default_vat_rate;
        const [{ n }] = (await q.query<{ n: number }>(`select coalesce(max(line_no), 0) + 1 as n from order_lines where order_id = $1`, [order.id])) as [{ n: number }];
        const [line] = await q.query<{ id: string }>(
          `insert into order_lines (order_id, line_no, variant_id, qty, unit_label, pack_size, unit_price, vat_rate, note) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [order.id, n, rl!.received_variant_id, acceptQty.toFixed(3), v!.order_unit, v!.pack_size, inclVat ? excludeVat(priceIn, vat) : priceIn, vat, `Sipariş dışı gelen ürün, yönetim kararıyla eklendi (${issue.issueNo})`],
        );
        orderLineId = line!.id;
        await q.query(`update receipt_lines set order_line_id = $2 where id = $1`, [issue.receiptLineId, orderLineId]);
        await audit(q, ctx, { entity: "order", entityId: order.id, orderId: order.id, supplierId: order.supplier_id, action: "add_line", summary: `Sipariş ${order.order_no}: sipariş dışı gelen ürün ${n}. kalem olarak eklendi (${issue.issueNo})` });
      } else {
        const [line] = await q.query<{ pending: string; qty: string; line_no: number; track_lot: boolean }>(
          `select (ol.qty - ol.canceled_qty - st.accepted) as pending, ol.qty, ol.line_no, coalesce(rv.track_lot, v.track_lot) as track_lot
           from order_lines ol join variants v on v.id = ol.variant_id left join variants rv on rv.id = $2 ${LINE_STATS} where ol.id = $1`,
          [orderLineId, rl!.received_variant_id],
        );
        if (line!.track_lot && !rl!.lot_no && action !== "kabul") throw new ValidationError({ action: "Lot numarası olmayan ürün için “İncelendi, kabul edildi” kararı ve açıklaması gerekir." });
        const over = acceptQty.minus(dec(line!.pending));
        if (over.gt(0)) {
          if (action !== "kabul" || issue.type !== "fazla") {
            throw new ValidationError({ acceptQty: `Kalemde bekleyen ${formatQty(line!.pending)}; fazlası yalnızca “fazla ürün” sorununda “İncelendi, kabul edildi” kararıyla siparişe eklenebilir.` });
          }
          await q.query(`update order_lines set qty = qty + $2, version = version + 1, updated_at = now() where id = $1`, [orderLineId, over.toFixed(3)]);
          await audit(q, ctx, {
            entity: "order", entityId: order.id, orderId: order.id, supplierId: order.supplier_id, action: "update_line",
            summary: `Sipariş ${order.order_no}: fazla gelen ürün kabul edildi, ${line!.line_no}. kalem miktarı artırıldı (${issue.issueNo})`,
            changes: { qty: { label: `${line!.line_no}. kalem miktarı`, from: formatQty(line!.qty), to: formatQty(dec(line!.qty).plus(over)) } },
          });
        }
      }
      await q.query(`update receipt_lines set qty_held = qty_held - $2, qty_accepted = qty_accepted + $2, updated_at = now() where id = $1`, [issue.receiptLineId, acceptQty.toFixed(3)]);
      const rest = held.minus(acceptQty);
      if (rest.gt(0)) await q.query(`update receipt_lines set qty_held = qty_held - $2, qty_rejected = qty_rejected + $2 where id = $1`, [issue.receiptLineId, rest.toFixed(3)]);
    } else if (held.gt(0)) {
      // Kabul etmeyen kararlar: incelemedeki ürün reddedilir.
      await q.query(`update receipt_lines set qty_held = 0, qty_rejected = qty_rejected + qty_held, updated_at = now() where id = $1`, [issue.receiptLineId]);
    }

    if (RETURNING.includes(action) && issue.type !== "eksik" && !returnedOn) {
      throw new ValidationError({ returnedOn: "Değişim/iade için ürünün tedarikçiye geri verildiği günü girin. Henüz verilmediyse çözüm yolunu seçip “Kaydet” deyin; sorun açık kalır." });
    }
    // İade veya kalan iptal: yerine ürün gelmeyecek → kalemin bekleyen miktarı (sorun miktarı kadar) iptal edilir.
    if ((action === "iade" || action === "iptal") && issue.orderLineId) {
      const [line] = await q.query<{ pending: string; held: string; line_no: number }>(
        `select (ol.qty - ol.canceled_qty - st.accepted) as pending, st.held, ol.line_no from order_lines ol ${LINE_STATS} where ol.id = $1`,
        [issue.orderLineId],
      );
      const cancellable = dec(line!.pending).minus(dec(line!.held));
      const amount = dec(issue.qty ?? 0).lt(cancellable) ? dec(issue.qty ?? 0) : cancellable;
      if (amount.gt(0)) {
        if (order.status !== "verildi") throw new ConflictError("closed", "Sipariş açık değil.");
        await q.query(`update order_lines set canceled_qty = canceled_qty + $2, version = version + 1, updated_at = now() where id = $1`, [issue.orderLineId, amount.toFixed(3)]);
        await audit(q, ctx, {
          entity: "order", entityId: order.id, orderId: order.id, supplierId: order.supplier_id, action: "cancel_remaining",
          summary: `Sipariş ${order.order_no}: ${line!.line_no}. kalemden ${formatQty(amount)} iptal edildi (${issue.issueNo} – ${ISSUE_ACTIONS.label(action)}): ${note}`,
        });
      }
    }

    await q.query(
      `update delivery_issues set status = 'cozuldu', action = $2, resolution_note = $3, returned_on = $4, resolved_by = $5, resolved_at = now(),
         version = version + 1, updated_at = now() where id = $1`,
      [id, action, note, returnedOn, ctx.actor.userId],
    );
    await audit(q, ctx, {
      entity: "issue", entityId: id, orderId: order.id, supplierId: order.supplier_id, action: "resolve",
      summary: `Sorun ${issue.issueNo} (${ISSUE_TYPES.label(issue.type)}) çözüldü: ${ISSUE_ACTIONS.label(action)} – ${note}`,
    });
    await autoResolveShortages(q, ctx, order.id);
    return getIssue(ctx, id, q);
  });
}

