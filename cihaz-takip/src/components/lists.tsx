import Link from "next/link";
import { AVAILABILITY_LABELS, AVAILABILITY_TONES } from "@/lib/labels";
import { formatDate } from "@/lib/dates";
import { formatTL } from "@/lib/money";
import type { DeviceListItem } from "@/server/services/devices";
import type { FaultListItem } from "@/server/services/faults";
import { Badge } from "./ui";

export function DeviceStatus({ d }: { d: Pick<DeviceListItem, "availability"> }) {
  return <Badge tone={AVAILABILITY_TONES[d.availability]}>{AVAILABILITY_LABELS[d.availability]}</Badge>;
}

/** Cihaz listesi: telefonda kart, masaüstünde tablo. */
export function DeviceRows({ devices }: { devices: DeviceListItem[] }) {
  return (
    <>
      <ul className="space-y-2 md:hidden">
        {devices.map((d) => (
          <li key={d.id}>
            <Link href={`/cihazlar/${d.id}`} className="card block p-3 active:bg-slate-50">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-sm font-bold text-brand">{d.inventoryCode}</div>
                  <div className="truncate text-[17px] font-semibold">{d.name}</div>
                  <div className="text-sm text-muted">{[d.brand, d.model].filter(Boolean).join(" ") || "Marka/model girilmemiş"}</div>
                </div>
                <DeviceStatus d={d} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                <span>📍 {d.locationName ?? "Konum yok"}</span>
                <span>👤 {d.responsibleName ?? "Sorumlu yok"}</span>
                {d.serialNumber && <span>SN {d.serialNumber}</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full text-left text-[15px]">
          <thead className="border-b border-slate-200 bg-slate-50 text-sm text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Kod</th>
              <th className="px-3 py-2 font-semibold">Cihaz</th>
              <th className="px-3 py-2 font-semibold">Marka / model</th>
              <th className="px-3 py-2 font-semibold">Seri no</th>
              <th className="px-3 py-2 font-semibold">Oda / ünit</th>
              <th className="px-3 py-2 font-semibold">Sorumlu</th>
              <th className="px-3 py-2 font-semibold">Durum</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono font-bold">
                  <Link href={`/cihazlar/${d.id}`} className="text-brand hover:underline">{d.inventoryCode}</Link>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/cihazlar/${d.id}`} className="font-semibold hover:underline">{d.name}</Link>
                  <div className="text-sm text-muted">{d.typeName}</div>
                </td>
                <td className="px-3 py-2">{[d.brand, d.model].filter(Boolean).join(" ") || <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-2">{d.serialNumber ?? <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-2">{d.locationName ?? <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-2">{d.responsibleName ?? <span className="text-slate-400">—</span>}{d.responsibleActive === false && <span className="text-sm text-muted"> (pasif)</span>}</td>
                <td className="px-3 py-2"><DeviceStatus d={d} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Arıza listesi satırları (kişi rolleri ayrı gösterilir; kimse otomatik sorumlu tutulmaz). */
export function FaultRows({ faults, compact, staffId }: { faults: FaultListItem[]; compact?: boolean; staffId?: string }) {
  return (
    <ul className="divide-y divide-slate-100">
      {faults.map((f) => {
        const roles = staffId
          ? [
              f.noticedByStaffId === staffId && "Fark eden",
              f.lastUserStaffId === staffId && "Son bilinen kullanıcı",
              f.responsibleStaffId === staffId && "Doğrulanmış sorumlu",
              f.responsibilityVerifiedByStaffId === staffId && "Sorumluluğu doğrulayan",
            ].filter(Boolean)
          : [];
        return (
          <li key={f.id}>
            <Link href={`/arizalar/${f.id}`} className="-mx-2 block rounded-lg px-2 py-3 hover:bg-slate-50">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    <span className="font-mono font-bold text-brand">{f.deviceCode}</span> <span className="font-semibold">{f.deviceName}</span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[16px]">{f.description}</div>
                </div>
                <Badge tone={f.display.tone}>{f.display.label}</Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted">
                <span>Fark edildi: {formatDate(f.noticedOn)}</span>
                {!compact && <span>Neden: {f.causeName}</span>}
                {f.vendorName && <span>Servis: {f.vendorName}</span>}
                {f.expectedReturnOn && f.status === "serviste" && <span>Beklenen dönüş: {formatDate(f.expectedReturnOn)}</span>}
                {!compact && f.visitCount > 0 && <span>Tamire gidiş: {f.visitCount}</span>}
                {!compact && f.totalCost !== null && <span>Maliyet: {formatTL(f.totalCost)}</span>}
                {roles.length > 0 && <span className="font-semibold text-slate-700">Bu kişi: {roles.join(", ")}</span>}
                {f.deletionRequestedAt && <span className="font-semibold text-amber-800">Silme talebi: {f.deletionRequestReason}</span>}
                {f.deletedAt && <span className="font-semibold text-red-800">Silindi ({f.deletedBy}){f.deleteReason ? `: ${f.deleteReason}` : ""}</span>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
