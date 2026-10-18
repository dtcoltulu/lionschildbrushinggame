import type { Metadata } from "next";
import { LookupManager } from "@/components/managers/LookupManager";
import { SettingsTabs } from "@/components/SettingsTabs";
import { PageHeader } from "@/components/ui";
import { pageCtx } from "@/server/page";
import { listLookup, type DeviceType, type FaultCause, type Vendor } from "@/server/services/lookups";

export const metadata: Metadata = { title: "Listeler" };
export const dynamic = "force-dynamic";

export default async function ListsPage() {
  const ctx = await pageCtx({ admin: true });
  const [locations, types, causes, vendors] = await Promise.all([
    listLookup(ctx.db, "locations", { includeInactive: true }),
    listLookup<DeviceType>(ctx.db, "device_types", { includeInactive: true }),
    listLookup<FaultCause>(ctx.db, "fault_causes", { includeInactive: true }),
    listLookup<Vendor>(ctx.db, "service_vendors", { includeInactive: true }),
  ]);
  const help = "Kullanılan bir kaydı silmek yerine pasifleştirin: geçmiş kayıtlar korunur, yeni seçimlerde görünmez.";
  return (
    <>
      <PageHeader title="Ayarlar" />
      <SettingsTabs current="/ayarlar/listeler" superAdmin={ctx.actor.superAdmin} />
      <div className="grid gap-5 lg:grid-cols-2">
        <LookupManager kind="locations" title="Konumlar (oda / ünit)" items={locations} help={help} />
        <LookupManager kind="device_types" title="Cihaz türleri" items={types} help="Yeni tür eklenebilir; marka ve model serbesttir. Kod öneki envanter kodunu belirler." />
        <LookupManager kind="fault_causes" title="Arıza nedenleri" items={causes} help={help} />
        <LookupManager kind="service_vendors" title="Servis firmaları" items={vendors} help="Personel arıza formundan da firma ekleyebilir." />
      </div>
    </>
  );
}
