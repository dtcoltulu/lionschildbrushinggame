import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionPanel } from "@/components/ActionPanel";
import { History } from "@/components/History";
import { Badge, Card, DataTable, Info, Notice, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { dec, decimalInput, formatMoney, formatPct, formatPrice, formatQty, isPositive } from "@/lib/decimal";
import { DELIVERY_STATES, ISSUE_ACTIONS, ISSUE_STATUSES, ISSUE_TYPES, ORDER_CHANNELS, ORDER_STATUSES, RECEIPT_STATUSES } from "@/lib/labels";
import { isUuid } from "@/lib/validate";
import { AppError } from "@/server/errors";
import { pageCtx } from "@/server/page";
import { can } from "@/server/permissions";
import { getOrder } from "@/server/services/orders";
import { receiverOptions } from "@/server/services/users";
import { AddLine, OrderText, StartReceipt } from "./OrderClient";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageCtx(["order.view", "receipt.record"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const o = await getOrder(ctx, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const manage = can(ctx.actor, "order.manage");
  const editable = manage && (o.status === "taslak" || o.status === "verildi");
  const placed = o.status === "verildi";
  const receivers = manage ? await receiverOptions(ctx.db) : [];
  const canReceive = placed && can(ctx.actor, "receipt.record") && (manage || o.receiverUserId === ctx.actor.userId);
  const reasonField = placed ? [{ name: "changeReason", label: "Değişiklik gerekçesi (sipariş verildi; geçmişe yazılır)", type: "text" as const, required: true }] : [];
  return (
    <>
      <PageHeader
        title={`Sipariş ${o.orderNo}`}
        subtitle={<>{can(ctx.actor, "supplier.view") ? <Link className="underline" href={`/tedarikciler/${o.supplierId}`}>{o.supplierName}</Link> : o.supplierName}{o.supplierPhone ? ` · ${o.supplierPhone}` : ""}</>}
        back={{ href: manage || can(ctx.actor, "order.view") ? "/siparisler" : "/teslimatlar", label: manage || can(ctx.actor, "order.view") ? "Siparişler" : "Teslimatlarım" }}
        actions={
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={ORDER_STATUSES.tone(o.status)}>{ORDER_STATUSES.label(o.status)}</Badge>
            {o.deliveryState !== "yok" && <Badge tone={DELIVERY_STATES.tone(o.deliveryState)}>{DELIVERY_STATES.label(o.deliveryState)}</Badge>}
            {o.overdue && <Badge tone="orange">Teslimat gecikti</Badge>}
            {o.issues.some((i) => i.status === "acik") && <Badge tone="red">{o.issues.filter((i) => i.status === "acik").length} açık sorun</Badge>}
          </div>
        }
      />

      {o.status === "iptal" && <div className="mb-4"><Notice tone="red" title="Sipariş iptal edildi">{o.cancelReason} · {formatDateTime(o.canceledAt)}</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Sipariş bilgileri" className="lg:col-span-2">
          <dl className="grid gap-x-6 sm:grid-cols-2">
            <Info label="Beklenen teslim tarihi">{o.expectedOn ? formatDate(o.expectedOn) : null}</Info>
            <Info label="Teslim alacak sorumlu" missing="Atanmadı">{o.receiverName}</Info>
            <Info label="Verildi" missing="Henüz verilmedi">{o.placedAt ? `${formatDateTime(o.placedAt)} · ${o.placedByName} · ${ORDER_CHANNELS.label(o.placedChannel)}` : null}</Info>
            <Info label="Tedarikçi referansı">{o.supplierRef}</Info>
            <Info label="Sipariş notu">{o.note}</Info>
            <Info label="Oluşturan">{o.createdByName} · {formatDateTime(o.createdAt)}</Info>
            {o.closedAt && <Info label="Kapandı">{formatDateTime(o.closedAt)} · {o.closedByName}{o.closeNote ? ` – ${o.closeNote}` : ""}</Info>}
          </dl>
        </Card>
        {o.totals && (
          <Card title="Tutar">
            <dl>
              <Info label="KDV hariç (kargo dahil)">{formatMoney(o.totals.net, o.currency)}</Info>
              <Info label="KDV">{formatMoney(o.totals.vat, o.currency)}</Info>
              <Info label="KDV dahil toplam"><span className="text-xl font-bold">{formatMoney(o.totals.total, o.currency)}</span></Info>
              <Info label="Kargo (KDV hariç)">{dec(o.shippingAmount).isZero() ? "—" : `${formatMoney(o.shippingAmount, o.currency)} (KDV ${formatPct(o.shippingVatRate)})`}</Info>
            </dl>
            <p className="mt-2 text-sm text-muted">Sipariş tutarıdır; borç değildir. Borç, fatura kaydedilince oluşur.</p>
          </Card>
        )}
      </div>

      <h2 className="mb-2 mt-6 text-lg font-bold">Kalemler</h2>
      <DataTable
        rows={o.lines}
        rowKey={(l) => l.id}
        empty="Henüz kalem yok."
        columns={[
          { label: "#", cell: (l) => l.lineNo },
          {
            label: "Ürün",
            cell: (l) => (
              <>
                <div className="font-semibold">{l.label}</div>
                <div className="text-sm text-muted">{l.packText}{l.code ? ` · Kod ${l.code}` : ""}{l.supplierCode ? ` · Tedarikçi kodu ${l.supplierCode}` : ""}</div>
                {l.allocations.length > 0 && <div className="text-sm text-muted">Talepler: {l.allocations.map((a) => a.requestNo).join(", ")}</div>}
                {l.note && <div className="text-sm text-muted">Not: {l.note}</div>}
              </>
            ),
          },
          { label: "Sipariş", align: "right", cell: (l) => `${formatQty(l.qty)} ${l.unitLabel}` },
          ...(o.showPrices
            ? [
                { label: "Birim fiyat (KDV hariç)", align: "right" as const, cell: (l: (typeof o.lines)[number]) => <>{formatPrice(l.unitPrice, o.currency)}{isPositive(l.discountPct) && <div className="text-sm text-muted">iskonto {formatPct(l.discountPct)}</div>}</> },
                { label: "KDV", align: "right" as const, cell: (l: (typeof o.lines)[number]) => formatPct(l.vatRate) },
                { label: "Net", align: "right" as const, cell: (l: (typeof o.lines)[number]) => formatMoney(l.netAmount, o.currency) },
              ]
            : []),
          { label: "Kabul", align: "right", cell: (l) => formatQty(l.accepted) },
          { label: "Ret", align: "right", cell: (l) => (isPositive(l.rejected) ? <span className="text-red-700">{formatQty(l.rejected)}</span> : "—") },
          { label: "İncelemede", align: "right", cell: (l) => (isPositive(l.held) ? <span className="text-orange-700">{formatQty(l.held)}</span> : "—") },
          { label: "İptal", align: "right", cell: (l) => (isPositive(l.canceledQty) ? formatQty(l.canceledQty) : "—") },
          { label: "Bekleyen", align: "right", cell: (l) => <b>{formatQty(l.pending)}</b> },
          ...(o.showPrices ? [{ label: "Faturalanan", align: "right" as const, cell: (l: (typeof o.lines)[number]) => formatQty(l.invoicedQty) }] : []),
        ]}
      />

      {editable && (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          <AddLine orderId={o.id} placed={placed} currency={o.currency} />
          {o.lines.map((l) => (
            <ActionPanel key={l.id} title={`${l.lineNo}. kalemi düzenle`} tone="secondary" method="PATCH" endpoint={`/api/siparis-kalemleri/${l.id}`}
              extra={{ version: l.version }}
              fields={[
                { name: "qty", label: `Miktar (${l.unitLabel})`, type: "decimal", initial: decimalInput(l.qty), required: true },
                { name: "unitPrice", label: "Birim fiyat (KDV hariç)", type: "decimal", initial: decimalInput(l.unitPrice), required: true },
                { name: "vatRate", label: "KDV %", type: "decimal", initial: decimalInput(l.vatRate) },
                { name: "discountPct", label: "İskonto %", type: "decimal", initial: decimalInput(l.discountPct) },
                { name: "note", label: "Kalem notu", type: "text", initial: l.note ?? "" },
                ...reasonField,
              ]} />
          ))}
          {o.status === "taslak" && o.lines.map((l) => (
            <ActionPanel key={`d${l.id}`} title={`${l.lineNo}. kalemi sil`} tone="danger" method="DELETE" endpoint={`/api/siparis-kalemleri/${l.id}`} description="Yalnızca taslak siparişte kalem silinir. Bağlı talepler yeniden planlamaya döner." />
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-start gap-2">
        {canReceive && <StartReceipt orderId={o.id} draftId={o.draftReceiptId} />}
        {(o.status === "taslak" || placed) && can(ctx.actor, "order.view") && <OrderText orderId={o.id} canPrice={o.showPrices} />}
        {manage && o.status === "taslak" && (
          <ActionPanel title="Sipariş verildi olarak işaretle" endpoint={`/api/siparisler/${o.id}/ver`} extra={{ version: o.version }}
            description="Tedarikçiye siparişi ilettiyseniz işaretleyin. Kullanıcı, tarih ve kanal kaydedilir; bundan sonraki değişiklikler gerekçeyle geçmişe yazılır."
            fields={[
              { name: "channel", label: "Sipariş kanalı", type: "select", required: true, options: ORDER_CHANNELS.items.map((c) => ({ value: c.value, label: c.label })) },
              { name: "expectedOn", label: "Beklenen teslim tarihi", type: "date", required: true, initial: o.expectedOn ?? "" },
              { name: "receiverUserId", label: "Teslim alacak sorumlu", type: "select", required: true, options: receivers, initial: o.receiverUserId ?? "" },
              { name: "supplierRef", label: "Tedarikçi referansı (varsa)", type: "text", initial: o.supplierRef ?? "" },
            ]} />
        )}
        {editable && (
          <ActionPanel title="Sipariş bilgilerini düzenle" tone="secondary" method="PATCH" endpoint={`/api/siparisler/${o.id}`} extra={{ version: o.version }}
            fields={[
              { name: "expectedOn", label: "Beklenen teslim tarihi", type: "date", initial: o.expectedOn ?? "" },
              { name: "receiverUserId", label: "Teslim alacak sorumlu", type: "select", options: receivers, initial: o.receiverUserId ?? "", emptyLabel: "Atanmadı" },
              { name: "shippingAmount", label: "Kargo (KDV hariç)", type: "decimal", initial: decimalInput(o.shippingAmount) },
              { name: "shippingVatRate", label: "Kargo KDV %", type: "decimal", initial: decimalInput(o.shippingVatRate) },
              { name: "supplierRef", label: "Tedarikçi referansı", type: "text", initial: o.supplierRef ?? "" },
              { name: "note", label: "Sipariş notu", type: "textarea", initial: o.note ?? "" },
              ...reasonField,
            ]} />
        )}
        {manage && placed && o.lines.some((l) => isPositive(l.pending)) && (
          <ActionPanel title="Kalan miktarı iptal et" tone="secondary" endpoint={`/api/siparisler/${o.id}/kalan-iptal`}
            description="Gelmeyecek bekleyen miktar iptal edilir (kabul edilmiş sayılmaz). İncelemedeki ürünler önce karara bağlanmalı."
            fields={[{ name: "reason", label: "Gerekçe", type: "textarea", required: true }]} />
        )}
        {manage && placed && (
          <ActionPanel title="Siparişi kapat (tamamlandı)" endpoint={`/api/siparisler/${o.id}/kapat`} extra={{ version: o.version }}
            description={o.closeBlockers.length ? <span className="text-red-800">Şu an kapatılamaz: {o.closeBlockers.join(" ")}</span> : "Bütün kalemler teslim alındı veya kalanı iptal edildi; açık sorun yok."}
            fields={[{ name: "note", label: "Kapanış notu (isteğe bağlı)", type: "text" }]} />
        )}
        {manage && (o.status === "taslak" || (placed && o.receipts.every((r) => r.status === "iptal"))) && (
          <ActionPanel title="Siparişi iptal et" tone="danger" endpoint={`/api/siparisler/${o.id}/iptal`} extra={{ version: o.version }}
            fields={[{ name: "reason", label: "İptal gerekçesi", type: "textarea", required: true }]} />
        )}
      </div>
      {placed && o.closeBlockers.length > 0 && (
        <div className="mt-3"><Notice tone="amber" title="Sipariş henüz kapatılamaz">{o.closeBlockers.map((b) => <div key={b}>• {b}</div>)}</Notice></div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title={`Teslimatlar (${o.receipts.length})`}>
          {o.receipts.length ? (
            <ul className="space-y-2">
              {o.receipts.map((r) => (
                <li key={r.id}>
                  <Link href={`/teslimatlar/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 hover:border-brand">
                    <span><b>{r.receiptNo}</b> · {formatDate(r.receivedOn)} · {r.postedByName ?? r.startedByName}{r.deliveryNoteNo ? ` · irsaliye ${r.deliveryNoteNo}` : ""}</span>
                    <Badge tone={RECEIPT_STATUSES.tone(r.status)}>{RECEIPT_STATUSES.label(r.status)}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-muted">Henüz teslimat kaydı yok.</p>}
        </Card>
        <Card title={`Sorunlar (${o.issues.length})`}>
          {o.issues.length ? (
            <ul className="space-y-2">
              {o.issues.map((i) => (
                <li key={i.id}>
                  <Link href={`/sorunlar/${i.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 hover:border-brand">
                    <span><b>{i.issueNo}</b> · {i.lineNo ? `${i.lineNo}. kalem · ` : ""}{ISSUE_TYPES.label(i.type)}{i.qty ? ` · ${formatQty(i.qty)}` : ""}{i.action ? ` · ${ISSUE_ACTIONS.label(i.action)}` : ""}</span>
                    <Badge tone={ISSUE_STATUSES.tone(i.status)}>{ISSUE_STATUSES.label(i.status)}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-muted">Sorun kaydı yok.</p>}
        </Card>
      </div>
      {o.history.length > 0 && (
        <Card title="Değişiklik geçmişi" className="mt-4">
          <History rows={o.history} />
        </Card>
      )}
    </>
  );
}
