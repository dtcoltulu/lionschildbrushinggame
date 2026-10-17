import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FaultActions } from "@/components/FaultActions";
import { FaultForm } from "@/components/forms/FaultForm";
import { History } from "@/components/History";
import { VisitEditor } from "@/components/VisitEditor";
import { Badge, Card, Info, Notice, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { faultDisplay, serviceDuration } from "@/lib/domain";
import { faultToForm } from "@/lib/fault-form";
import { outcomeLabel, verificationLabel } from "@/lib/labels";
import { formatTL } from "@/lib/money";
import { isUuid } from "@/lib/validate";
import { firstParam, formLookups, pageCtx } from "@/server/page";
import { can } from "@/server/permissions";
import { faultHistory, getFault } from "@/server/services/faults";

export const metadata: Metadata = { title: "Arıza kaydı" };
export const dynamic = "force-dynamic";

export default async function FaultPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await pageCtx();
  if (!isUuid(id)) notFound();
  const f = await getFault(ctx.db, id);
  if (!f) notFound();
  const isAdmin = ctx.actor.role === "admin";
  if (f.deletedAt && !isAdmin) notFound();
  const [history, lookups] = await Promise.all([
    faultHistory(ctx.db, id),
    formLookups(ctx.db, [f.noticedByStaffId, f.lastUserStaffId, f.locationId, f.causeId, f.responsibleStaffId, f.responsibilityVerifiedByStaffId, ...f.visits.map((v) => v.vendorId)]),
  ]);
  const display = faultDisplay(f.status, f.currentVisit, ctx.today);
  const saved = firstParam(sp.kaydedildi);
  const costed = f.visits.filter((v) => v.costAmount !== null);
  const totalCost = costed.reduce((s, v) => s + (v.costAmount ?? 0), 0);
  return (
    <>
      <PageHeader
        back={{ href: "/arizalar", label: "Arıza & servis" }}
        title={
          <span>
            Arıza: <Link href={`/cihazlar/${f.deviceId}`} className="font-mono text-brand hover:underline">{f.deviceCode}</Link> {f.deviceName}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={display.tone}>{display.label}</Badge>
            <span>Kayıt: {formatDateTime(f.createdAt)}{f.createdBy ? ` · ${f.createdBy}` : ""}</span>
          </span>
        }
        actions={<Link href={`/cihazlar/${f.deviceId}`} className="btn btn-secondary">Cihaz kartı</Link>}
      />
      <div className="mb-4 space-y-3">
        {saved === "yeni" && <Notice tone="green" title="Arıza kaydedildi ✓">Durum değiştikçe (servise gönderildi, tamirden geldi) bu sayfadan güncelleyin.</Notice>}
        {firstParam(sp.mevcut) && !f.deletedAt && (
          <Notice tone="amber" title="Bu cihazın zaten açık bir arıza kaydı var">Yeni kayıt açmak yerine bu kaydı güncelleyin. Cihaz tamir edilip sonra yeniden arızalanırsa, bu kayıt kapandıktan sonra yeni kayıt açılabilir.</Notice>
        )}
        {f.deletedAt && (
          <Notice tone="red" title={`Bu kayıt silinmiş (${formatDateTime(f.deletedAt)}${f.deletedBy ? `, ${f.deletedBy}` : ""})`}>
            Hiçbir sayım, maliyet ve analize girmez.{f.deleteReason ? ` Neden: ${f.deleteReason}` : ""}
          </Notice>
        )}
        {f.deletionRequestedAt && !f.deletedAt && (
          <Notice tone="amber" title="Silme talebi var">
            {f.deletionRequestedBy}: “{f.deletionRequestReason}” ({formatDateTime(f.deletionRequestedAt)})
          </Notice>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0">
          {f.deletedAt ? (
            <Card title="Arıza bilgileri">
              <dl className="grid grid-cols-2 gap-x-4">
                <div className="col-span-2"><Info label="Ne oldu?">{f.description}</Info></div>
                <Info label="Fark edildiği tarih">{formatDate(f.noticedOn)}</Info>
                <Info label="Fark eden">{f.noticedByName}</Info>
                <Info label="Son bilinen kullanıcı">{f.lastUserName}</Info>
                <Info label="Konum">{f.locationName}</Info>
                <Info label="Neden">{f.causeName}</Info>
                <Info label="Doğrulama">{verificationLabel(f.causeVerification)}</Info>
              </dl>
            </Card>
          ) : (
            <FaultForm
              mode="edit"
              faultId={f.id}
              version={f.version}
              serverStatus={f.status}
              device={{ id: f.deviceId, code: f.deviceCode, name: f.deviceName }}
              initial={faultToForm(f)}
              lookups={lookups}
              canAssignResponsibility={can(ctx.actor, "fault.assignResponsibility")}
              today={ctx.today}
            />
          )}
        </div>
        <div className="space-y-5">
          <Card title={`Servis gidişleri (${f.visits.length})`}>
            {f.visits.length === 0 ? (
              <p className="text-muted">Bu arıza henüz servise gönderilmedi.</p>
            ) : (
              <ol className="space-y-4">
                {f.visits.map((v, i) => {
                  const dur = serviceDuration(v, ctx.today);
                  const current = i === f.visits.length - 1;
                  return (
                    <li key={v.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold">{i + 1}. gidiş{current ? " (güncel)" : ""}</span>
                        <span className="text-sm text-muted">{v.returned ? `Döndü · ${outcomeLabel(v.outcome)}` : "Serviste"}</span>
                      </div>
                      <dl className="mt-1 grid grid-cols-2 gap-x-3 text-[15px]">
                        <Info label="Firma" missing="Bilinmiyor">{v.vendorName}</Info>
                        <Info label="Gönderim" missing="Girilmemiş">{v.sentOn && formatDate(v.sentOn)}</Info>
                        <Info label="Beklenen dönüş">{v.expectedReturnOn && formatDate(v.expectedReturnOn)}</Info>
                        <Info label="Gerçek dönüş" missing={v.returned ? "Girilmemiş" : "—"}>{v.returnedOn && formatDate(v.returnedOn)}</Info>
                        <Info label="Servis süresi">{dur.days !== null ? `${dur.days} gün${dur.note ? ` (${dur.note.toLowerCase()})` : ""}` : <span className="text-amber-800">{dur.note}</span>}</Info>
                        <Info label="Maliyet" missing={v.returned ? "Tutar eksik" : "—"}>
                          {v.costAmount !== null && `${v.costAmount === 0 ? "Ücretsiz (0 TL)" : formatTL(v.costAmount)}${v.costDate ? ` · ${formatDate(v.costDate)}` : " · masraf tarihi eksik"}`}
                        </Info>
                        {v.workDone && <div className="col-span-2"><Info label="Yapılan işlem">{v.workDone}</Info></div>}
                        {v.receiptRef && <Info label="Rapor / fiş">{v.receiptRef}</Info>}
                        {v.serviceNote && <div className="col-span-2"><Info label="Servis notu">{v.serviceNote}</Info></div>}
                      </dl>
                      {!current && !f.deletedAt && <VisitEditor faultId={f.id} version={f.version} visit={v} vendors={lookups.vendors} today={ctx.today} />}
                    </li>
                  );
                })}
              </ol>
            )}
            {f.visits.length > 0 && <p className="mt-3 text-sm text-muted">Toplam tamir maliyeti: {costed.length ? formatTL(totalCost) : "tutar girilmemiş"}. Aynı gidişi düzenlemek yeni gidiş sayılmaz.</p>}
          </Card>
          <Card title={isAdmin ? "Silme" : "Yanlış kayıt mı?"}>
            <FaultActions
              isAdmin={isAdmin}
              info={{ id: f.id, deviceCode: f.deviceCode, deviceName: f.deviceName, description: f.description, noticedOn: f.noticedOn, deleted: !!f.deletedAt, deletionRequested: !!f.deletionRequestedAt }}
            />
          </Card>
          <Card title="İşlem geçmişi">
            <History rows={history} />
          </Card>
        </div>
      </div>
    </>
  );
}
