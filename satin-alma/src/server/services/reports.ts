import { variantLabel } from "@/lib/catalog";
import { monthKey, monthRange } from "@/lib/dates";
import { dec, money, qty as qtyStr } from "@/lib/decimal";
import { changePct } from "@/lib/pricing";
import type { Ctx } from "../context";
import { assertCan } from "../permissions";

/**
 * Aylık raporda ÜÇ AYRI rakam:
 *   1) Verilen sipariş tutarı — siparişin verildiği güne göre (borç değildir).
 *   2) Net satın alma — fatura tarihine göre; faturalar + onaylı finansal düzeltmeler (iade/fiyat farkı ±).
 *   3) Nakit çıkışı — ödeme tarihine göre.
 * Hepsi para birimi başına ayrı; KDV hariç ve KDV dahil ayrı sütunlardır. TL karşılığı yalnızca kuru girilmiş döviz belgelerinden
 * hesaplanır ve kuru olmayan belge sayısı ayrıca gösterilir.
 */

export interface Amounts {
  net: string;
  vat: string;
  total: string;
}

export interface MonthRow {
  month: string;
  currency: string;
  ordered: Amounts;
  orderCount: number;
  invoiced: Amounts;
  invoiceCount: number;
  adjustments: Amounts;
  netPurchase: Amounts;
  paid: string;
  paymentCount: number;
  /** Yalnızca döviz satırlarında: kuru olan belgelerin TL karşılığı ve kuru eksik belge sayısı */
  tlPurchase: string | null;
  tlPurchaseMissing: number;
  tlPaid: string | null;
  tlPaidMissing: number;
}

const ZERO: Amounts = { net: "0.00", vat: "0.00", total: "0.00" };

export interface Period {
  from: string;
  to: string;
}

export function defaultPeriod(today: string): Period {
  const end = monthKey(today);
  const [y, m] = end.split("-").map(Number);
  const startIdx = y! * 12 + (m! - 1) - 5;
  const start = `${Math.floor(startIdx / 12)}-${String((startIdx % 12) + 1).padStart(2, "0")}`;
  return { from: `${start}-01`, to: today };
}

export async function monthlyReport(ctx: Ctx, p: Period): Promise<MonthRow[]> {
  assertCan(ctx.actor, "reports.view");
  const q = ctx.db;
  const orders = await q.query<{ month: string; currency: string; net: string; vat: string; n: number }>(
    `select to_char((po.placed_at at time zone 'Europe/Istanbul')::date, 'YYYY-MM') as month, po.currency,
       sum(t.net + po.shipping_amount) as net, sum(t.vat + round(po.shipping_amount * po.shipping_vat_rate / 100, 2)) as vat, count(*) as n
     from purchase_orders po
     join lateral (select coalesce(sum(net_amount), 0) as net, coalesce(sum(vat_amount), 0) as vat from order_lines where order_id = po.id) t on true
     where po.status in ('verildi', 'kapandi') and (po.placed_at at time zone 'Europe/Istanbul')::date between $1 and $2 group by 1, 2`,
    [p.from, p.to],
  );
  const invoices = await q.query<{ month: string; currency: string; net: string; vat: string; total: string; tl: string | null; missing: number; n: number }>(
    `select to_char(invoice_date, 'YYYY-MM') as month, currency, sum(total_net) as net, sum(total_vat) as vat, sum(total) as total,
       sum(round(total * fx_rate, 2)) filter (where fx_rate is not null) as tl, count(*) filter (where currency <> 'TRY' and fx_rate is null) as missing, count(*) as n
     from invoices where kind = 'fatura' and canceled_at is null and invoice_date between $1 and $2 group by 1, 2`,
    [p.from, p.to],
  );
  const adjustments = await q.query<{ month: string; currency: string; net: string; vat: string }>(
    `select to_char(adj_date, 'YYYY-MM') as month, currency,
       sum(case when direction = 'borc_artirir' then net_amount else -net_amount end) as net,
       sum(case when direction = 'borc_artirir' then vat_amount else -vat_amount end) as vat
     from financial_adjustments where status = 'onaylandi' and adj_date between $1 and $2 group by 1, 2`,
    [p.from, p.to],
  );
  const payments = await q.query<{ month: string; currency: string; total: string; tl: string | null; missing: number; n: number }>(
    `select to_char(paid_on, 'YYYY-MM') as month, currency, sum(amount) as total, sum(round(amount * fx_rate, 2)) filter (where fx_rate is not null) as tl,
       count(*) filter (where currency <> 'TRY' and fx_rate is null) as missing, count(*) as n
     from payments where canceled_at is null and paid_on between $1 and $2 group by 1, 2`,
    [p.from, p.to],
  );
  const currencies = [...new Set([...orders, ...invoices, ...adjustments, ...payments].map((r) => r.currency))].sort((a, b) => (a === "TRY" ? -1 : b === "TRY" ? 1 : a.localeCompare(b)));
  if (!currencies.length) currencies.push("TRY");
  const out: MonthRow[] = [];
  for (const month of monthRange(monthKey(p.from), monthKey(p.to))) {
    for (const currency of currencies) {
      const o = orders.find((r) => r.month === month && r.currency === currency);
      const i = invoices.find((r) => r.month === month && r.currency === currency);
      const a = adjustments.find((r) => r.month === month && r.currency === currency);
      const pay = payments.find((r) => r.month === month && r.currency === currency);
      const ordered = o ? { net: money(o.net), vat: money(o.vat), total: money(dec(o.net).plus(dec(o.vat))) } : ZERO;
      const invoiced = i ? { net: money(i.net), vat: money(i.vat), total: money(i.total) } : ZERO;
      const adj = a ? { net: money(a.net), vat: money(a.vat), total: money(dec(a.net).plus(dec(a.vat))) } : ZERO;
      out.push({
        month, currency, ordered, orderCount: o?.n ?? 0, invoiced, invoiceCount: i?.n ?? 0, adjustments: adj,
        netPurchase: { net: money(dec(invoiced.net).plus(dec(adj.net))), vat: money(dec(invoiced.vat).plus(dec(adj.vat))), total: money(dec(invoiced.total).plus(dec(adj.total))) },
        paid: money(pay?.total ?? 0), paymentCount: pay?.n ?? 0,
        tlPurchase: currency === "TRY" ? null : i?.tl ? money(i.tl) : null, tlPurchaseMissing: i?.missing ?? 0,
        tlPaid: currency === "TRY" ? null : pay?.tl ? money(pay.tl) : null, tlPaidMissing: pay?.missing ?? 0,
      });
    }
  }
  return out;
}

export type SpendGroup = "urun" | "kategori" | "tedarikci";

export interface SpendRow {
  key: string;
  label: string;
  currency: string;
  unitLabel: string | null;
  qty: string | null;
  net: string;
  vat: string;
  total: string;
  lineCount: number;
  avgUnitNet: string | null;
  firstUnitNet: string | null;
  lastUnitNet: string | null;
  minUnitNet: string | null;
  maxUnitNet: string | null;
  changePct: string | null;
  firstDate: string | null;
  lastDate: string | null;
}

/**
 * Harcama: YALNIZCA fatura kalemlerinden (iptal edilmemiş faturalar, fatura tarihine göre). Ödemeler ürünlere dağıtılmaz.
 * Finansal düzeltmeler (iade faturası vb.) ürünlere dağıtılmaz; aylık raporda ayrı satırda görünür.
 * "Satın alınan miktar" tüketim değildir.
 */
export async function spendReport(ctx: Ctx, p: Period, group: SpendGroup): Promise<SpendRow[]> {
  assertCan(ctx.actor, "reports.view");
  const lines = await ctx.db.query<{
    variantId: string | null; productName: string | null; brand: string | null; model: string | null; attributes: string | null; description: string | null;
    categoryId: string | null; categoryName: string | null; supplierId: string; supplierName: string; currency: string; invoiceDate: string;
    qty: string; unitLabel: string; unitPrice: string; discountPct: string; netAmount: string; vatAmount: string;
  }>(
    `select il.variant_id as "variantId", p.name as "productName", v.brand, v.model, v.attributes, il.description, c.id as "categoryId", c.name as "categoryName",
       i.supplier_id as "supplierId", s.name as "supplierName", i.currency, i.invoice_date as "invoiceDate", il.qty, il.unit_label as "unitLabel",
       il.unit_price as "unitPrice", il.discount_pct as "discountPct", il.net_amount as "netAmount", il.vat_amount as "vatAmount"
     from invoice_lines il join invoices i on i.id = il.invoice_id join suppliers s on s.id = i.supplier_id
     left join variants v on v.id = il.variant_id left join products p on p.id = v.product_id left join categories c on c.id = p.category_id
     where i.kind = 'fatura' and i.canceled_at is null and i.invoice_date between $1 and $2
     order by i.invoice_date, i.created_at, il.line_no`,
    [p.from, p.to],
  );
  const groups = new Map<string, SpendRow & { _prices: { d: string; u: ReturnType<typeof dec> }[]; _qty: ReturnType<typeof dec> }>();
  for (const l of lines) {
    const label = l.productName ? variantLabel({ productName: l.productName, brand: l.brand, model: l.model, attributes: l.attributes }) : l.description ?? "Diğer";
    const [k, lab] =
      group === "urun" ? [l.variantId ?? `d:${l.description}`, label]
      : group === "kategori" ? [l.categoryId ?? "-", l.categoryName ?? "Katalog dışı kalemler (kargo, hizmet …)"]
      : [l.supplierId, l.supplierName];
    const key = `${k}|${l.currency}`;
    let g = groups.get(key);
    if (!g) {
      g = { key: k, label: lab, currency: l.currency, unitLabel: group === "urun" ? l.unitLabel : null, qty: null, net: "0.00", vat: "0.00", total: "0.00", lineCount: 0,
        avgUnitNet: null, firstUnitNet: null, lastUnitNet: null, minUnitNet: null, maxUnitNet: null, changePct: null, firstDate: null, lastDate: null, _prices: [], _qty: dec(0) };
      groups.set(key, g);
    }
    g.net = money(dec(g.net).plus(dec(l.netAmount)));
    g.vat = money(dec(g.vat).plus(dec(l.vatAmount)));
    g.total = money(dec(g.net).plus(dec(g.vat)));
    g.lineCount += 1;
    g._qty = g._qty.plus(dec(l.qty));
    g._prices.push({ d: l.invoiceDate, u: dec(l.unitPrice).mul(dec(100).minus(dec(l.discountPct))).div(100) });
  }
  return [...groups.values()]
    .map(({ _prices, _qty, ...g }) => {
      if (group !== "urun") return { ...g, firstDate: _prices[0]?.d ?? null, lastDate: _prices.at(-1)?.d ?? null };
      const first = _prices[0]!;
      const last = _prices.at(-1)!;
      const min = _prices.reduce((a, x) => (x.u.lt(a) ? x.u : a), first.u);
      const max = _prices.reduce((a, x) => (x.u.gt(a) ? x.u : a), first.u);
      return {
        ...g,
        qty: qtyStr(_qty),
        avgUnitNet: _qty.isZero() ? null : dec(g.net).div(_qty).toDecimalPlaces(4).toFixed(4),
        firstUnitNet: first.u.toDecimalPlaces(4).toFixed(4),
        lastUnitNet: last.u.toDecimalPlaces(4).toFixed(4),
        minUnitNet: min.toDecimalPlaces(4).toFixed(4),
        maxUnitNet: max.toDecimalPlaces(4).toFixed(4),
        changePct: _prices.length > 1 ? changePct(first.u, last.u) : null,
        firstDate: first.d,
        lastDate: last.d,
      };
    })
    .sort((a, b) => (a.currency === b.currency ? dec(b.net).cmp(dec(a.net)) : a.currency.localeCompare(b.currency)));
}
