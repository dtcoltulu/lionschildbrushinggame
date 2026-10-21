import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionPanel } from "@/components/ActionPanel";
import { Files } from "@/components/Files";
import { FinanceTabs } from "@/components/FinanceTabs";
import { History } from "@/components/History";
import { Card, Info, Notice, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney, isPositive } from "@/lib/decimal";
import { PAYMENT_METHODS } from "@/lib/labels";
import { isUuid } from "@/lib/validate";
import { AppError } from "@/server/errors";
import { firstParam, pageCtx, type SearchParams } from "@/server/page";
import { can } from "@/server/permissions";
import { listFiles } from "@/server/services/files";
import { getPayment } from "@/server/services/payments";
import { AllocateRemaining } from "../PaymentForms";

export const dynamic = "force-dynamic";

export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx("finance.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const p = await getPayment(ctx, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const files = await listFiles(ctx, "payment", id);
  const manage = can(ctx.actor, "finance.manage") && !p.canceledAt;
  return (
    <>
      <PageHeader title={`Ödeme ${p.paymentNo}`} subtitle={<Link className="underline" href={`/tedarikciler/${p.supplierId}`}>{p.supplierName}</Link>} back={{ href: "/finans/odemeler", label: "Ödemeler" }} />
      <FinanceTabs current="odemeler" />
      {firstParam(sp.yeni) && <div className="mb-4"><Notice tone="green">Ödeme kaydedildi.</Notice></div>}
      {p.canceledAt && <div className="mb-4"><Notice tone="red" title="Ödeme iptal edildi (ters kayıt) – bakiyeye girmez">{p.cancelReason}</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Ödeme">
          <dl>
            <Info label="Tarih">{formatDate(p.paidOn)}</Info>
            <Info label="Tutar"><b>{formatMoney(p.amount, p.currency)}</b></Info>
            <Info label="Yöntem">{PAYMENT_METHODS.label(p.method)}</Info>
            <Info label="Dekont / referans">{p.reference}</Info>
            {p.fxRate && <Info label="TL karşılığı için kur">{`1 ${p.currency} = ${p.fxRate.replace(".", ",")} TL · ${formatDate(p.fxDate)} · ${p.fxSource}`}</Info>}
            <Info label="Açıklama">{p.note}</Info>
            <Info label="Kaydeden">{p.createdByName} · {formatDateTime(p.createdAt)}</Info>
          </dl>
        </Card>
        <Card title="Dağıtım">
          <dl>
            <Info label="Faturalara dağıtılan">{formatMoney(p.allocated, p.currency)}</Info>
            <Info label="Faturaya bağlanmamış (avans)"><b>{formatMoney(p.unallocated, p.currency)}</b></Info>
          </dl>
          <ul className="mt-2 space-y-2">
            {p.allocations.map((a) => (
              <li key={a.id} className={`rounded-lg border p-2 ${a.releasedAt ? "border-dashed border-slate-300 text-muted" : "border-slate-200"}`}>
                <Link className="font-semibold underline" href={`/finans/faturalar/${a.invoiceId}`}>{a.kind === "acilis" ? "Açılış borcu" : `Fatura ${a.invoiceNo}`}</Link> · {formatDate(a.invoiceDate)} · {formatMoney(a.amount, p.currency)}
                {a.releasedAt ? <div className="text-sm">Kaldırıldı {formatDateTime(a.releasedAt)}: {a.releaseReason}</div> : manage && (
                  <div className="mt-2"><ActionPanel title="Dağıtımı kaldır" tone="secondary" endpoint={`/api/dagitimlar/${a.id}/kaldir`} fields={[{ name: "reason", label: "Gerekçe", type: "text", required: true }]} description="Tutar ödeme üzerinde avans olarak kalır; tedarikçi bakiyesi değişmez." /></div>
                )}
              </li>
            ))}
          </ul>
          {manage && isPositive(p.unallocated) && <div className="mt-3"><AllocateRemaining paymentId={p.id} supplierId={p.supplierId} currency={p.currency} unallocated={p.unallocated} /></div>}
        </Card>
      </div>
      {manage && (
        <div className="mt-4">
          <ActionPanel title="Ödemeyi iptal et (ters kayıt)" tone="danger" endpoint={`/api/odemeler/${p.id}/iptal`} extra={{ version: p.version }}
            description="Yanlış girilmiş ödeme için. Kayıt silinmez; dağıtımları kaldırılır ve bakiyeden çıkar."
            fields={[{ name: "reason", label: "Gerekçe", type: "textarea", required: true }]} />
        </div>
      )}
      <Card title="Dekont" className="mt-4"><Files entity="payment" entityId={p.id} files={files} canUpload={manage} label="Dekont ekle" pdf /></Card>
      <Card title="İşlem geçmişi" className="mt-4"><History rows={p.history} /></Card>
    </>
  );
}
