import type { Metadata } from "next";
import { DeviceForm } from "@/components/forms/DeviceForm";
import { PageHeader } from "@/components/ui";
import { formLookups, pageCtx } from "@/server/page";

export const metadata: Metadata = { title: "Yeni cihaz" };
export const dynamic = "force-dynamic";

export default async function NewDevicePage() {
  const ctx = await pageCtx();
  const lookups = await formLookups(ctx.db);
  return (
    <>
      <PageHeader title="Yeni cihaz" subtitle="Her fiziksel cihaz ayrı kayıttır. Bilinmeyen alanları boş bırakıp sonra tamamlayabilirsiniz." back={{ href: "/cihazlar", label: "Cihaz envanteri" }} />
      <DeviceForm
        mode="create"
        lookups={lookups}
        isAdmin={ctx.actor.role === "admin"}
        initial={{ name: "", typeId: "", brand: "", model: "", serialNumber: "", locationId: "", responsibleStaffId: "", otherUserIds: [], notes: "", lifecycle: "aktif", inventoryCode: "", quantity: "1" }}
      />
    </>
  );
}
