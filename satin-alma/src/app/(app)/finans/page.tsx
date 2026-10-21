import Link from "next/link";
import { FinanceTabs } from "@/components/FinanceTabs";
import { BalanceTable, InvoiceTable } from "@/components/lists";
import { Card, Notice, PageHeader } from "@/components/ui";
import { formatMoney } from "@/lib/decimal";
import { pageCtx } from "@/server/page";
import { openInvoices, supplierBalances, totalsByCurrency } from "@/server/services/balances";
import { listInvoices } from "@/server/services/invoices";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const ctx = await pageCtx("finance.view");
  const [balances, open, review] = await Promise.all([supplierBalances(ctx), openInvoices(ctx), listInvoices(ctx, { view: "inceleme" })]);
  const debt = totalsByCurrency(balances, "balance");
  const commit = totalsByCurrency(balances, "commitment");
  const adv = totalsByCurrency(balances, "unallocated");
  return (
    <>
      <PageHeader title="Finans" subtitle="Tedarikçi borçları, vadeler ve ödemeler. Operasyonel takiptir; resmî muhasebe kaydı değildir."
        actions={<><Link className="btn btn-primary" href="/finans/faturalar/yeni">+ Fatura</Link><Link className="btn btn-secondary" href="/finans/odemeler/yeni">+ Ödeme</Link></>} />
      <FinanceTabs current="ozet" />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card p-4"><div className="text-sm font-medium text-muted">Toplam açık borç (faturalı)</div>{debt.length ? debt.map((d) => <div key={d.currency} className="text-2xl font-bold">{formatMoney(d.amount, d.currency)}</div>) : <div className="text-2xl font-bold">—</div>}</div>
        <div className="card p-4"><div className="text-sm font-medium text-muted">Açık satın alma taahhüdü (faturalanmamış sipariş)</div>{commit.map((d) => <div key={d.currency} className="text-xl font-bold">{formatMoney(d.amount, d.currency)}</div>)}<div className="text-sm text-muted">Borç değildir</div></div>
        <div className="card p-4"><div className="text-sm font-medium text-muted">Faturaya bağlanmamış ödeme (avans)</div>{adv.map((d) => <div key={d.currency} className="text-xl font-bold">{formatMoney(d.amount, d.currency)}</div>)}</div>
      </div>
      <Notice tone="gray">Bakiye = açılış borcu + faturalar + onaylı finansal düzeltmeler − ödemeler. Farklı para birimleri ayrı satırdadır ve toplanmaz.</Notice>
      <Card title="Tedarikçi bakiyeleri" className="mt-4"><BalanceTable rows={balances} /></Card>
      <Card title={`Ödenmemiş faturalar (${open.length})`} className="mt-4"><InvoiceTable rows={open} empty="Ödenmemiş fatura yok." /></Card>
      {review.length > 0 && <Card title={`Fark incelemesi bekleyen faturalar (${review.length})`} className="mt-4"><InvoiceTable rows={review} /></Card>}
    </>
  );
}
