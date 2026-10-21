import { PageHeader } from "@/components/ui";
import { firstParam, pageCtx, type SearchParams } from "@/server/page";
import { supplierOptions } from "@/server/services/suppliers";
import { InvoiceForm } from "./InvoiceForm";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx("finance.manage");
  const sp = await searchParams;
  const suppliers = await supplierOptions(ctx.db);
  return (
    <>
      <PageHeader title="Fatura kaydı" subtitle="Aynı tedarikçinin aynı numaralı faturası ikinci kez kaydedilemez." back={{ href: "/finans/faturalar", label: "Faturalar" }} />
      <InvoiceForm suppliers={suppliers} today={ctx.today} initialSupplier={firstParam(sp.tedarikci) ?? null} />
    </>
  );
}
