import { PageHeader } from "@/components/ui";
import { firstParam, pageCtx, type SearchParams } from "@/server/page";
import { supplierOptions } from "@/server/services/suppliers";
import { PaymentForm } from "../PaymentForms";

export const dynamic = "force-dynamic";

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx("finance.manage");
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="Ödeme kaydı" subtitle="Kısmi ödeme yapılabilir; faturaya dağıtılmayan kısım avans olarak izlenir." back={{ href: "/finans/odemeler", label: "Ödemeler" }} />
      <PaymentForm suppliers={await supplierOptions(ctx.db)} today={ctx.today} initialSupplier={firstParam(sp.tedarikci) ?? null} />
    </>
  );
}
