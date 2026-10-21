import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionPanel } from "@/components/ActionPanel";
import { Files } from "@/components/Files";
import { FinanceTabs } from "@/components/FinanceTabs";
import { History } from "@/components/History";
import { DueBadge } from "@/components/lists";
import { Badge, Card, DataTable, Info, Notice, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { decimalInput, formatMoney, formatPct, formatPrice, formatQty, isPositive } from "@/lib/decimal";
import { ADJ_DIRECTIONS, ADJ_STATUSES, ADJ_TYPES, INVOICE_REVIEWS, PAYMENT_METHODS } from "@/lib/labels";
import { isUuid } from "@/lib/validate";
import { AppError } from "@/server/errors";
import { firstParam, pageCtx, type SearchParams } from "@/server/page";
import { can } from "@/server/permissions";
import { listFiles } from "@/server/services/files";
import { getInvoice } from "@/server/services/invoices";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx("finance.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const i = await getInvoice(ctx, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const files = await listFiles(ctx, "invoice", id);
  const manage = can(ctx.actor, "finance.manage") && !i.canceledAt;
  const title = i.kind === "acilis" ? `Açılış borcu – ${i.supplierName}` : `Fatura ${i.invoiceNo}`;
  return (
    <>
      <PageHeader title={title} subtitle={<Link className="underline" href={`/tedarikciler/${i.supplierId}`}>{i.supplierName}</Link>} back={{ href: "/finans/faturalar", label: "Faturalar" }}
        actions={<div className="flex flex-wrap gap-1.5"><DueBadge i={i} />{i.reviewStatus !== "yok" && <Badge tone={INVOICE_REVIEWS.tone(i.reviewStatus)}>{INVOICE_REVIEWS.label(i.reviewStatus)}</Badge>}</div>} />
      <FinanceTabs current="faturalar" />
      {firstParam(sp.yeni) && <div className="mb-4"><Notice tone="green">Fatura kaydedildi.</Notice></div>}
      {i.canceledAt && <div className="mb-4"><Notice tone="red" title="Bu kayıt iptal edildi (ters kayıt) – bakiyeye girmez">{i.cancelReason} · {i.canceledByName} · {formatDateTime(i.canceledAt)}</Notice></div>}
      {i.discrepancies.length > 0 && (
        <div className="mb-4">
          <Notice tone={i.reviewStatus === "onaylandi" ? "amber" : "red"} title={`Sipariş / teslimat ile ${i.discrepancies.length} fark`}>
            <ul className="list-disc pl-5">{i.discrepancies.map((d, k) => <li key={k}>{d.message}</li>)}</ul>
            <p className="mt-1">Fatura borçta tam tutarıyla durur (silinmez, gizlenmez). Farkı inceleyip kabul edin ya da tedarikçiye itiraz ettiğinizi kaydedin; düzeltme belgesi gelince “Düzeltmeler”den girin.</p>
          </Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Fatura" className="lg:col-span-2">
          <dl className="grid gap-x-6 sm:grid-cols-2">
            <Info label="Fatura tarihi">{formatDate(i.invoiceDate)}</Info>
            <Info label="Vade">{i.dueDate ? formatDate(i.dueDate) : null}</Info>
            <Info label="Para birimi">{i.currency}</Info>
            {i.fxRate && <Info label="TL karşılığı için kur">{`1 ${i.currency} = ${i.fxRate.replace(".", ",")} TL · ${formatDate(i.fxDate)} · ${i.fxSource}`}</Info>}
            {i.declaredTotal && <Info label="Faturada yazan toplam">{formatMoney(i.declaredTotal, i.currency)}</Info>}
            <Info label="Açıklama">{i.description}</Info>
            <Info label="Not">{i.note}</Info>
            <Info label="Kaydeden">{i.createdByName} · {formatDateTime(i.createdAt)}</Info>
            {i.reviewNote && <Info label="İnceleme">{i.reviewNote} · {i.reviewedByName} · {formatDateTime(i.reviewedAt)}</Info>}
          </dl>
        </Card>
        <Card title="Tutar">
          <dl>
            <Info label="KDV hariç">{formatMoney(i.totalNet, i.currency)}</Info>
            <Info label="KDV">{formatMoney(i.totalVat, i.currency)}</Info>
            <Info label="KDV dahil toplam"><b>{formatMoney(i.total, i.currency)}</b></Info>
            <Info label="Onaylı düzeltmeler">{formatMoney(i.adjustments, i.currency)}</Info>
            <Info label="Ödenen (dağıtılan)">{formatMoney(i.allocated, i.currency)}</Info>
            <Info label="Kalan borç"><span className="text-xl font-bold">{formatMoney(i.open, i.currency)}</span></Info>
          </dl>
        </Card>
      </div>
      {i.lines.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-lg font-bold">Kalemler</h2>
          <DataTable rows={i.lines} rowKey={(l) => String(l.lineNo)}
            columns={[
              { label: "#", cell: (l) => l.lineNo },
              { label: "Ürün / açıklama", cell: (l) => <><div className="font-semibold">{l.label}</div><div className="text-sm text-muted">{l.packText}{l.orderNo ? <> · sipariş <Link className="underline" href={`/siparisler/${l.orderId}`}>{l.orderNo}</Link></> : " · sipariş dışı"}</div></> },
              { label: "Miktar", align: "right", cell: (l) => `${formatQty(l.qty)} ${l.unitLabel}` },
              { label: "Birim fiyat (KDV hariç)", align: "right", cell: (l) => <>{formatPrice(l.unitPrice, i.currency)}{isPositive(l.discountPct) && <div className="text-sm text-muted">iskonto {formatPct(l.discountPct)}</div>}</> },
              { label: "KDV", align: "right", cell: (l) => formatPct(l.vatRate) },
              { label: "Net", align: "right", cell: (l) => formatMoney(l.netAmount, i.currency) },
              { label: "KDV tutarı", align: "right", cell: (l) => formatMoney(l.vatAmount, i.currency) },
            ]} />
          {isPositive(i.shippingAmount) && <p className="mt-2">Kargo: {formatMoney(i.shippingAmount, i.currency)} + KDV {formatPct(i.shippingVatRate)}</p>}
        </>
      )}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Ödemeler (dağıtılan)">
          {i.allocations.length ? (
            <ul className="space-y-1">{i.allocations.map((a) => <li key={a.id}><Link className="font-semibold text-brand underline" href={`/finans/odemeler/${a.paymentId}`}>{a.paymentNo}</Link> · {formatDate(a.paidOn)} · {PAYMENT_METHODS.label(a.method)} · {formatMoney(a.amount, i.currency)}</li>)}</ul>
          ) : <p className="text-muted">Henüz ödeme dağıtılmadı.</p>}
          {manage && isPositive(i.open) && <Link className="btn btn-primary mt-3" href={`/finans/odemeler/yeni?tedarikci=${i.supplierId}`}>+ Ödeme gir</Link>}
        </Card>
        <Card title="Düzeltmeler ve teslimatlar">
          {i.adjustmentDocs.length ? <ul className="space-y-1">{i.adjustmentDocs.map((a) => <li key={a.id}>{a.adjustmentNo} · {formatDate(a.adjDate)} · {ADJ_TYPES.label(a.type)} · {ADJ_DIRECTIONS.label(a.direction)} {formatMoney(a.totalAmount, i.currency)} · {ADJ_STATUSES.label(a.status)}</li>)}</ul> : <p className="text-muted">Bağlı düzeltme yok.</p>}
          {i.receipts.length > 0 && <p className="mt-2">Teslimatlar: {i.receipts.map((r) => <Link key={r.id} className="mr-2 underline" href={`/teslimatlar/${r.id}`}>{r.receiptNo} ({formatDate(r.receivedOn)})</Link>)}</p>}
        </Card>
      </div>
      {manage && (
        <div className="mt-4 flex flex-wrap items-start gap-2">
          {i.reviewStatus !== "yok" && (
            <ActionPanel title="Farkı incele" endpoint={`/api/faturalar/${i.id}/inceleme`} extra={{ version: i.version }}
              fields={[
                { name: "decision", label: "Karar", type: "radio", options: [{ value: "onaylandi", label: "Fark kabul edildi", hint: "Ör. yeni fiyat listesi" }, { value: "itiraz", label: "Tedarikçiye itiraz edildi", hint: "Düzeltme belgesi bekleniyor" }] },
                { name: "note", label: "Not", type: "textarea", required: true },
              ]} />
          )}
          <ActionPanel title="Vade / not / kur düzelt" tone="secondary" method="PATCH" endpoint={`/api/faturalar/${i.id}`} extra={{ version: i.version }}
            description="Tutar ve kalemler değişmez. Tutar hatalıysa faturayı gerekçeyle iptal edip doğrusunu girin."
            fields={[
              { name: "dueDate", label: "Vade tarihi", type: "date", initial: i.dueDate ?? "" },
              { name: "note", label: "Not", type: "textarea", initial: i.note ?? "" },
              ...(i.currency !== "TRY" ? [
                { name: "fxRate", label: `Kur (1 ${i.currency} = ? TL)`, type: "decimal" as const, initial: i.fxRate ? decimalInput(i.fxRate) : "" },
                { name: "fxDate", label: "Kur tarihi", type: "date" as const, initial: i.fxDate ?? "" },
                { name: "fxSource", label: "Kur kaynağı", type: "text" as const, initial: i.fxSource ?? "" },
              ] : []),
            ]} />
          <ActionPanel title="Faturayı iptal et (ters kayıt)" tone="danger" endpoint={`/api/faturalar/${i.id}/iptal`} extra={{ version: i.version }}
            description="Yanlış girilmiş fatura için. Kayıt silinmez; bakiyeden çıkar ve listede “iptal” olarak görünür. Gerçek bir faturadaki uyuşmazlık için iptal etmeyin, “Farkı incele” kullanın."
            fields={[{ name: "reason", label: "Gerekçe", type: "textarea", required: true }]} />
        </div>
      )}
      <Card title="Fatura dosyası" className="mt-4">
        <Files entity="invoice" entityId={i.id} files={files} canUpload={manage} label="Fatura fotoğrafı / PDF ekle" pdf />
      </Card>
      <Card title="İşlem geçmişi" className="mt-4"><History rows={i.history} /></Card>
    </>
  );
}
