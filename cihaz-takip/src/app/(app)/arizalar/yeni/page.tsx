import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DevicePicker } from "@/components/DevicePicker";
import { FaultForm } from "@/components/forms/FaultForm";
import { EMPTY_VISIT } from "@/lib/fault-form";
import { Notice, PageHeader } from "@/components/ui";
import { isUuid } from "@/lib/validate";
import { firstParam, formLookups, pageCtx } from "@/server/page";
import { can } from "@/server/permissions";
import { getDevice, listDevices } from "@/server/services/devices";
import { undeterminedCauseId } from "@/server/services/lookups";

export const metadata: Metadata = { title: "Arıza bildir" };
export const dynamic = "force-dynamic";

export default async function NewFaultPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageCtx();
  const sp = await searchParams;
  const deviceId = firstParam(sp.cihaz);

  if (!deviceId) {
    const devices = await listDevices(ctx.db, ctx.today, {});
    return (
      <>
        <PageHeader title="Arıza bildir" subtitle="Önce cihazı seçin. Cihaz kartındaki “Arıza bildir” düğmesi bu adımı atlar." />
        <DevicePicker
          devices={devices.map((d) => ({
            id: d.id, code: d.inventoryCode, name: d.name, availability: d.availability, openFaultId: d.openFault?.id ?? null,
            detail: [d.locationName, [d.brand, d.model].filter(Boolean).join(" "), d.responsibleName].filter(Boolean).join(" · "),
            search: [d.inventoryCode, d.name, d.typeName, d.brand, d.model, d.serialNumber, d.locationName, d.responsibleName, ...d.otherUserNames].filter(Boolean).join(" "),
          }))}
        />
      </>
    );
  }

  if (!isUuid(deviceId)) notFound();
  const d = await getDevice(ctx.db, ctx.today, deviceId);
  if (!d) notFound();
  // Aynı cihazda açık arıza varsa yeni kayıt yerine mevcut kayda yönlendir (mükerrer kayıt önlenir).
  if (d.openFault) redirect(`/arizalar/${d.openFault.id}?mevcut=1`);
  if (d.lifecycle === "envanterden_cikarildi") {
    return (
      <>
        <PageHeader title="Arıza bildir" back={{ href: `/cihazlar/${d.id}`, label: "Cihaz kartı" }} />
        <Notice tone="amber" title="Bu cihaz envanterden çıkarılmış">Çıkarılmış cihaza arıza kaydı açılamaz. Cihaz yeniden kullanılıyorsa yönetici kayıt durumunu “Aktif” yapabilir.</Notice>
      </>
    );
  }
  const lookups = await formLookups(ctx.db, [d.locationId]);
  const me = ctx.actor.staffId && lookups.staff.some((s) => s.value === ctx.actor.staffId) ? ctx.actor.staffId : "";
  return (
    <>
      <PageHeader
        title="Arıza bildir"
        back={{ href: `/cihazlar/${d.id}`, label: "Cihaz kartı" }}
        subtitle={
          <span>
            <span className="font-mono font-bold text-brand">{d.inventoryCode}</span> {d.name}
            {d.locationName ? ` · ${d.locationName}` : ""} ·{" "}
            <Link href="/arizalar/yeni" className="font-semibold text-brand underline">başka cihaz seç</Link>
          </span>
        }
      />
      <FaultForm
        mode="create"
        device={{ id: d.id, code: d.inventoryCode, name: d.name }}
        lookups={lookups}
        canAssignResponsibility={can(ctx.actor, "fault.assignResponsibility")}
        today={ctx.today}
        initial={{
          description: "", noticedOn: ctx.today, noticedByStaffId: me, lastUserStaffId: "", locationId: d.locationId ?? "",
          causeId: await undeterminedCauseId(ctx.db), causeDetail: "", causeVerification: "on_degerlendirme",
          responsibleStaffId: "", responsibilityEvidence: "", responsibilityVerifiedByStaffId: "",
          status: "arizali", resolutionNote: "", resend: "", visit: EMPTY_VISIT, newVisit: EMPTY_VISIT,
        }}
      />
    </>
  );
}
