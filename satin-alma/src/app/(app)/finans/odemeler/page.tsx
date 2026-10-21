import Link from "next/link";
import { FinanceTabs } from "@/components/FinanceTabs";
import { DataTable, FilterBar, PageHeader, Tabs } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/decimal";
import { PAYMENT_METHODS } from "@/lib/labels";
import { dateParam, firstParam, pageCtx, type SearchParams } from "@/server/page";
import { listPayments } from "@/server/services/payments";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx("finance.view");
  const sp = await searchParams;
  const view = (["tumu", "avans", "iptal"] as const).find((v) => v === firstParam(sp.gorunum)) ?? "tumu";
  const from = dateParam(sp.from);
  const to = dateParam(sp.to);
  const rows = await listPayments(ctx, { view, from, to });
  return (
    <>
      <PageHeader title="Ödemeler" actions={<><Link className="btn btn-primary" href="/finans/odemeler/yeni">+ Ödeme</Link><a className="btn btn-secondary" href={`/api/disa-aktar/odemeler?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`}>CSV</a></>} />
      <FinanceTabs current="odemeler" />
      <Tabs current={view} items={[{ key: "tumu", label: "Tümü", href: "/finans/odemeler" }, { key: "avans", label: "Faturaya bağlanmamış (avans)", href: "/finans/odemeler?gorunum=avans" }, { key: "iptal", label: "İptal edilen", href: "/finans/odemeler?gorunum=iptal" }]} />
      <FilterBar action="/finans/odemeler" from={from} to={to} hidden={{ gorunum: view }} />
      <DataTable rows={rows} rowKey={(p) => p.id} empty="Ödeme yok."
        columns={[
          { label: "Ödeme", cell: (p) => <Link className="font-bold text-brand hover:underline" href={`/finans/odemeler/${p.id}`}>{p.paymentNo}</Link> },
          { label: "Tedarikçi", cell: (p) => p.supplierName },
          { label: "Tarih", cell: (p) => formatDate(p.paidOn) },
          { label: "Yöntem", cell: (p) => PAYMENT_METHODS.label(p.method) },
          { label: "Referans", cell: (p) => p.reference ?? "—" },
          { label: "Tutar", align: "right", cell: (p) => <span className={p.canceledAt ? "line-through" : "font-semibold"}>{formatMoney(p.amount, p.currency)}</span> },
          { label: "Dağıtılan", align: "right", cell: (p) => formatMoney(p.allocated, p.currency) },
          { label: "Avans", align: "right", cell: (p) => (p.canceledAt ? "İptal" : p.unallocated === "0.00" ? "—" : formatMoney(p.unallocated, p.currency)) },
        ]} />
    </>
  );
}
