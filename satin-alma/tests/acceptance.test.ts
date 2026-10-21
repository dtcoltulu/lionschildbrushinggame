/**
 * Kabul senaryoları (servis katmanı, gerçek SQL şemasıyla). Numaralar istekteki kabul listesidir.
 * Arayüz/HTTP tarafı (mobil akış, API'nin 403 dönmesi, eşzamanlı HTTP istekleri) e2e testlerindedir.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, monthKey } from "@/lib/dates";
import { dec } from "@/lib/decimal";
import { ForbiddenError } from "@/server/errors";
import { createAdjustment, approveAdjustment, listAdjustments } from "@/server/services/adjustments";
import { supplierBalances } from "@/server/services/balances";
import { priceHistory, lastPurchase } from "@/server/services/catalog";
import { cancelInvoice, createInvoice, createOpeningBalance, getInvoice, listInvoices, reviewInvoice } from "@/server/services/invoices";
import { getIssue, listIssues, resolveIssue, updateIssue } from "@/server/services/issues";
import { closeOrder, getOrder, orderMessage, placeOrder, planToOrder, cancelRemaining } from "@/server/services/orders";
import { allocatePayment, cancelPayment, createPayment, getPayment, listPayments } from "@/server/services/payments";
import { monthlyReport, spendReport } from "@/server/services/reports";
import { getReceipt, saveReceipt, startReceipt } from "@/server/services/receipts";
import { createRequest, getRequest, listRequests, matchRequest } from "@/server/services/requests";
import { expectError, inDays, TODAY, world, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await world();
});
afterAll(async () => w.db.close());

/** Yardımcı: verilmiş bir sipariş (tek kalem) */
async function placedOrder(variantId: string, qty: string, price: string, opts: { supplierId?: string; requestId?: string; qtyBase?: string; vatRate?: string } = {}) {
  const { orderId } = await planToOrder(w.satinalma, {
    supplierId: opts.supplierId ?? w.supplierA, variantId, qty, unitPrice: price, vatRate: opts.vatRate ?? "10",
    allocations: opts.requestId ? [{ requestId: opts.requestId, qtyBase: opts.qtyBase }] : [],
  });
  const o = await getOrder(w.satinalma, orderId);
  await placeOrder(w.satinalma, orderId, { version: o.version, channel: "whatsapp", expectedOn: inDays(3), receiverUserId: w.teslimat.actor.userId });
  return getOrder(w.satinalma, orderId);
}

async function receive(orderId: string, lines: Record<string, unknown>[], who = w.teslimat) {
  const { id } = await startReceipt(who, orderId);
  const r = await getReceipt(who, id);
  return saveReceipt(who, id, { version: r.version, receivedOn: TODAY, lines }, true);
}

describe("1. Asistan 10 kutu eldiven ister, yönetim tedarikçi seçip sipariş verir", () => {
  let requestId: string;
  let orderId: string;

  it("asistanın hızlı talebi: talep eden ve tarih otomatik; çift gönderim tek kayıt", async () => {
    const key = "11111111-1111-4111-8111-111111111111";
    const body = { variantId: w.gloveM, qty: "10", unitKind: "siparis", stockState: "bitti", urgency: "acil", locationId: w.location, note: "Ünit 1'de bitti", idempotencyKey: key };
    const r = await createRequest(w.asistan, body);
    const again = await createRequest(w.asistan, body);
    expect(again.id).toBe(r.id);
    expect(r.requesterName).toBe("Test Asistan");
    expect(r.requestNo).toMatch(/^T-\d{4}-0001$/);
    expect(r.unitLabel).toBe("kutu");
    expect(dec(r.needBase).eq(1000)).toBe(true);
    expect(r.progress).toBe("degerlendirme");
    requestId = r.id;
  });

  it("aynı ürün için açık talep varsa uyarı; gerekçeyle ek talep açılabilir", async () => {
    const e = await expectError(createRequest(w.asistan, { variantId: w.gloveM, qty: "2", unitKind: "siparis", stockState: "azaldi" }), 409, "duplicate_open");
    expect((e.data as { openNeeds: { requests: unknown[] } }).openNeeds.requests).toHaveLength(1);
    const extra = await createRequest(w.asistan, { variantId: w.gloveM, qty: "2", unitKind: "siparis", stockState: "azaldi", extraNeedReason: "Cerrahi oda için ayrıca" });
    expect(extra.extraNeedReason).toBe("Cerrahi oda için ayrıca");
  });

  it("yönetim tedarikçiyi ve fiyatı seçip siparişi verir; kullanıcı, tarih ve kanal kaydedilir", async () => {
    const o = await placedOrder(w.gloveM, "10", "250", { requestId, qtyBase: "1000" });
    orderId = o.id;
    expect(o.status).toBe("verildi");
    expect(o.placedByName).toBe("Test Satın Alma");
    expect(o.placedChannel).toBe("whatsapp");
    expect(o.placedAt).toBeTruthy();
    expect(o.receiverName).toBe("Test Teslimat");
    expect(o.orderNo).toMatch(/^SA-\d{4}-\d{4}$/);
    expect(o.totals).toEqual({ net: "2500.00", vat: "250.00", total: "2750.00" });
    expect(o.lines[0]!.allocations.map((a) => a.requestId)).toEqual([requestId]);
    const req = await getRequest(w.asistan, requestId);
    expect(req.status).toBe("onaylandi");
    expect(req.progress).toBe("sipariste");
    const text = await orderMessage(w.satinalma, orderId, false);
    expect(text).toContain("10 kutu");
    expect(text).toContain("1 kutu = 100 adet");
    expect(text).not.toContain("250");
  });

  it("sipariş vermek borç yaratmaz: açık satın alma taahhüdü olarak ayrı görünür", async () => {
    const [b] = (await supplierBalances(w.finans, { supplierId: w.supplierA })).filter((x) => x.currency === "TRY");
    expect(b!.balance).toBe("0.00");
    expect(b!.commitment).toBe("2750.00");
  });

  it("asistan yalnızca kendi taleplerini görür", async () => {
    const other = await createRequest(w.teslimat, { tempProductText: "Örnek katalog dışı ürün", qty: "1", unitLabel: "adet", stockState: "azaldi" });
    const mine = await listRequests(w.asistan, {});
    expect(mine.every((r) => r.requesterName === "Test Asistan")).toBe(true);
    await expectError(getRequest(w.asistan, other.id), 403);
    const all = await listRequests(w.satinalma, {});
    expect(all.some((r) => r.id === other.id)).toBe(true);
  });

  (globalThis as { __order1?: () => string }).__order1 = () => orderId;
});

describe("2–3. Kısmi teslimat, yanlış beden, eksiklerin sonraki teslimatla tamamlanması", () => {
  let order: Awaited<ReturnType<typeof placedOrder>>;
  let lineId: string;

  beforeAll(async () => {
    order = await placedOrder(w.gloveM, "10", "250");
    lineId = order.lines[0]!.id;
  });

  it("“ürün geldi” siparişi tamamlamaz; yanlış beden doğrudan kabul edilemez", async () => {
    const { id } = await startReceipt(w.teslimat, order.id);
    const r = await getReceipt(w.teslimat, id);
    await expectError(
      saveReceipt(w.teslimat, id, { version: r.version, lines: [{ orderLineId: lineId, receivedVariantId: w.gloveL, chkVariant: false, qtyPhysical: "1", qtyAccepted: "1" }] }, true),
      422,
    );
    expect((await getOrder(w.satinalma, order.id)).status).toBe("verildi");
  });

  it("6 kutu gelir: 5 doğru kabul, 1 yanlış beden ret; 5 kutu açık kalır", async () => {
    const { id } = await startReceipt(w.teslimat, order.id);
    const r = await getReceipt(w.teslimat, id);
    const saved = await saveReceipt(w.teslimat, id, {
      version: r.version, receivedOn: TODAY, deliveryNoteNo: "IRS-1",
      lines: [
        { orderLineId: lineId, qtyPhysical: "5", qtyAccepted: "5" },
        { orderLineId: lineId, receivedVariantId: w.gloveL, chkVariant: false, qtyPhysical: "1", qtyRejected: "1", issueType: "yanlis_urun", issueNote: "M yerine L beden geldi" },
      ],
    }, true);
    expect(saved.status).toBe("kaydedildi");
    const o = await getOrder(w.satinalma, order.id);
    const l = o.lines[0]!;
    expect([l.qty, l.physical, l.accepted, l.rejected, l.pending].map((x) => dec(x).toNumber())).toEqual([10, 6, 5, 1, 5]);
    expect(o.status).toBe("verildi");
    expect(o.deliveryState).toBe("kismi");
    const types = o.issues.map((i) => `${i.type}:${dec(i.qty!).toNumber()}:${i.status}`).sort();
    expect(types).toEqual(["eksik:4:acik", "yanlis_urun:1:acik"]);
    // Gerçek gelen ürün kaydedildi; sipariş kalemi değişmedi
    expect(saved.lines.find((x) => x.qtyRejected !== "0.000")!.receivedVariantId).toBe(w.gloveL);
    expect(o.lines[0]!.variantId).toBe(w.gloveM);
  });

  it("çözülmemiş sorun ve bekleyen miktar varken normal kapanış yapılamaz", async () => {
    const o = await getOrder(w.satinalma, order.id);
    const e = await expectError(closeOrder(w.satinalma, order.id, { version: o.version }), 409, "cannot_close");
    expect(JSON.stringify(e.data)).toContain("Teslim alınmamış miktar");
  });

  it("sonraki teslimat eksikleri tamamlar; eksik sorunu kendiliğinden kapanır, yanlış ürünün değişimi ayrıca izlenir", async () => {
    await receive(order.id, [{ orderLineId: lineId, qtyPhysical: "5", qtyAccepted: "5" }]);
    const o = await getOrder(w.satinalma, order.id);
    expect(dec(o.lines[0]!.pending).toNumber()).toBe(0);
    expect(dec(o.lines[0]!.accepted).toNumber()).toBe(10);
    expect(o.deliveryState).toBe("tamam");
    const eksik = o.issues.find((i) => i.type === "eksik")!;
    expect(eksik.status).toBe("cozuldu");
    const wrong = o.issues.find((i) => i.type === "yanlis_urun")!;
    expect(wrong.status).toBe("acik");
    // Değişim: ürün tedarikçiye geri verilmeden çözülemez
    let issue = await getIssue(w.satinalma, wrong.id);
    await expectError(resolveIssue(w.satinalma, wrong.id, { version: issue.version, action: "degisim", note: "Doğru beden geldi" }), 422);
    issue = await updateIssue(w.teslimat, wrong.id, { version: issue.version, returnedOn: TODAY, description: issue.description });
    expect(issue.returnedOn).toBe(TODAY);
    await resolveIssue(w.satinalma, wrong.id, { version: issue.version, action: "degisim", note: "L beden kutu kuryeyle geri verildi, doğrusu 2. teslimatta geldi" });
    const closed = await closeOrder(w.satinalma, order.id, { version: (await getOrder(w.satinalma, order.id)).version });
    expect(closed.status).toBe("kapandi");
  });

  it("gelmeyecek kalan miktar ancak gerekçeyle iptal edilir; iptal edilen kabul sayılmaz", async () => {
    const o2 = await placedOrder(w.gloveM, "4", "250");
    await receive(o2.id, [{ orderLineId: o2.lines[0]!.id, qtyPhysical: "3", qtyAccepted: "3" }]);
    await expectError(cancelRemaining(w.satinalma, o2.id, { reason: "" }), 422);
    await cancelRemaining(w.satinalma, o2.id, { reason: "Tedarikçide stok kalmadı" });
    const o = await getOrder(w.satinalma, o2.id);
    expect([o.lines[0]!.accepted, o.lines[0]!.canceledQty, o.lines[0]!.pending].map((x) => dec(x).toNumber())).toEqual([3, 1, 0]);
    expect(o.issues.find((i) => i.type === "eksik")!.status).toBe("cozuldu");
    expect((await closeOrder(w.satinalma, o2.id, { version: o.version })).status).toBe("kapandi");
  });
});

describe("4. Son kullanma tarihi geçmiş ürün kabul edilemez; kısa miatlı ürün yönetim incelemesine düşer", () => {
  let order: Awaited<ReturnType<typeof placedOrder>>;
  beforeAll(async () => {
    order = await placedOrder(w.composite, "10", "300", { vatRate: "20" });
  });

  it("SKT geçmiş: kabul de inceleme de reddedilir; yalnızca ret kaydı + sorun", async () => {
    const lineId = order.lines[0]!.id;
    const { id } = await startReceipt(w.teslimat, order.id);
    const r = await getReceipt(w.teslimat, id);
    const expired = addDays(TODAY, -1);
    await expectError(saveReceipt(w.teslimat, id, { version: r.version, lines: [{ orderLineId: lineId, qtyPhysical: "2", qtyAccepted: "2", lotNo: "L1", expiryDate: expired }] }, true), 422);
    await expectError(saveReceipt(w.teslimat, id, { version: r.version, lines: [{ orderLineId: lineId, qtyPhysical: "2", qtyHeld: "2", lotNo: "L1", expiryDate: expired }] }, true), 422);
    // Taslak olarak bile kaydedilemez (veritabanı kısıtına karşılık gelir)
    await expectError(saveReceipt(w.teslimat, id, { version: r.version, lines: [{ orderLineId: lineId, qtyPhysical: "2", qtyAccepted: "2", lotNo: "L1", expiryDate: expired }] }, false), 422);
    const saved = await saveReceipt(w.teslimat, id, { version: r.version, lines: [{ orderLineId: lineId, qtyPhysical: "2", qtyRejected: "2", lotNo: "L1", expiryDate: expired }] }, true);
    expect(saved.issues.map((i) => i.type)).toContain("skt_gecmis");
    const o = await getOrder(w.satinalma, order.id);
    expect(dec(o.lines[0]!.accepted).toNumber()).toBe(0);
    expect(dec(o.lines[0]!.pending).toNumber()).toBe(10);
  });

  it("veritabanı da SKT geçmiş ürünün kabulünü reddeder (doğrudan SQL)", async () => {
    const [rc] = await w.db.query<{ id: string }>(`select id from receipts where order_id = $1 limit 1`, [order.id]);
    await expect(
      w.db.query(
        `insert into receipt_lines (clinic_id, receipt_id, order_line_id, qty_physical, qty_accepted, check_date, expiry_date, created_by)
         values ('00000000-0000-4000-8000-000000000001', $1, $2, 1, 1, $3, $4, $5)`,
        [rc!.id, order.lines[0]!.id, TODAY, addDays(TODAY, -5), w.teslimat.actor.userId],
      ),
    ).rejects.toThrow(/receipt_lines_expired_chk/);
  });

  it("lot numarası ve SKT zorunlu; raf ömrü sınırın altındaysa doğrudan kabul yok, incelemeye düşer ve yönetim karar verir", async () => {
    const lineId = order.lines[0]!.id;
    const { id } = await startReceipt(w.teslimat, order.id);
    const r = await getReceipt(w.teslimat, id);
    await expectError(saveReceipt(w.teslimat, id, { version: r.version, lines: [{ orderLineId: lineId, qtyPhysical: "3", qtyAccepted: "3", expiryDate: inDays(400) }] }, true), 422);
    await expectError(saveReceipt(w.teslimat, id, { version: r.version, lines: [{ orderLineId: lineId, qtyPhysical: "3", qtyAccepted: "3", lotNo: "L2" }] }, true), 422);
    await expectError(saveReceipt(w.teslimat, id, { version: r.version, lines: [{ orderLineId: lineId, qtyPhysical: "3", qtyAccepted: "3", lotNo: "L2", expiryDate: inDays(60) }] }, true), 422);
    // Aynı üründen farklı lot ve SKT ile iki satır: biri uygun (kabul), biri kısa miatlı (inceleme)
    const saved = await saveReceipt(w.teslimat, id, {
      version: r.version,
      lines: [
        { orderLineId: lineId, qtyPhysical: "5", qtyAccepted: "5", lotNo: "L3", expiryDate: inDays(500) },
        { orderLineId: lineId, qtyPhysical: "3", qtyHeld: "3", lotNo: "L2", expiryDate: inDays(60) },
      ],
    }, true);
    const held = saved.issues.find((i) => i.type === "kisa_miat")!;
    expect(held).toBeTruthy();
    let o = await getOrder(w.satinalma, order.id);
    expect([o.lines[0]!.accepted, o.lines[0]!.held, o.lines[0]!.pending].map((x) => dec(x).toNumber())).toEqual([5, 3, 5]);
    // Teslimat sorumlusu karar veremez
    const issue = await getIssue(w.satinalma, held.id);
    await expectError(resolveIssue(w.teslimat, held.id, { version: issue.version, action: "kabul", note: "x" }), 403);
    await resolveIssue(w.satinalma, held.id, { version: issue.version, action: "kabul", note: "Bu ay kullanılacak, kabul" });
    o = await getOrder(w.satinalma, order.id);
    expect([o.lines[0]!.accepted, o.lines[0]!.held, o.lines[0]!.pending].map((x) => dec(x).toNumber())).toEqual([8, 0, 2]);
  });

  it("farklı marka yönetim onayıyla kabul edilir; gerçek gelen ürün kaydedilir, sipariş değişmez", async () => {
    const o1 = await placedOrder(w.gloveM, "2", "250");
    const saved = await receive(o1.id, [{ orderLineId: o1.lines[0]!.id, receivedVariantId: w.gloveL, chkVariant: false, qtyPhysical: "2", qtyHeld: "2", issueType: "farkli_marka" }]);
    const iss = saved.issues[0]!;
    const before = await getIssue(w.satinalma, iss.id);
    await resolveIssue(w.satinalma, iss.id, { version: before.version, action: "alternatif_kabul", note: "L beden de kullanılabilir" });
    const o = await getOrder(w.satinalma, o1.id);
    expect(o.lines[0]!.variantId).toBe(w.gloveM);
    expect(dec(o.lines[0]!.accepted).toNumber()).toBe(2);
    const r = await getReceipt(w.satinalma, saved.id);
    expect(r.lines[0]!.receivedVariantId).toBe(w.gloveL);
  });
});

describe("5–7. Fatura karşılaştırma, kısmi ödeme, tekrar kaydın engellenmesi", () => {
  let order: Awaited<ReturnType<typeof placedOrder>>;
  let invoiceId: string;

  beforeAll(async () => {
    order = await placedOrder(w.gloveM, "10", "250", { supplierId: w.supplierB });
    await receive(order.id, [{ orderLineId: order.lines[0]!.id, qtyPhysical: "10", qtyAccepted: "10" }]);
  });

  it("5. faturadaki fiyat siparişten farklıysa uyarı oluşur; borç yine tam fatura tutarıdır", async () => {
    const res = await createInvoice(w.finans, {
      supplierId: w.supplierB, invoiceNo: "ABC-2026-001", invoiceDate: TODAY, dueDate: inDays(30), declaredTotal: "2805.00",
      lines: [{ orderLineId: order.lines[0]!.id, qty: "10", unitPrice: "255", vatRate: "10" }],
    });
    invoiceId = res.id;
    expect(res.reviewStatus).toBe("inceleme_bekliyor");
    expect(res.discrepancies.map((d) => d.kind)).toEqual(["fiyat"]);
    expect(res.discrepancies[0]!.message).toMatch(/255,00 TL.*250,00 TL/);
    const inv = await getInvoice(w.finans, invoiceId);
    expect(inv.total).toBe("2805.00");
    expect(inv.open).toBe("2805.00");
    const [b] = await supplierBalances(w.finans, { supplierId: w.supplierB });
    expect(b!.balance).toBe("2805.00");
    expect(b!.commitment).toBe("0.00");
    expect((await listInvoices(w.finans, { view: "inceleme" })).map((i) => i.id)).toContain(invoiceId);
    await reviewInvoice(w.finans, invoiceId, { version: inv.version, decision: "onaylandi", note: "Yeni fiyat listesi, tedarikçiyle konuşuldu" });
    expect((await getInvoice(w.finans, invoiceId)).reviewStatus).toBe("onaylandi");
  });

  it("teslim alınandan fazla faturalanırsa ve toplam tutmazsa uyarı", async () => {
    const o = await placedOrder(w.gloveM, "5", "250", { supplierId: w.supplierB });
    const res = await createInvoice(w.finans, {
      supplierId: w.supplierB, invoiceNo: "ABC-2026-002", invoiceDate: TODAY, declaredTotal: "1400.00",
      lines: [{ orderLineId: o.lines[0]!.id, qty: "5", unitPrice: "250", vatRate: "10" }],
    });
    expect(res.discrepancies.map((d) => d.kind).sort()).toEqual(["miktar_teslim", "toplam"]);
  });

  it("6. kısmi ödeme faturanın kalan borcunu doğru azaltır; faturaya bağlanmamış kısım avans olarak izlenir", async () => {
    await expectError(createPayment(w.finans, { supplierId: w.supplierB, paidOn: TODAY, amount: "3000", currency: "TRY", method: "havale_eft", allocations: [{ invoiceId, amount: "3000" }] }), 422);
    const p = await createPayment(w.finans, { supplierId: w.supplierB, paidOn: TODAY, amount: "1500", currency: "TRY", method: "havale_eft", reference: "EFT-1", allocations: [{ invoiceId, amount: "1000.50" }] });
    const inv = await getInvoice(w.finans, invoiceId);
    expect(inv.allocated).toBe("1000.50");
    expect(inv.open).toBe("1804.50");
    const pay = await getPayment(w.finans, p.id);
    expect(pay.unallocated).toBe("499.50");
    expect((await listPayments(w.finans, { view: "avans" })).map((x) => x.id)).toContain(p.id);
    await allocatePayment(w.finans, p.id, { allocations: [{ invoiceId, amount: "499.50" }] });
    expect((await getInvoice(w.finans, invoiceId)).open).toBe("1305.00");
    // Ödeme iptali (ters kayıt): dağıtım kalkar, kalan geri gelir
    await cancelPayment(w.finans, p.id, { version: pay.version, reason: "Yanlış tedarikçiye girildi" });
    expect((await getInvoice(w.finans, invoiceId)).open).toBe("2805.00");
    const p2 = await createPayment(w.finans, { supplierId: w.supplierB, paidOn: TODAY, amount: "805", currency: "TRY", method: "nakit", allocations: [{ invoiceId, amount: "805" }] });
    expect((await getInvoice(w.finans, invoiceId)).open).toBe("2000.00");
    expect((await getPayment(w.finans, p2.id)).unallocated).toBe("0.00");
  });

  it("7. aynı faturanın tekrar kaydı engellenir (yazım farkı olsa da); başka tedarikçide aynı numara serbest", async () => {
    const lines = [{ variantId: w.gloveM, qty: "1", unitPrice: "250", vatRate: "10" }];
    const e = await expectError(createInvoice(w.finans, { supplierId: w.supplierB, invoiceNo: "abc 2026 001", invoiceDate: TODAY, lines }), 409, "duplicate_invoice");
    expect(e.message).toMatch(/zaten kayıtlı/);
    const other = await createInvoice(w.finans, { supplierId: w.supplierA, invoiceNo: "ABC-2026-001", invoiceDate: TODAY, lines });
    expect(other.id).toBeTruthy();
    // Aynı anda iki kez gönderilse de tek kayıt
    const both = await Promise.allSettled([1, 2].map(() => createInvoice(w.finans, { supplierId: w.supplierB, invoiceNo: "XYZ-9", invoiceDate: TODAY, lines })));
    expect(both.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    // İptal edilen (gerekçeli) fatura bakiyeden çıkar ama kaybolmaz; doğrusu yeniden girilebilir
    const inv = await getInvoice(w.finans, other.id);
    await cancelInvoice(w.finans, other.id, { version: inv.version, reason: "Yanlış tedarikçiye girildi" });
    expect((await listInvoices(w.finans, { view: "iptal" })).map((i) => i.id)).toContain(other.id);
    const again = await createInvoice(w.finans, { supplierId: w.supplierA, invoiceNo: "ABC-2026-001", invoiceDate: TODAY, lines });
    expect(again.id).not.toBe(other.id);
  });

  it("fiziksel iade borcu düşürmez; onaylı finansal düzeltme düşürür", async () => {
    const [before] = await supplierBalances(w.finans, { supplierId: w.supplierB });
    const { id } = await createAdjustment(w.finans, { supplierId: w.supplierB, adjDate: TODAY, currency: "TRY", type: "iade_faturasi", direction: "borc_azaltir", netAmount: "100", vatAmount: "10", description: "1 kutu iade", invoiceId });
    expect((await supplierBalances(w.finans, { supplierId: w.supplierB }))[0]!.balance).toBe(before!.balance);
    const [a] = (await listAdjustments(w.finans, {})).filter((x) => x.id === id);
    await approveAdjustment(w.finans, id, { version: a!.version });
    const after = (await supplierBalances(w.finans, { supplierId: w.supplierB }))[0]!;
    expect(dec(before!.balance).minus(dec(after.balance)).toFixed(2)).toBe("110.00");
    expect((await getInvoice(w.finans, invoiceId)).open).toBe("1890.00");
  });

  it("açılış borcu tarih ve açıklamayla girilir; bakiyeye eklenir ve ödenebilir", async () => {
    const { id } = await createOpeningBalance(w.finans, { supplierId: w.supplierA, date: addDays(TODAY, -40), amount: "5000", currency: "TRY", description: "Eski cari ekstre" });
    await expectError(createOpeningBalance(w.finans, { supplierId: w.supplierA, date: TODAY, amount: "1", currency: "TRY", description: "x" }), 409);
    await createPayment(w.finans, { supplierId: w.supplierA, paidOn: TODAY, amount: "2000", currency: "TRY", method: "havale_eft", allocations: [{ invoiceId: id, amount: "2000" }] });
    const b = (await supplierBalances(w.finans, { supplierId: w.supplierA })).find((x) => x.currency === "TRY")!;
    expect(b.opening).toBe("5000.00");
    expect(dec(b.balance).toFixed(2)).toBe(dec(b.opening).plus(dec(b.invoiced)).plus(dec(b.adjustments)).minus(dec(b.paid)).toFixed(2));
  });

  it("farklı para birimleri toplanmaz; döviz faturası kendi bakiyesinde, TL karşılığı yalnızca kurla", async () => {
    await createInvoice(w.finans, {
      supplierId: w.supplierA, invoiceNo: "EUR-1", invoiceDate: TODAY, currency: "EUR", fxRate: "38.5", fxDate: TODAY, fxSource: "TCMB döviz satış",
      lines: [{ description: "İthal implant sarfı", qty: "2", unitPrice: "100", vatRate: "20" }],
    });
    const rows = await supplierBalances(w.finans, { supplierId: w.supplierA });
    expect(rows.map((r) => r.currency).sort()).toEqual(["EUR", "TRY"]);
    expect(rows.find((r) => r.currency === "EUR")!.balance).toBe("240.00");
    await expectError(createInvoice(w.finans, { supplierId: w.supplierA, invoiceNo: "EUR-2", invoiceDate: TODAY, currency: "EUR", fxRate: "38.5", lines: [{ description: "x", qty: "1", unitPrice: "1", vatRate: "0" }] }), 422);
  });
});

describe("8. Asistan ve teslimat sorumlusu finansal verilere sunucuda da erişemez", () => {
  it("fatura, ödeme, bakiye, rapor ve düzeltme servisleri 403", async () => {
    for (const ctx of [w.asistan, w.teslimat]) {
      const calls: Promise<unknown>[] = [
        listInvoices(ctx), supplierBalances(ctx), listPayments(ctx), listAdjustments(ctx), monthlyReport(ctx, { from: TODAY, to: TODAY }),
        spendReport(ctx, { from: TODAY, to: TODAY }, "urun"), priceHistory(ctx, w.gloveM),
        createPayment(ctx, { supplierId: w.supplierA, paidOn: TODAY, amount: "1", currency: "TRY", method: "nakit" }),
      ];
      for (const c of calls) await expect(c).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("teslimat sorumlusu yalnızca atandığı siparişi görür ve fiyatları görmez; asistan siparişleri göremez", async () => {
    const o = await placedOrder(w.gloveM, "1", "250");
    const seen = await getOrder(w.teslimat, o.id);
    expect(seen.lines[0]!.unitPrice).toBeNull();
    expect(seen.totals).toBeNull();
    await expect(getOrder(w.asistan, o.id)).rejects.toBeInstanceOf(ForbiddenError);
    const { orderId: id } = await planToOrder(w.satinalma, { supplierId: w.supplierA, variantId: w.gloveL, qty: "1", unitPrice: "1", vatRate: "10" });
    const d = await getOrder(w.satinalma, id);
    await placeOrder(w.satinalma, id, { version: d.version, channel: "telefon", expectedOn: inDays(2), receiverUserId: w.satinalma.actor.userId });
    await expectError(getOrder(w.teslimat, id), 404);
    await expectError(startReceipt(w.teslimat, id), 403);
  });
});

describe("9. İki kullanıcı aynı teslimatı eşzamanlı kaydederse miktarlar iki kez işlenmez", () => {
  it("aynı anda başlatma tek kontrol kaydı; aynı anda tamamlama tek kez işlenir", async () => {
    const o = await placedOrder(w.gloveM, "6", "250");
    const [a, b] = await Promise.all([startReceipt(w.teslimat, o.id), startReceipt(w.satinalma, o.id)]);
    expect(a.id).toBe(b.id);
    const r = await getReceipt(w.teslimat, a.id);
    const body = { version: r.version, lines: [{ orderLineId: o.lines[0]!.id, qtyPhysical: "6", qtyAccepted: "6" }] };
    const results = await Promise.allSettled([saveReceipt(w.teslimat, a.id, body, true), saveReceipt(w.satinalma, a.id, body, true)]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(["already_posted", "version_conflict"]).toContain((rejected.reason as { code: string }).code);
    const after = await getOrder(w.satinalma, o.id);
    expect(dec(after.lines[0]!.accepted).toNumber()).toBe(6);
    expect(after.receipts.filter((x) => x.status === "kaydedildi")).toHaveLength(1);
    // Kaydedilmiş teslimat yeniden gönderilirse reddedilir
    await expectError(saveReceipt(w.teslimat, a.id, body, true), 409);
    expect(dec((await getOrder(w.satinalma, o.id)).lines[0]!.accepted).toNumber()).toBe(6);
  });

  it("bekleyenden fazla kabul edilemez (fazlası incelemeye)", async () => {
    const o = await placedOrder(w.gloveM, "2", "250");
    const { id } = await startReceipt(w.teslimat, o.id);
    const r = await getReceipt(w.teslimat, id);
    await expectError(saveReceipt(w.teslimat, id, { version: r.version, lines: [{ orderLineId: o.lines[0]!.id, qtyPhysical: "3", qtyAccepted: "3" }] }, true), 422);
    const saved = await saveReceipt(w.teslimat, id, { version: r.version, lines: [{ orderLineId: o.lines[0]!.id, qtyPhysical: "3", qtyAccepted: "2", qtyHeld: "1", issueType: "fazla" }] }, true);
    expect(saved.issues.map((i) => i.type)).toEqual(["fazla"]);
  });
});

describe("10. Aylık sipariş, satın alma ve ödeme toplamları birbirinden ayrılır", () => {
  it("üç rakam ayrı tarih temeline göre hesaplanır", async () => {
    const lw = await world();
    try {
      const { orderId } = await planToOrder(lw.satinalma, { supplierId: lw.supplierA, variantId: lw.gloveM, qty: "4", unitPrice: "100", vatRate: "10" });
      const d = await getOrder(lw.satinalma, orderId);
      await placeOrder(lw.satinalma, orderId, { version: d.version, channel: "telefon", expectedOn: inDays(1), receiverUserId: lw.teslimat.actor.userId });
      const lastMonthDay = addDays(`${monthKey(TODAY)}-01`, -3);
      const inv = await createInvoice(lw.finans, { supplierId: lw.supplierA, invoiceNo: "F-1", invoiceDate: lastMonthDay, lines: [{ variantId: lw.gloveM, qty: "10", unitPrice: "50", vatRate: "10" }] });
      await createPayment(lw.finans, { supplierId: lw.supplierA, paidOn: TODAY, amount: "200", currency: "TRY", method: "havale_eft", allocations: [{ invoiceId: inv.id, amount: "200" }] });
      const adj = await createAdjustment(lw.finans, { supplierId: lw.supplierA, adjDate: TODAY, currency: "TRY", type: "fiyat_farki", direction: "borc_azaltir", netAmount: "20", vatAmount: "2", description: "Fiyat farkı" });
      const [a] = await listAdjustments(lw.finans, {});
      await approveAdjustment(lw.finans, adj.id, { version: a!.version });
      const rows = await monthlyReport(lw.finans, { from: lastMonthDay, to: TODAY });
      const prev = rows.find((r) => r.month === monthKey(lastMonthDay) && r.currency === "TRY")!;
      const cur = rows.find((r) => r.month === monthKey(TODAY) && r.currency === "TRY")!;
      expect(prev.ordered.total).toBe("0.00");
      expect(prev.invoiced).toEqual({ net: "500.00", vat: "50.00", total: "550.00" });
      expect(prev.paid).toBe("0.00");
      expect(cur.ordered).toEqual({ net: "400.00", vat: "40.00", total: "440.00" });
      expect(cur.invoiced.total).toBe("0.00");
      expect(cur.adjustments).toEqual({ net: "-20.00", vat: "-2.00", total: "-22.00" });
      expect(cur.netPurchase.total).toBe("-22.00");
      expect(cur.paid).toBe("200.00");
      // Ürün bazında harcama yalnızca fatura kalemlerinden; ödeme ürünlere dağıtılmaz
      const spend = await spendReport(lw.finans, { from: lastMonthDay, to: TODAY }, "urun");
      expect(spend).toHaveLength(1);
      expect(spend[0]!.net).toBe("500.00");
      expect(spend[0]!.qty).toBe("10");
    } finally {
      await lw.db.close();
    }
  });
});

describe("Katalog dışı talep ve fiyat geçmişi", () => {
  it("yönetim katalog dışı talebi mevcut ürünle eşleştirir; son satın alma fiyatı görünür", async () => {
    const r = await createRequest(w.asistan, { tempProductText: "Mavi nitril eldiven orta boy", qty: "200", unitLabel: "adet", stockState: "azaldi" });
    expect(r.progress).toBe("eslestirme");
    const m = await matchRequest(w.satinalma, r.id, { version: r.version, variantId: w.gloveM, unitKind: "temel" });
    expect(m.variantId).toBe(w.gloveM);
    expect(dec(m.needBase).toNumber()).toBe(200);
    const hist = await priceHistory(w.satinalma, w.gloveM);
    const last = lastPurchase(hist)!;
    expect(last.source).toBe("fatura");
    // En son fatura: A deposunun yeniden girilen faturası (kutu 250 TL → adet 2,50 TL, KDV hariç)
    expect(last.supplierName).toBe("Test Dental Depo A");
    expect(last.perBaseUnitExcl).toBe("2.5000");
    expect(hist.some((h) => h.source === "fatura" && h.perOrderUnitExcl === "255.0000")).toBe(true);
    expect((await listIssues(w.satinalma, { status: "acik" })).length).toBeGreaterThan(0);
  });
});
