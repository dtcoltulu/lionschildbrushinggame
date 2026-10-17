import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeviceForm } from "@/components/forms/DeviceForm";
import { PageHeader } from "@/components/ui";
import { isUuid } from "@/lib/validate";
import { formLookups, pageCtx } from "@/server/page";
import { getDevice } from "@/server/services/devices";

export const metadata: Metadata = { title: "Cihazı düzenle" };
export const dynamic = "force-dynamic";

export default async function EditDevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageCtx();
  if (!isUuid(id)) notFound();
  const d = await getDevice(ctx.db, ctx.today, id);
  if (!d) notFound();
  const lookups = await formLookups(ctx.db, [d.typeId, d.locationId, d.responsibleStaffId, ...d.otherUserIds]);
  return (
    <>
      <PageHeader title={`${d.inventoryCode} düzenle`} subtitle={d.name} back={{ href: `/cihazlar/${d.id}`, label: "Cihaz kartı" }} />
      <DeviceForm
        mode="edit"
        deviceId={d.id}
        version={d.version}
        lookups={lookups}
        isAdmin={ctx.actor.role === "admin"}
        initial={{
          name: d.name, typeId: d.typeId, brand: d.brand ?? "", model: d.model ?? "", serialNumber: d.serialNumber ?? "",
          locationId: d.locationId ?? "", responsibleStaffId: d.responsibleStaffId ?? "", otherUserIds: d.otherUserIds,
          notes: d.notes ?? "", lifecycle: d.lifecycle, inventoryCode: d.inventoryCode, quantity: "1",
        }}
      />
    </>
  );
}
