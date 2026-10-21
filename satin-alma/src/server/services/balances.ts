import { dec, money } from "@/lib/decimal";
import { isUuid } from "@/lib/validate";
import type { Ctx } from "../context";
import { assertCan } from "../permissions";
import { INVOICE_OPEN_SELECT, withDueState, type InvoiceSummary } from "./invoices";

/**
 * Tedarikçi bakiyesi (para birimi başına; farklı para birimleri TOPLANMAZ):
 *   bakiye = açılış borcu + faturalar + onaylı düzeltmeler (±) − ödemeler        (iptal edilenler hariç)
 * Pozitif bakiye borçtur; negatif bakiye tedarikçideki alacak/avanstır.
 * Ayrıca: faturaya bağlanmamış ödeme (avans), vadesi geçmiş ve yaklaşan tutarlar, açık satın alma taahhüdü
 * (verilmiş siparişlerin henüz faturalanmamış kısmı — borç DEĞİLDİR, ayrı gösterilir).
 */
export interface SupplierBalance {
  supplierId: string;
  supplierName: string;
  currency: string;
  opening: string;
  invoiced: string;
  adjustments: string;
  paid: string;
  balance: string;
  unallocated: string;
  overdue: string;
  dueSoon: string;
  commitment: string;
}

export async function supplierBalances(ctx: Ctx, opts: { supplierId?: string | null } = {}): Promise<SupplierBalance[]> {
  assertCan(ctx.actor, "finance.view");
  const params: unknown[] = [];
  let filter = "";
  if (opts.supplierId && isUuid(opts.supplierId)) {
    params.push(opts.supplierId);
    filter = `where k.supplier_id = $1`;
  }
  const rows = await ctx.db.query<Omit<SupplierBalance, "balance" | "overdue" | "dueSoon">>(
    `with keys as (
       select supplier_id, currency from invoices where canceled_at is null
       union select supplier_id, currency from payments where canceled_at is null
       union select supplier_id, currency from financial_adjustments where status = 'onaylandi'
       union select supplier_id, currency from purchase_orders where status in ('verildi', 'kapandi')
     ),
     inv as (select supplier_id, currency, sum(total) filter (where kind = 'acilis') as opening, sum(total) filter (where kind = 'fatura') as invoiced
             from invoices where canceled_at is null group by 1, 2),
     pay as (select supplier_id, currency, sum(amount) as paid from payments where canceled_at is null group by 1, 2),
     alloc as (select p.supplier_id, p.currency, sum(pa.amount) as allocated from payment_allocations pa join payments p on p.id = pa.payment_id
               where pa.released_at is null and p.canceled_at is null group by 1, 2),
     adj as (select supplier_id, currency, sum(case when direction = 'borc_artirir' then total_amount else -total_amount end) as adj
             from financial_adjustments where status = 'onaylandi' group by 1, 2),
     com as (
       select po.supplier_id, po.currency,
         sum(round(greatest(ol.qty - ol.canceled_qty - coalesce(iq.q, 0), 0) * ol.unit_price * (100 - ol.discount_pct) / 100 * (100 + ol.vat_rate) / 100, 2)) as v
       from order_lines ol join purchase_orders po on po.id = ol.order_id
       left join lateral (select sum(il.qty) as q from invoice_lines il join invoices i on i.id = il.invoice_id
                          where il.order_line_id = ol.id and i.canceled_at is null) iq on true
       where po.status in ('verildi', 'kapandi') group by 1, 2
     ),
     ship as (
       select po.supplier_id, po.currency, sum(po.shipping_amount + round(po.shipping_amount * po.shipping_vat_rate / 100, 2)) as v
       from purchase_orders po where po.status in ('verildi', 'kapandi') and po.shipping_amount > 0 and not exists (
         select 1 from invoice_lines il join order_lines ol on ol.id = il.order_line_id join invoices i on i.id = il.invoice_id
         where ol.order_id = po.id and i.canceled_at is null)
       group by 1, 2
     )
     select k.supplier_id as "supplierId", s.name as "supplierName", k.currency,
       coalesce(inv.opening, 0) as opening, coalesce(inv.invoiced, 0) as invoiced, coalesce(adj.adj, 0) as adjustments, coalesce(pay.paid, 0) as paid,
       coalesce(pay.paid, 0) - coalesce(alloc.allocated, 0) as unallocated, coalesce(com.v, 0) + coalesce(ship.v, 0) as commitment
     from keys k join suppliers s on s.id = k.supplier_id
     left join inv on inv.supplier_id = k.supplier_id and inv.currency = k.currency
     left join pay on pay.supplier_id = k.supplier_id and pay.currency = k.currency
     left join alloc on alloc.supplier_id = k.supplier_id and alloc.currency = k.currency
     left join adj on adj.supplier_id = k.supplier_id and adj.currency = k.currency
     left join com on com.supplier_id = k.supplier_id and com.currency = k.currency
     left join ship on ship.supplier_id = k.supplier_id and ship.currency = k.currency
     ${filter}
     order by s.name, k.currency`,
    params,
  );
  const open = await openInvoices(ctx, opts.supplierId ?? null);
  return rows.map((r) => {
    const mine = open.filter((i) => i.supplierId === r.supplierId && i.currency === r.currency);
    return {
      ...r,
      balance: money(dec(r.opening).plus(dec(r.invoiced)).plus(dec(r.adjustments)).minus(dec(r.paid))),
      overdue: money(mine.filter((i) => i.dueState === "gecikti").reduce((a, i) => a.plus(dec(i.open)), dec(0))),
      dueSoon: money(mine.filter((i) => i.dueState === "yaklasiyor").reduce((a, i) => a.plus(dec(i.open)), dec(0))),
    };
  });
}

/** Kalanı olan (ödenmemiş) faturalar ve açılış borçları, vade durumuyla. */
export async function openInvoices(ctx: Ctx, supplierId: string | null = null): Promise<InvoiceSummary[]> {
  assertCan(ctx.actor, "finance.view");
  const params: unknown[] = [];
  let extra = "";
  if (supplierId && isUuid(supplierId)) {
    params.push(supplierId);
    extra = `and i.supplier_id = $1`;
  }
  const rows = await ctx.db.query<Omit<InvoiceSummary, "dueState" | "daysToDue">>(`${INVOICE_OPEN_SELECT} where i.canceled_at is null ${extra} order by i.due_date nulls last, i.invoice_date`, params);
  return rows.map((r) => withDueState(r, ctx.today)).filter((r) => dec(r.open).gt(0));
}

/** Para birimi başına toplam (farklı para birimleri toplanmaz). */
export function totalsByCurrency<T extends { currency: string }>(rows: T[], field: keyof T): { currency: string; amount: string }[] {
  const m = new Map<string, ReturnType<typeof dec>>();
  for (const r of rows) m.set(r.currency, (m.get(r.currency) ?? dec(0)).plus(dec(r[field] as unknown as string)));
  return [...m.entries()].map(([currency, v]) => ({ currency, amount: money(v) }));
}
