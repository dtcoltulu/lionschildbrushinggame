import { formatDate, formatDateTime, monthLabel } from "@/lib/dates";
import { dec } from "@/lib/decimal";
import {
  ADJ_DIRECTIONS, ADJ_STATUSES, ADJ_TYPES, INVOICE_KINDS, INVOICE_REVIEWS, ISSUE_ACTIONS, ISSUE_STATUSES, ISSUE_TYPES, ORDER_CHANNELS, ORDER_STATUSES,
  PAYMENT_METHODS, STOCK_STATES, URGENCIES, DELIVERY_STATES,
} from "@/lib/labels";
import type { Ctx } from "../context";
import { NotFoundError } from "../errors";
import { assertCan } from "../permissions";
import { listAdjustments } from "./adjustments";
import { supplierBalances } from "./balances";
import { listInvoices } from "./invoices";
import { listIssues } from "./issues";
import { listOrders } from "./orders";
import { listPayments } from "./payments";
import { monthlyReport, spendReport, type Period } from "./reports";
import { listRequests } from "./requests";
import { LINE_STATS } from "./order-state";

/**
 * CSV dışa aktarım. Türkçe Excel varsayılanı noktalı virgüldür; UTF-8 BOM Türkçe karakterleri korur.
 * Tutarlar Excel'in sayı olarak okuyacağı biçimde (ondalık virgül, binlik ayırıcı yok) yazılır.
 */
const SEP = ";";
const BOM = "﻿";
type Cell = string | number | null | undefined;

function cell(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? String(v) : v;
  // Sayısal metin (ondalık nokta) → ondalık virgül
  if (/^-?\d+\.\d+$/.test(s)) return s.replace(".", ",");
  // Excel formül enjeksiyonuna karşı
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Cell[][]): string {
  return BOM + rows.map((r) => r.map(cell).join(SEP)).join("\r\n") + "\r\n";
}

const qty = (v: string | null | undefined) => (v === null || v === undefined ? "" : dec(v).toDecimalPlaces(3).toFixed());

export const EXPORTS = {
  talepler: { label: "Malzeme talepleri", finance: false },
  "siparis-kalemleri": { label: "Sipariş kalemleri ve teslimat durumu", finance: false },
  sorunlar: { label: "Teslimat sorunları", finance: false },
  faturalar: { label: "Faturalar ve kalan borç", finance: true },
  odemeler: { label: "Ödemeler", finance: true },
  duzeltmeler: { label: "Finansal düzeltmeler", finance: true },
  bakiyeler: { label: "Tedarikçi bakiyeleri", finance: true },
  aylik: { label: "Aylık sipariş / satın alma / ödeme", finance: true },
  "harcama-urun": { label: "Ürün bazında satın alma", finance: true },
  "harcama-kategori": { label: "Kategori bazında satın alma", finance: true },
  "harcama-tedarikci": { label: "Tedarikçi bazında satın alma", finance: true },
} as const;
export type ExportKind = keyof typeof EXPORTS;

export async function exportCsv(ctx: Ctx, kind: string, p: Period): Promise<{ filename: string; body: string }> {
  const meta = EXPORTS[kind as ExportKind];
  if (!meta) throw new NotFoundError("Bilinmeyen dışa aktarım türü.");
  assertCan(ctx.actor, meta.finance ? "export.finance" : "export.operations");
  const stamp = `${p.from}_${p.to}`;
  const rows: Cell[][] = [];
  switch (kind as ExportKind) {
    case "talepler": {
      rows.push(["Talep no", "Tarih", "Talep eden", "Ürün", "Durum", "Miktar", "Birim", "Bildirilen kalan (sayım değil)", "İhtiyaç tarihi", "Aciliyet", "Oda / bölüm",
        "Değerlendirme", "İlerleme", "Siparişe bağlanan (temel birim)", "Teslim alınan (temel birim)", "Açıklama", "Ek ihtiyaç gerekçesi"]);
      for (const r of await listRequests(ctx, { view: "tumu", from: p.from, to: p.to })) {
        rows.push([r.requestNo, formatDateTime(r.requestedAt), r.requesterName, r.label, STOCK_STATES.label(r.stockState), qty(r.qty), r.unitLabel, qty(r.remainingQty),
          formatDate(r.neededBy), URGENCIES.label(r.urgency), r.locationName, r.status, r.progressLabel, qty(r.allocBase), qty(r.recvBase), r.note, r.extraNeedReason]);
      }
      break;
    }
    case "siparis-kalemleri": {
      assertCan(ctx.actor, "order.view");
      const orders = await listOrders(ctx, { from: p.from, to: p.to });
      const priced = ctx.actor.roles.some((r) => r === "satinalma" || r === "finans");
      rows.push(["Sipariş no", "Tedarikçi", "Sipariş durumu", "Teslimat durumu", "Verildiği an", "Kanal", "Beklenen teslim", "Teslim alacak", "Kalem", "Ürün", "Birim",
        "Sipariş", "Kabul", "Ret", "İncelemede", "İptal edilen", "Bekleyen", ...(priced ? ["Birim fiyat (KDV hariç)", "İskonto %", "KDV %", "Net", "KDV", "Para birimi"] : [])]);
      const lines = await ctx.db.query<Record<string, string>>(
        `select ol.order_id, ol.line_no, concat_ws(' – ', p.name, nullif(concat_ws(' · ', v.brand, v.model, v.attributes), '')) as label, ol.unit_label, ol.qty,
           st.accepted, st.rejected, st.held, ol.canceled_qty, (ol.qty - ol.canceled_qty - st.accepted) as pending, ol.unit_price, ol.discount_pct, ol.vat_rate,
           ol.net_amount, ol.vat_amount, po.placed_channel
         from order_lines ol join purchase_orders po on po.id = ol.order_id join variants v on v.id = ol.variant_id join products p on p.id = v.product_id ${LINE_STATS}
         where ol.order_id = any($1) order by ol.line_no`,
        [orders.map((o) => o.id)],
      );
      for (const o of orders) {
        for (const l of lines.filter((x) => x.order_id === o.id)) {
          rows.push([o.orderNo, o.supplierName, ORDER_STATUSES.label(o.status), DELIVERY_STATES.label(o.deliveryState), formatDateTime(o.placedAt), ORDER_CHANNELS.label(l.placed_channel),
            formatDate(o.expectedOn), o.receiverName, l.line_no, l.label, l.unit_label, qty(l.qty), qty(l.accepted), qty(l.rejected), qty(l.held), qty(l.canceled_qty), qty(l.pending),
            ...(priced ? [l.unit_price, l.discount_pct, l.vat_rate, l.net_amount, l.vat_amount, o.currency] : [])]);
        }
      }
      break;
    }
    case "sorunlar": {
      rows.push(["Sorun no", "Bildirildi", "Bildiren", "Sipariş", "Tedarikçi", "Kalem", "Siparişteki ürün", "Gelen ürün", "Tür", "Miktar", "Birim", "Açıklama", "Durum",
        "Çözüm", "Tedarikçiye geri verildi", "Çözüm notu", "Çözen", "Çözüm zamanı"]);
      for (const i of await listIssues(ctx, { status: "tumu" })) {
        rows.push([i.issueNo, formatDateTime(i.reportedAt), i.reportedByName, i.orderNo, i.supplierName, i.lineNo, i.orderedLabel, i.receivedLabel ?? i.receivedDesc,
          ISSUE_TYPES.label(i.type), qty(i.qty), i.unitLabel, i.description, ISSUE_STATUSES.label(i.status), ISSUE_ACTIONS.label(i.action), formatDate(i.returnedOn),
          i.resolutionNote, i.resolvedByName, formatDateTime(i.resolvedAt)]);
      }
      break;
    }
    case "faturalar": {
      rows.push(["Tür", "Tedarikçi", "Fatura no", "Fatura tarihi", "Vade", "Para birimi", "KDV hariç", "KDV", "KDV dahil toplam", "Onaylı düzeltmeler", "Ödenen (dağıtılan)",
        "Kalan", "Vade durumu", "Fark incelemesi", "İptal"]);
      for (const i of await listInvoices(ctx, { from: p.from, to: p.to })) {
        rows.push([INVOICE_KINDS.label(i.kind), i.supplierName, i.invoiceNo, formatDate(i.invoiceDate), formatDate(i.dueDate), i.currency, i.totalNet, i.totalVat, i.total,
          i.adjustments, i.allocated, i.open, i.dueState, INVOICE_REVIEWS.label(i.reviewStatus), i.canceledAt ? `İptal ${formatDateTime(i.canceledAt)}` : ""]);
      }
      break;
    }
    case "odemeler": {
      rows.push(["Ödeme no", "Tedarikçi", "Tarih", "Tutar", "Para birimi", "Yöntem", "Referans", "Faturalara dağıtılan", "Avans (dağıtılmamış)", "İptal"]);
      for (const x of await listPayments(ctx, { from: p.from, to: p.to })) {
        rows.push([x.paymentNo, x.supplierName, formatDate(x.paidOn), x.amount, x.currency, PAYMENT_METHODS.label(x.method), x.reference, x.allocated, x.unallocated,
          x.canceledAt ? `İptal ${formatDateTime(x.canceledAt)}` : ""]);
      }
      break;
    }
    case "duzeltmeler": {
      rows.push(["No", "Tedarikçi", "Tarih", "Tür", "Etkisi", "KDV hariç", "KDV", "Toplam", "Para birimi", "Belge no", "Fatura", "Sorun", "Durum", "Açıklama"]);
      for (const a of await listAdjustments(ctx, {})) {
        if (a.adjDate < p.from || a.adjDate > p.to) continue;
        rows.push([a.adjustmentNo, a.supplierName, formatDate(a.adjDate), ADJ_TYPES.label(a.type), ADJ_DIRECTIONS.label(a.direction), a.netAmount, a.vatAmount, a.totalAmount,
          a.currency, a.documentNo, a.invoiceNo, a.issueNo, ADJ_STATUSES.label(a.status), a.description]);
      }
      break;
    }
    case "bakiyeler": {
      rows.push(["Tedarikçi", "Para birimi", "Açılış", "Faturalar", "Onaylı düzeltmeler", "Ödemeler", "Bakiye (borç +)", "Faturaya bağlanmamış ödeme (avans)", "Vadesi geçmiş",
        `Vadesi ${7} gün içinde`, "Açık satın alma taahhüdü (faturalanmamış sipariş, borç değil)"]);
      for (const b of await supplierBalances(ctx)) {
        rows.push([b.supplierName, b.currency, b.opening, b.invoiced, b.adjustments, b.paid, b.balance, b.unallocated, b.overdue, b.dueSoon, b.commitment]);
      }
      break;
    }
    case "aylik": {
      rows.push(["Ay", "Para birimi", "1) Verilen sipariş – KDV hariç", "1) Verilen sipariş – KDV dahil", "Sipariş sayısı", "2) Faturalar – KDV hariç", "2) Faturalar – KDV dahil",
        "Onaylı düzeltmeler – KDV hariç", "Onaylı düzeltmeler – KDV dahil", "2) Net satın alma (fatura tarihi) – KDV hariç", "2) Net satın alma – KDV dahil",
        "3) Nakit çıkışı (ödeme tarihi)", "Net satın alma TL karşılığı (kuru olan döviz faturaları)", "Kuru eksik fatura", "Nakit çıkışı TL karşılığı", "Kuru eksik ödeme"]);
      for (const m of await monthlyReport(ctx, p)) {
        rows.push([monthLabel(m.month), m.currency, m.ordered.net, m.ordered.total, m.orderCount, m.invoiced.net, m.invoiced.total, m.adjustments.net, m.adjustments.total,
          m.netPurchase.net, m.netPurchase.total, m.paid, m.tlPurchase, m.tlPurchaseMissing || "", m.tlPaid, m.tlPaidMissing || ""]);
      }
      break;
    }
    case "harcama-urun":
    case "harcama-kategori":
    case "harcama-tedarikci": {
      const group = kind === "harcama-urun" ? "urun" : kind === "harcama-kategori" ? "kategori" : "tedarikci";
      const data = await spendReport(ctx, p, group);
      if (group === "urun") {
        rows.push(["Ürün", "Para birimi", "Satın alınan miktar (tüketim değildir)", "Birim", "KDV hariç", "KDV", "KDV dahil", "Ort. net birim fiyat (KDV hariç)", "İlk fiyat", "Son fiyat",
          "En düşük", "En yüksek", "Değişim %", "İlk fatura", "Son fatura"]);
        for (const r of data) {
          rows.push([r.label, r.currency, qty(r.qty), r.unitLabel, r.net, r.vat, r.total, r.avgUnitNet, r.firstUnitNet, r.lastUnitNet, r.minUnitNet, r.maxUnitNet, r.changePct,
            formatDate(r.firstDate), formatDate(r.lastDate)]);
        }
      } else {
        rows.push([group === "kategori" ? "Kategori" : "Tedarikçi", "Para birimi", "KDV hariç", "KDV", "KDV dahil", "Fatura kalemi sayısı"]);
        for (const r of data) rows.push([r.label, r.currency, r.net, r.vat, r.total, r.lineCount]);
      }
      break;
    }
  }
  rows.push([], [`Dışa aktaran: ${ctx.actor.displayName}`, `Dönem: ${formatDate(p.from)} – ${formatDate(p.to)}`, "Operasyonel takip kaydıdır; resmî muhasebe kaydı değildir."]);
  return { filename: `${kind}-${stamp}.csv`, body: toCsv(rows) };
}
