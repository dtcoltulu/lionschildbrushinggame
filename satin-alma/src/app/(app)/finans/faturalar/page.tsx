import Link from "next/link";
import { FinanceTabs } from "@/components/FinanceTabs";
import { InvoiceTable } from "@/components/lists";
import { FilterBar, PageHeader, Tabs } from "@/components/ui";
import { dateParam, firstParam, pageCtx, type SearchParams } from "@/server/page";
import { listInvoices, type InvoiceFilters } from "@/server/services/invoices";

export const dynamic = "force-dynamic";

const VIEWS: { key: NonNullable<InvoiceFilters["view"]>; label: string }[] = [
  { key: "acik", label: "Ödenmemiş" },
  { key: "gecikti", label: "Vadesi geçmiş" },
  { key: "yaklasiyor", label: "Vadesi yaklaşan" },
  { key: "inceleme", label: "Fark incelemesi" },
  { key: "iptal", label: "İptal edilen" },
  { key: "tumu", label: "Tümü" },
];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx("finance.view");
  const sp = await searchParams;
  const view = VIEWS.find((v) => v.key === firstParam(sp.gorunum))?.key ?? "tumu";
  const q = firstParam(sp.q) ?? "";
  const from = dateParam(sp.from);
  const to = dateParam(sp.to);
  const rows = await listInvoices(ctx, { view, q, from, to });
  return (
    <>
      <PageHeader title="Faturalar" actions={<><Link className="btn btn-primary" href="/finans/faturalar/yeni">+ Fatura</Link><a className="btn btn-secondary" href={`/api/disa-aktar/faturalar?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`}>CSV</a></>} />
      <FinanceTabs current="faturalar" />
      <Tabs current={view} items={VIEWS.map((v) => ({ key: v.key, label: v.label, href: `/finans/faturalar?gorunum=${v.key}` }))} />
      <FilterBar action="/finans/faturalar" from={from} to={to} q={q} hidden={{ gorunum: view }} />
      <InvoiceTable rows={rows} />
    </>
  );
}
