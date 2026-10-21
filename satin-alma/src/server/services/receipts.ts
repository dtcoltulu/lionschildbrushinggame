import { packLabel, variantLabel } from "@/lib/catalog";
import { daysBetween, formatDate } from "@/lib/dates";
import { dec, formatQty, isPositive } from "@/lib/decimal";
import { ISSUE_TYPES, type IssueType } from "@/lib/labels";
import { asBody, isUuid, Reader, type FieldErrors } from "@/lib/validate";
import { audit } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { ConflictError, ForbiddenError, isUniqueViolation, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { assertCan, can } from "../permissions";
import { lockRow, nextNo } from "./common";
import { autoResolveShortages, LINE_STATS } from "./order-state";

/**
 * Teslimat kontrolü — kritik iş akışı.
 *  - "Ürün geldi" siparişi tamamlamaz; her kalem ayrı kontrol edilir (doğru ürün/varyant, miktar, ambalaj, SKT, lot).
 *  - Fiziksel gelen = kabul + ret + yönetim incelemesinde. Ret ve inceleme kabul sayılmaz; bekleyen miktar açık kalır.
 *  - Son kullanma tarihi geçmiş ürün kabul EDİLEMEZ (veritabanı kısıtıyla da). Raf ömrü sınırın altındaysa yönetim incelemesine düşer.
 *  - Farklı marka/ürün, sipariş dışı ürün, hasarlı ambalaj veya eksik lot doğrudan kabul edilemez: reddedilir ya da incelemeye alınır.
 *  - Bir siparişte aynı anda tek açık teslimat kontrolü olur; kaydetme sürüm kontrolüyle bir kez yapılır (iki kişi aynı teslimatı
 *    kaydederse ikincisi reddedilir, miktarlar iki kez işlenmez).
 */

interface OrderForReceipt {
  id: string;
  order_no: string;
  status: string;
  receiver_user_id: string | null;
  supplier_id: string;
}

function assertReceiptAccess(ctx: Ctx, order: Pick<OrderForReceipt, "receiver_user_id">, mode: "view" | "record") {
  if (mode === "view" && can(ctx.actor, "order.view")) return;
  if (can(ctx.actor, "order.manage") && can(ctx.actor, "receipt.record")) return;
  if (can(ctx.actor, "receipt.record") && order.receiver_user_id === ctx.actor.userId) return;
  throw new ForbiddenError(mode === "record" ? "Bu siparişin teslimatını yalnızca atanan teslimat sorumlusu veya satın alma kaydedebilir." : "Bu teslimatı görme yetkiniz yok.");
}

export interface ReceiptOrderLine {
  id: string;
  lineNo: number;
  variantId: string;
  label: string;
  code: string | null;
  qty: string;
  unitLabel: string;
  packText: string;
  canceledQty: string;
  accepted: string;
  held: string;
  pending: string;
  trackExpiry: boolean;
  trackLot: boolean;
  minShelfLifeDays: number | null;
}

export interface ReceiptLine {
  id: string;
  orderLineId: string | null;
  receivedVariantId: string | null;
  receivedLabel: string | null;
  receivedDesc: string | null;
  qtyPhysical: string;
  qtyAccepted: string;
  qtyRejected: string;
  qtyHeld: string;
  lotNo: string | null;
  expiryDate: string | null;
  chkProduct: boolean;
  chkVariant: boolean;
  chkPackage: boolean;
  issueType: IssueType | null;
  issueNote: string | null;
  note: string | null;
}

export interface Receipt {
  id: string;
  receiptNo: string;
  status: string;
  receivedOn: string;
  deliveryNoteNo: string | null;
  note: string | null;
  version: number;
  startedByName: string;
  postedByName: string | null;
  postedAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  order: { id: string; orderNo: string; status: string; supplierName: string; expectedOn: string | null; receiverName: string | null; receiverUserId: string | null };
  orderLines: ReceiptOrderLine[];
  lines: ReceiptLine[];
  issues: { id: string; issueNo: string; type: string; status: string; qty: string | null; receiptLineId: string | null }[];
}

async function orderLinesFor(q: Queryable, orderId: string): Promise<ReceiptOrderLine[]> {
  const rows = await q.query<Omit<ReceiptOrderLine, "label" | "packText"> & { productName: string; brand: string | null; model: string | null; attributes: string | null; baseUnit: string; packSize: string }>(
    `select ol.id, ol.line_no as "lineNo", ol.variant_id as "variantId", p.name as "productName", v.brand, v.model, v.attributes, v.code,
       ol.qty, ol.unit_label as "unitLabel", ol.pack_size as "packSize", v.base_unit as "baseUnit", ol.canceled_qty as "canceledQty",
       st.accepted, st.held, (ol.qty - ol.canceled_qty - st.accepted) as pending,
       v.track_expiry as "trackExpiry", v.track_lot as "trackLot", v.min_shelf_life_days as "minShelfLifeDays"
     from order_lines ol join variants v on v.id = ol.variant_id join products p on p.id = v.product_id ${LINE_STATS}
     where ol.order_id = $1 order by ol.line_no`,
    [orderId],
  );
  return rows.map(({ productName, brand, model, attributes, baseUnit, packSize, ...l }) => ({
    ...l,
    label: variantLabel({ productName, brand, model, attributes }),
    packText: packLabel({ orderUnit: l.unitLabel, baseUnit, packSize }),
  }));
}

export async function getReceipt(ctx: Ctx, id: string, qx?: Queryable): Promise<Receipt> {
  const q = qx ?? ctx.db;
  const [r] = await q.query<Omit<Receipt, "order" | "orderLines" | "lines" | "issues"> & { orderId: string; orderNo: string; orderStatus: string; supplierName: string; expectedOn: string | null; receiverName: string | null; receiverUserId: string | null }>(
    `select r.id, r.receipt_no as "receiptNo", r.status, r.received_on as "receivedOn", r.delivery_note_no as "deliveryNoteNo", r.note, r.version,
       sb.display_name as "startedByName", pb.display_name as "postedByName", r.posted_at as "postedAt", r.canceled_at as "canceledAt",
       r.cancel_reason as "cancelReason", po.id as "orderId", po.order_no as "orderNo", po.status as "orderStatus", s.name as "supplierName",
       po.expected_on as "expectedOn", ru.display_name as "receiverName", po.receiver_user_id as "receiverUserId"
     from receipts r join purchase_orders po on po.id = r.order_id join suppliers s on s.id = po.supplier_id
     join app_users sb on sb.id = r.started_by left join app_users pb on pb.id = r.posted_by left join app_users ru on ru.id = po.receiver_user_id
     where r.id = $1`,
    [id],
  );
  if (!r) throw new NotFoundError("Teslimat kaydı bulunamadı.");
  assertReceiptAccess(ctx, { receiver_user_id: r.receiverUserId }, "view");
  const lines = await q.query<ReceiptLine & { rProduct: string | null; rBrand: string | null; rModel: string | null; rAttributes: string | null }>(
    `select rl.id, rl.order_line_id as "orderLineId", rl.received_variant_id as "receivedVariantId", rl.received_desc as "receivedDesc",
       rl.qty_physical as "qtyPhysical", rl.qty_accepted as "qtyAccepted", rl.qty_rejected as "qtyRejected", rl.qty_held as "qtyHeld",
       rl.lot_no as "lotNo", rl.expiry_date as "expiryDate", rl.chk_product as "chkProduct", rl.chk_variant as "chkVariant",
       rl.chk_package as "chkPackage", rl.issue_type as "issueType", rl.issue_note as "issueNote", rl.note,
       p.name as "rProduct", v.brand as "rBrand", v.model as "rModel", v.attributes as "rAttributes"
     from receipt_lines rl left join variants v on v.id = rl.received_variant_id left join products p on p.id = v.product_id
     where rl.receipt_id = $1 order by rl.created_at, rl.id`,
    [id],
  );
  const issues = await q.query<Receipt["issues"][number]>(
    `select id, issue_no as "issueNo", type, status, qty, receipt_line_id as "receiptLineId" from delivery_issues where receipt_id = $1 order by reported_at`,
    [id],
  );
  const { orderId, orderNo, orderStatus, supplierName, expectedOn, receiverName, receiverUserId, ...head } = r;
  return {
    ...head,
    order: { id: orderId, orderNo, status: orderStatus, supplierName, expectedOn, receiverName, receiverUserId },
    orderLines: await orderLinesFor(q, orderId),
    lines: lines.map(({ rProduct, rBrand, rModel, rAttributes, ...l }) => ({
      ...l,
      receivedLabel: rProduct ? variantLabel({ productName: rProduct, brand: rBrand, model: rModel, attributes: rAttributes }) : null,
    })),
    issues,
  };
}

/**
 * Teslimat kontrolünü başlatır. Siparişin açık bir kontrolü varsa YENİSİ AÇILMAZ, o döndürülür
 * (iki kişi aynı anda başlatsa da tek kayıt olur).
 */
export async function startReceipt(ctx: Ctx, orderId: string): Promise<{ id: string }> {
  assertCan(ctx.actor, "receipt.record");
  const existing = async () => (await ctx.db.query<{ id: string }>(`select id from receipts where order_id = $1 and status = 'taslak'`, [orderId]))[0];
  try {
    return await ctx.db.tx(async (q) => {
      const o = await lockRow<OrderForReceipt>(q, "purchase_orders", orderId, "id, order_no, status, receiver_user_id, supplier_id");
      assertReceiptAccess(ctx, o, "record");
      if (o.status !== "verildi") throw new ConflictError("not_placed", "Teslimat yalnızca verilmiş (açık) siparişe kaydedilir.");
      const [draft] = await q.query<{ id: string }>(`select id from receipts where order_id = $1 and status = 'taslak'`, [orderId]);
      if (draft) return draft;
      const receiptNo = await nextNo(q, "TS", ctx.today);
      const [row] = await q.query<{ id: string }>(`insert into receipts (receipt_no, order_id, received_on, started_by) values ($1, $2, $3, $4) returning id`, [
        receiptNo, orderId, ctx.today, ctx.actor.userId,
      ]);
      await audit(q, ctx, { entity: "receipt", entityId: row!.id, orderId, supplierId: o.supplier_id, action: "start", summary: `Teslimat kontrolü ${receiptNo} başlatıldı (sipariş ${o.order_no})` });
      return row!;
    });
  } catch (e) {
    if (isUniqueViolation(e, "receipts_one_draft_per_order")) {
      const d = await existing();
      if (d) return d;
    }
    throw e;
  }
}

interface LineIn {
  index: number;
  orderLineId: string | null;
  receivedVariantId: string | null;
  receivedDesc: string | null;
  qtyPhysical: string;
  qtyAccepted: string;
  qtyRejected: string;
  qtyHeld: string;
  lotNo: string | null;
  expiryDate: string | null;
  chkProduct: boolean;
  chkVariant: boolean;
  chkPackage: boolean;
  issueType: IssueType | null;
  issueNote: string | null;
  note: string | null;
}

function readLines(r: Reader): LineIn[] {
  return r.list("lines", "Gelen ürünler", { max: 200 }).map((l, index) => ({
    index,
    orderLineId: l.optId("orderLineId", "Sipariş kalemi"),
    receivedVariantId: l.optId("receivedVariantId", "Gerçekte gelen ürün"),
    receivedDesc: l.optText("receivedDesc", "Gelen ürünün tanımı", { max: 300 }),
    qtyPhysical: l.decimal("qtyPhysical", "Gelen miktar", { scale: 3, positive: true, max: "100000" }),
    qtyAccepted: l.optDecimal("qtyAccepted", "Kabul edilen", { scale: 3, min: "0" }) ?? "0",
    qtyRejected: l.optDecimal("qtyRejected", "Reddedilen", { scale: 3, min: "0" }) ?? "0",
    qtyHeld: l.optDecimal("qtyHeld", "Yönetim incelemesine", { scale: 3, min: "0" }) ?? "0",
    lotNo: l.optText("lotNo", "Lot / parti no", { max: 60 }),
    expiryDate: l.optDate("expiryDate", "Son kullanma tarihi"),
    chkProduct: l.bool("chkProduct", true),
    chkVariant: l.bool("chkVariant", true),
    chkPackage: l.bool("chkPackage", true),
    issueType: l.optOneOf("issueType", "Sorun türü", ISSUE_TYPES.values),
    issueNote: l.optText("issueNote", "Sorun açıklaması", { multiline: true, max: 1000 }),
    note: l.optText("note", "Not", { max: 300 }),
  }));
}

interface VariantFlags {
  id: string;
  trackExpiry: boolean;
  trackLot: boolean;
  minShelfLifeDays: number | null;
}

/**
 * Kalem kuralları. Hata anahtarları "lines.<sıra>.<alan>" biçimindedir; ekran hatayı ilgili satırın altında gösterir.
 * Sorun türü seçilmemişse kontrol sonucundan çıkarılır (ör. SKT geçmiş → "Son kullanma tarihi geçmiş").
 */
export function checkLines(lines: LineIn[], orderLines: ReceiptOrderLine[], variants: Map<string, VariantFlags>, receivedOn: string): { errors: FieldErrors; structural: FieldErrors; lines: LineIn[] } {
  const errors: FieldErrors = {};
  // Yapısal hatalar taslak kaydını da engeller (veritabanı kısıtlarına karşılık gelir); diğerleri yalnızca tamamlamayı.
  const structural: FieldErrors = {};
  const err = (i: number, field: string, msg: string, always = false) => {
    const k = `lines.${i}.${field}`;
    if (!errors[k]) errors[k] = msg;
    if (always && !structural[k]) structural[k] = msg;
  };
  const byId = new Map(orderLines.map((l) => [l.id, l]));
  const acceptedPerLine = new Map<string, ReturnType<typeof dec>>();
  const out = lines.map((l) => ({ ...l }));
  for (const l of out) {
    const i = l.index;
    const ol = l.orderLineId ? byId.get(l.orderLineId) : undefined;
    if (l.orderLineId && !ol) {
      err(i, "orderLineId", "Bu kalem bu siparişe ait değil.", true);
      continue;
    }
    const sum = dec(l.qtyAccepted).plus(dec(l.qtyRejected)).plus(dec(l.qtyHeld));
    if (!sum.eq(dec(l.qtyPhysical))) {
      err(i, "qtyAccepted", `Kabul (${formatQty(l.qtyAccepted)}) + ret (${formatQty(l.qtyRejected)}) + inceleme (${formatQty(l.qtyHeld)}) = gelen miktar (${formatQty(l.qtyPhysical)}) olmalı.`, true);
    }
    if (!ol && !l.receivedVariantId && !l.receivedDesc) err(i, "receivedDesc", "Sipariş dışı gelen ürünü katalogdan seçin veya tarif edin.", true);
    const actual = l.receivedVariantId ? variants.get(l.receivedVariantId) : ol ? variants.get(ol.variantId) : undefined;
    if (l.receivedVariantId && !actual) err(i, "receivedVariantId", "Gelen ürün katalogda bulunamadı.", true);
    const flags = actual ?? (ol ? { trackExpiry: ol.trackExpiry, trackLot: ol.trackLot, minShelfLifeDays: ol.minShelfLifeDays } : { trackExpiry: false, trackLot: false, minShelfLifeDays: null });
    const different = (!!l.receivedVariantId && !!ol && l.receivedVariantId !== ol.variantId) || !l.chkProduct || !l.chkVariant || (!!l.receivedDesc && !l.receivedVariantId && !!ol);
    const expired = !!l.expiryDate && l.expiryDate < receivedOn;
    const keep = dec(l.qtyAccepted).plus(dec(l.qtyHeld));
    const remainingDays = l.expiryDate ? daysBetween(receivedOn, l.expiryDate) : null;
    const shortShelf = !expired && remainingDays !== null && flags.minShelfLifeDays !== null && remainingDays < flags.minShelfLifeDays;
    const lotMissing = flags.trackLot && !l.lotNo;

    if (expired && keep.gt(0)) err(i, "expiryDate", `Son kullanma tarihi geçmiş (${formatDate(l.expiryDate)}): bu ürün kabul edilemez ve incelemeye de alınamaz; reddedin.`, true);
    if (flags.trackExpiry && keep.gt(0) && !l.expiryDate) err(i, "expiryDate", "Bu üründe son kullanma tarihi takibi var: ambalajdaki tarihi girin.");
    if (isPositive(l.qtyAccepted)) {
      if (!ol) err(i, "qtyAccepted", "Sipariş dışı ürün doğrudan kabul edilemez; yönetim incelemesine alın veya reddedin.", true);
      else if (different) err(i, "qtyAccepted", "Siparişten farklı ürün/marka/ölçü doğrudan kabul edilemez; yönetim incelemesine alın (onayla kabul) veya reddedin.");
      if (!l.chkPackage) err(i, "qtyAccepted", "Ambalajı sağlam olmayan ürün doğrudan kabul edilemez; incelemeye alın veya reddedin.");
      if (lotMissing) err(i, "lotNo", "Lot / parti numarası olmayan ürün kabul edilemez (bu üründe lot takibi var); incelemeye alın veya reddedin.");
      if (shortShelf) err(i, "expiryDate", `Kalan kullanım süresi ${remainingDays} gün; bu ürün için en az ${flags.minShelfLifeDays} gün gerekli. Yönetim incelemesine alın.`);
    }
    if (ol && isPositive(l.qtyAccepted)) acceptedPerLine.set(ol.id, (acceptedPerLine.get(ol.id) ?? dec(0)).plus(dec(l.qtyAccepted)));
    if (dec(l.qtyRejected).plus(dec(l.qtyHeld)).gt(0) && !l.issueType) {
      l.issueType = expired ? "skt_gecmis" : !ol ? "fazla" : !l.chkProduct || !l.chkVariant ? "yanlis_urun" : different ? "farkli_marka"
        : !l.chkPackage ? "hasarli" : shortShelf ? "kisa_miat" : lotMissing ? "lot_eksik" : null;
      if (!l.issueType) err(i, "issueType", "Reddedilen veya incelemeye alınan miktar için sorun türünü seçin.");
    }
  }
  for (const [lineId, acc] of acceptedPerLine) {
    const ol = byId.get(lineId)!;
    if (acc.gt(dec(ol.pending))) {
      const i = out.find((l) => l.orderLineId === lineId)!.index;
      err(i, "qtyAccepted", `Bu kalemde bekleyen ${formatQty(ol.pending)} ${ol.unitLabel}; kabul edilen toplam ${formatQty(acc)} olamaz. Fazlasını “fazla ürün” olarak incelemeye alın veya reddedin.`);
    }
  }
  return { errors, structural, lines: out };
}

/**
 * Teslimat kontrolünü kaydeder (taslak) ya da tamamlar (post=true). Sürüm kontrolü: başkası bu arada kaydettiyse reddedilir.
 * Tamamlanınca ret/inceleme satırları için sorun kayıtları, eksik gelen kalemler için "eksik teslimat" sorunu açılır.
 */
export async function saveReceipt(ctx: Ctx, id: string, input: unknown, post: boolean): Promise<Receipt> {
  assertCan(ctx.actor, "receipt.record");
  const r = new Reader(asBody(input));
  const version = r.version();
  const receivedOn = r.optDate("receivedOn", "Teslim alma tarihi", { notAfter: ctx.today }) ?? ctx.today;
  const deliveryNoteNo = r.optText("deliveryNoteNo", "İrsaliye no", { max: 60 });
  const note = r.optText("note", "Teslimat notu", { multiline: true, max: 1000 });
  const lines = readLines(r);
  if (post && !lines.length) r.error("lines", "Kontrol edilen en az bir ürün satırı girin.");
  if (!r.ok) throw new ValidationError(r.errors);

  await ctx.db.tx(async (q) => {
    const [head] = await q.query<{ order_id: string }>(`select order_id from receipts where id = $1`, [id]);
    if (!head) throw new NotFoundError("Teslimat kaydı bulunamadı.");
    // Kilit sırası her yerde aynı: önce sipariş, sonra teslimat.
    const order = await lockRow<OrderForReceipt>(q, "purchase_orders", head.order_id, "id, order_no, status, receiver_user_id, supplier_id");
    assertReceiptAccess(ctx, order, "record");
    const rec = await lockRow<{ status: string; version: number; receipt_no: string }>(q, "receipts", id, "status, version, receipt_no");
    if (rec.status !== "taslak") throw new ConflictError("already_posted", "Bu teslimat zaten kaydedildi (başka biri tamamlamış olabilir). Miktarlar ikinci kez işlenmedi; sayfayı yenileyin.");
    if (rec.version !== version) throw new VersionConflictError();
    if (order.status !== "verildi") throw new ConflictError("not_placed", "Sipariş açık değil (kapanmış/iptal).");

    const orderLines = await orderLinesFor(q, order.id);
    const variantIds = [...new Set([...orderLines.map((l) => l.variantId), ...lines.map((l) => l.receivedVariantId).filter((x): x is string => !!x)])];
    const variants = new Map(
      (await q.query<VariantFlags>(`select id, track_expiry as "trackExpiry", track_lot as "trackLot", min_shelf_life_days as "minShelfLifeDays" from variants where id = any($1)`, [variantIds]))
        .map((v) => [v.id, v]),
    );
    const checked = checkLines(lines, orderLines, variants, receivedOn);
    // Taslakta yalnızca yapısal hatalar engeller; kabul kuralları (SKT, lot, farklı marka…) tamamlarken uygulanır.
    const blocking = post ? checked.errors : checked.structural;
    if (Object.keys(blocking).length) throw new ValidationError(blocking, post ? "Teslimat tamamlanamadı: bazı satırlarda düzeltme gerekiyor." : undefined);

    await q.query(`delete from receipt_lines where receipt_id = $1`, [id]);
    const inserted: (LineIn & { id: string })[] = [];
    for (const l of checked.lines) {
      const [row] = await q.query<{ id: string }>(
        `insert into receipt_lines (receipt_id, order_line_id, received_variant_id, received_desc, qty_physical, qty_accepted, qty_rejected, qty_held,
           check_date, lot_no, expiry_date, chk_product, chk_variant, chk_package, issue_type, issue_note, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) returning id`,
        [id, l.orderLineId, l.receivedVariantId, l.receivedDesc, l.qtyPhysical, l.qtyAccepted, l.qtyRejected, l.qtyHeld, receivedOn, l.lotNo, l.expiryDate,
          l.chkProduct, l.chkVariant, l.chkPackage, l.issueType, l.issueNote, l.note, ctx.actor.userId],
      );
      inserted.push({ ...l, id: row!.id });
    }
    await q.query(`update receipts set received_on = $2, delivery_note_no = $3, note = $4, version = version + 1, updated_at = now() where id = $1`, [
      id, receivedOn, deliveryNoteNo, note,
    ]);
    if (!post) return;

    // --- Tamamlama ---
    const created: string[] = [];
    for (const l of inserted) {
      const bad = dec(l.qtyRejected).plus(dec(l.qtyHeld));
      if (!bad.gt(0)) continue;
      const issueNo = await nextNo(q, "S", ctx.today);
      await q.query(
        `insert into delivery_issues (issue_no, order_id, order_line_id, receipt_id, receipt_line_id, type, qty, description, reported_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [issueNo, order.id, l.orderLineId, id, l.id, l.issueType, bad.toFixed(3), l.issueNote, ctx.actor.userId],
      );
      created.push(`${issueNo} ${ISSUE_TYPES.label(l.issueType)} (${formatQty(bad)})`);
    }
    // Eksik teslimat: bu teslimatta gelen kalemlerde, gelen miktar bekleyenden azsa.
    for (const ol of orderLines) {
      const mine = inserted.filter((l) => l.orderLineId === ol.id);
      if (!mine.length) continue;
      const physical = mine.reduce((a, l) => a.plus(dec(l.qtyPhysical)), dec(0));
      const shortage = dec(ol.pending).minus(physical);
      if (!shortage.gt(0)) continue;
      const [open] = await q.query<{ id: string; issue_no: string }>(`select id, issue_no from delivery_issues where order_line_id = $1 and type = 'eksik' and status = 'acik'`, [ol.id]);
      if (open) {
        await q.query(`update delivery_issues set qty = $2, receipt_id = $3, version = version + 1, updated_at = now() where id = $1`, [open.id, shortage.toFixed(3), id]);
        created.push(`${open.issue_no} eksik güncellendi (${formatQty(shortage)} ${ol.unitLabel})`);
      } else {
        const issueNo = await nextNo(q, "S", ctx.today);
        await q.query(
          `insert into delivery_issues (issue_no, order_id, order_line_id, receipt_id, type, qty, action, description, reported_by)
           values ($1, $2, $3, $4, 'eksik', $5, 'eksik_bekleniyor', $6, $7)`,
          [issueNo, order.id, ol.id, id, shortage.toFixed(3), `Siparişte bekleyen ${formatQty(ol.pending)} ${ol.unitLabel}, gelen ${formatQty(physical)}.`, ctx.actor.userId],
        );
        created.push(`${issueNo} eksik teslimat (${formatQty(shortage)} ${ol.unitLabel})`);
      }
    }
    await q.query(`update receipts set status = 'kaydedildi', posted_by = $2, posted_at = now() where id = $1`, [id, ctx.actor.userId]);
    await autoResolveShortages(q, ctx, order.id);
    const accepted = inserted.reduce((a, l) => a.plus(dec(l.qtyAccepted)), dec(0));
    const rejected = inserted.reduce((a, l) => a.plus(dec(l.qtyRejected)), dec(0));
    const held = inserted.reduce((a, l) => a.plus(dec(l.qtyHeld)), dec(0));
    await audit(q, ctx, {
      entity: "receipt", entityId: id, orderId: order.id, supplierId: order.supplier_id, action: "post",
      summary: `Teslimat ${rec.receipt_no} kaydedildi (sipariş ${order.order_no}): kabul ${formatQty(accepted)}, ret ${formatQty(rejected)}, incelemede ${formatQty(held)}${created.length ? ` · sorunlar: ${created.join("; ")}` : ""}`,
    });
  });
  return getReceipt(ctx, id);
}

/** Yanlış kaydedilmiş teslimatın ters kaydı (gerekçeli). Kabul edilen miktarlar geri alınır, bu teslimatın açık sorunları kapanır. */
export async function cancelReceipt(ctx: Ctx, id: string, input: unknown): Promise<Receipt> {
  assertCan(ctx.actor, "receipt.cancel");
  const r = new Reader(asBody(input));
  const version = r.version();
  const reason = r.text("reason", "İptal gerekçesi", { max: 500 });
  if (!r.ok) throw new ValidationError(r.errors);
  await ctx.db.tx(async (q) => {
    const [head] = await q.query<{ order_id: string }>(`select order_id from receipts where id = $1`, [id]);
    if (!head) throw new NotFoundError("Teslimat kaydı bulunamadı.");
    const order = await lockRow<OrderForReceipt>(q, "purchase_orders", head.order_id, "id, order_no, status, receiver_user_id, supplier_id");
    const rec = await lockRow<{ status: string; version: number; receipt_no: string }>(q, "receipts", id, "status, version, receipt_no");
    if (rec.version !== version) throw new VersionConflictError();
    if (order.status !== "verildi") throw new ConflictError("closed", "Kapanmış siparişin teslimatı iptal edilemez.");
    if (rec.status === "iptal") throw new ConflictError("canceled", "Bu teslimat zaten iptal edilmiş.");
    if ((await q.query(`select 1 from delivery_issues where receipt_id = $1 and status = 'cozuldu' and type <> 'eksik'`, [id])).length) {
      throw new ConflictError("resolved_issues", "Bu teslimatın karara bağlanmış sorunları var (ör. alternatif kabul). İptal yerine yeni bir düzeltme teslimatı girin veya yönetimle görüşün.");
    }
    await q.query(`update receipts set status = 'iptal', canceled_by = $2, canceled_at = now(), cancel_reason = $3, version = version + 1, updated_at = now() where id = $1`, [
      id, ctx.actor.userId, reason,
    ]);
    await q.query(
      `update delivery_issues set status = 'cozuldu', action = 'iptal', resolved_by = $2, resolved_at = now(), resolution_note = $3, version = version + 1, updated_at = now()
       where receipt_id = $1 and status = 'acik' and type <> 'eksik'`,
      [id, ctx.actor.userId, `Teslimat kaydı iptal edildi (ters kayıt): ${reason}`],
    );
    await audit(q, ctx, { entity: "receipt", entityId: id, orderId: order.id, supplierId: order.supplier_id, action: "cancel", summary: `Teslimat ${rec.receipt_no} iptal edildi (ters kayıt): ${reason}` });
  });
  return getReceipt(ctx, id);
}

/** Teslimat sorumlusunun iş listesi: kendisine atanmış, teslimatı beklenen siparişler. */
export async function myDeliveries(ctx: Ctx): Promise<{ orderId: string; orderNo: string; supplierName: string; expectedOn: string | null; pendingLines: number; draftReceiptId: string | null }[]> {
  assertCan(ctx.actor, "receipt.record");
  const all = can(ctx.actor, "order.manage");
  return ctx.db.query(
    `select po.id as "orderId", po.order_no as "orderNo", s.name as "supplierName", po.expected_on as "expectedOn",
       (select count(*) from order_lines ol ${LINE_STATS} where ol.order_id = po.id and ol.qty - ol.canceled_qty - st.accepted > 0) as "pendingLines",
       (select id from receipts where order_id = po.id and status = 'taslak') as "draftReceiptId"
     from purchase_orders po join suppliers s on s.id = po.supplier_id
     where po.status = 'verildi' ${all ? "" : "and po.receiver_user_id = $1"}
     order by po.expected_on nulls last, po.order_no`,
    all ? [] : [ctx.actor.userId],
  );
}

export const isReceiptId = isUuid;
