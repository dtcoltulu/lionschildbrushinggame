import { ActionPanel } from "@/components/ActionPanel";
import { PageHeader } from "@/components/ui";
import { pageCtx } from "@/server/page";
import { supplierFields } from "@/server/supplier-fields";

export const dynamic = "force-dynamic";

export default async function NewSupplierPage() {
  await pageCtx("supplier.manage");
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Yeni tedarikçi" back={{ href: "/tedarikciler", label: "Tedarikçiler" }} />
      <ActionPanel title="Tedarikçi kartı" open endpoint="/api/tedarikciler" fields={supplierFields()} submitLabel="Kaydet" redirectTo="/tedarikciler/{id}" />
    </div>
  );
}
