import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { History } from "@/components/History";
import { DeviceStatus, FaultRows } from "@/components/lists";
import { Card, EmptyState, Info, Notice, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { lifecycleLabel } from "@/lib/labels";
import { formatTL } from "@/lib/money";
import { isUuid } from "@/lib/validate";
import { firstParam, pageCtx } from "@/server/page";
import { deviceHistory, getDevice } from "@/server/services/devices";
import { listFaults } from "@/server/services/faults";

export const metadata: Metadata = { title: "Cihaz kartı" };
export const dynamic = "force-dynamic";

export default async function DevicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await pageCtx();
  if (!isUuid(id)) notFound();
  const d = await getDevice(ctx.db, ctx.today, id);
  if (!d) notFound();
  const [faults, history] = await Promise.all([listFaults(ctx.db, ctx.today, { deviceId: id, view: "tumu" }), deviceHistory(ctx.db, id)]);
  const trips = faults.reduce((s, f) => s + f.visitCount, 0);
  const costed = faults.filter((f) => f.totalCost !== null);
  const cost = costed.reduce((s, f) => s + (f.totalCost ?? 0), 0);
  const saved = firstParam(sp.kaydedildi);
  return (
    <>
      <PageHeader
        back={{ href: "/cihazlar", label: "Cihaz envanteri" }}
        title={
          <span>
            <span className="font-mono text-brand">{d.inventoryCode}</span> {d.name}
          </span>
        }
        subtitle={<DeviceStatus d={d} />}
        actions={
          <>
            {d.openFault ? (
              <Link href={`/arizalar/${d.openFault.id}`} className="btn btn-primary">Açık arıza kaydına git</Link>
            ) : d.lifecycle !== "envanterden_cikarildi" ? (
              <Link href={`/arizalar/yeni?cihaz=${d.id}`} className="btn btn-primary">+ Arıza bildir</Link>
            ) : null}
            <Link href={`/cihazlar/${d.id}/duzenle`} className="btn btn-secondary">Düzenle</Link>
          </>
        }
      />
      {saved && (
        <div className="mb-4">
          <Notice tone="green">{saved === "yeni" ? `Cihaz kaydedildi: ${d.inventoryCode}.` : "Değişiklikler kaydedildi."}</Notice>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card title="Cihaz kartı">
          <dl className="grid grid-cols-2 gap-x-4">
            <Info label="Envanter kodu"><span className="font-mono font-bold">{d.inventoryCode}</span></Info>
            <Info label="Tür">{d.typeName}</Info>
            <Info label="Marka">{d.brand}</Info>
            <Info label="Model">{d.model}</Info>
            <Info label="Seri numarası" missing="Girilmemiş">{d.serialNumber}</Info>
            <Info label="Oda / ünit">{d.locationName}</Info>
            <Info label="Sorumlu çalışan">{d.responsibleName && `${d.responsibleName}${d.responsibleActive === false ? " (pasif)" : ""}`}</Info>
            <Info label="Kayıt durumu">{lifecycleLabel(d.lifecycle)}</Info>
            <div className="col-span-2"><Info label="Diğer kullanıcılar">{d.otherUserNames.join(", ")}</Info></div>
            <div className="col-span-2"><Info label="Notlar"><span className="whitespace-pre-wrap">{d.notes}</span></Info></div>
            <div className="col-span-2 text-sm text-muted">Son güncelleme: {formatDateTime(d.updatedAt)}</div>
          </dl>
        </Card>
        <div className="space-y-5">
          <Card title="Arıza ve servis geçmişi">
            <div className="mb-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 p-2"><div className="text-2xl font-bold">{faults.length}</div><div className="text-sm text-muted">Arıza bildirimi</div></div>
              <div className="rounded-xl bg-slate-50 p-2"><div className="text-2xl font-bold">{trips}</div><div className="text-sm text-muted">Tamire gidiş</div></div>
              <div className="rounded-xl bg-slate-50 p-2"><div className="text-lg font-bold">{costed.length ? formatTL(cost) : "—"}</div><div className="text-sm text-muted">Tamir maliyeti</div></div>
            </div>
            {faults.length ? <FaultRows faults={faults} /> : <EmptyState>Bu cihaz için arıza kaydı yok.</EmptyState>}
          </Card>
          <Card title="Değişiklik geçmişi">
            <History rows={history} />
          </Card>
        </div>
      </div>
    </>
  );
}
