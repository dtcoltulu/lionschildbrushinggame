import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionPanel } from "@/components/ActionPanel";
import { Files } from "@/components/Files";
import { Badge, Card, DataTable, Notice, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { decimalInput, formatQty, isPositive } from "@/lib/decimal";
import { ISSUE_STATUSES, ISSUE_TYPES, RECEIPT_STATUSES } from "@/lib/labels";
import { isUuid } from "@/lib/validate";
import { AppError } from "@/server/errors";
import { pageCtx } from "@/server/page";
import { can } from "@/server/permissions";
import { listFiles } from "@/server/services/files";
import { getReceipt } from "@/server/services/receipts";
import { getVariant } from "@/server/services/catalog";
import { ReceiptCheck, type CheckLine } from "./ReceiptCheck";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageCtx(["order.view", "receipt.record"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const r = await getReceipt(ctx, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const files = await listFiles(ctx, "receipt", id);
  const canRecord = can(ctx.actor, "receipt.record") && (can(ctx.actor, "order.manage") || r.order.receiverUserId === ctx.actor.userId);
  const draft = r.status === "taslak";
  const lineNo = new Map(r.orderLines.map((l) => [l.id, l]));
  const initial: CheckLine[] = await Promise.all(
    r.lines.map(async (l) => {
      const v = l.receivedVariantId ? await getVariant(ctx.db, l.receivedVariantId) : null;
      return {
        orderLineId: l.orderLineId, receivedDesc: l.receivedDesc ?? "", qtyPhysical: decimalInput(l.qtyPhysical), qtyAccepted: decimalInput(l.qtyAccepted),
        qtyRejected: decimalInput(l.qtyRejected), qtyHeld: decimalInput(l.qtyHeld), lotNo: l.lotNo ?? "", expiryDate: l.expiryDate ?? "", chkProduct: l.chkProduct,
        chkVariant: l.chkVariant, chkPackage: l.chkPackage, issueType: l.issueType ?? "", issueNote: l.issueNote ?? "", manual: true,
        receivedVariant: v ? { id: v.id, label: v.label, packText: v.packText, orderUnit: v.orderUnit, baseUnit: v.baseUnit, packSize: v.packSize, code: v.code, categoryName: v.categoryName, defaultVatRate: v.defaultVatRate, trackExpiry: v.trackExpiry, trackLot: v.trackLot } : null,
      };
    }),
  );
  return (
    <>
      <PageHeader
        title={`Teslimat kontrolü ${r.receiptNo}`}
        subtitle={<>Sipariş <Link className="underline" href={`/siparisler/${r.order.id}`}>{r.order.orderNo}</Link> · {r.order.supplierName}{r.order.expectedOn ? ` · beklenen ${formatDate(r.order.expectedOn)}` : ""}</>}
        back={{ href: `/siparisler/${r.order.id}`, label: "Sipariş" }}
        actions={<Badge tone={RECEIPT_STATUSES.tone(r.status)}>{RECEIPT_STATUSES.label(r.status)}</Badge>}
      />
      {draft && canRecord ? (
        <>
          <div className="mb-4">
            <Notice tone="blue" title="Her kalemi ayrı kontrol edin">
              Gelen miktarı sayın; doğru ürün/marka/ölçü, ambalaj, son kullanma tarihi ve lot numarasını kontrol edin. SKT geçmiş ürün kabul edilmez.
              Siparişten farklı, hasarlı, lotsuz veya kısa miatlı ürünü “yönetim incelemesine” alın ya da reddedin. Gelmeyen ürünü boş bırakın.
            </Notice>
          </div>
          <ReceiptCheck receiptId={r.id} version={r.version} receivedOn={r.receivedOn} deliveryNoteNo={r.deliveryNoteNo} note={r.note} today={ctx.today} orderLines={r.orderLines} initialLines={initial} />
        </>
      ) : (
        <>
          {r.status === "iptal" && <div className="mb-4"><Notice tone="red" title="Bu teslimat kaydı iptal edildi (ters kayıt)">{r.cancelReason} · {formatDateTime(r.canceledAt)}</Notice></div>}
          {draft && <div className="mb-4"><Notice tone="amber">Bu teslimat kontrolü sürüyor; yalnızca atanan teslimat sorumlusu veya satın alma kaydedebilir.</Notice></div>}
          <Card title={`Kaydedildi: ${formatDateTime(r.postedAt)} · ${r.postedByName ?? r.startedByName}`}>
            <p className="mb-2 text-[15px]">Teslim alma {formatDate(r.receivedOn)}{r.deliveryNoteNo ? ` · irsaliye ${r.deliveryNoteNo}` : ""}{r.note ? ` · ${r.note}` : ""}</p>
            <DataTable
              rows={r.lines}
              rowKey={(l) => l.id}
              columns={[
                { label: "Kalem", cell: (l) => (l.orderLineId ? `${lineNo.get(l.orderLineId)?.lineNo}. ${lineNo.get(l.orderLineId)?.label}` : "Sipariş dışı") },
                { label: "Gerçekte gelen", cell: (l) => l.receivedLabel ?? l.receivedDesc ?? "Siparişteki ürün" },
                { label: "Gelen", align: "right", cell: (l) => formatQty(l.qtyPhysical) },
                { label: "Kabul", align: "right", cell: (l) => formatQty(l.qtyAccepted) },
                { label: "Ret", align: "right", cell: (l) => (isPositive(l.qtyRejected) ? formatQty(l.qtyRejected) : "—") },
                { label: "İnceleme", align: "right", cell: (l) => (isPositive(l.qtyHeld) ? formatQty(l.qtyHeld) : "—") },
                { label: "Lot", cell: (l) => l.lotNo ?? "—" },
                { label: "SKT", cell: (l) => formatDate(l.expiryDate) },
                { label: "Kontrol", cell: (l) => [!l.chkProduct && "ürün yanlış", !l.chkVariant && "varyant farklı", !l.chkPackage && "ambalaj hasarlı"].filter(Boolean).join(", ") || "uygun" },
              ]}
            />
          </Card>
          {r.issues.length > 0 && (
            <Card title="Açılan sorunlar" className="mt-4">
              <ul className="space-y-2">
                {r.issues.map((i) => (
                  <li key={i.id}>
                    <Link href={`/sorunlar/${i.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 hover:border-brand">
                      <span><b>{i.issueNo}</b> · {ISSUE_TYPES.label(i.type)}{i.qty ? ` · ${formatQty(i.qty)}` : ""}</span>
                      <Badge tone={ISSUE_STATUSES.tone(i.status)}>{ISSUE_STATUSES.label(i.status)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {r.status === "kaydedildi" && can(ctx.actor, "receipt.cancel") && r.order.status === "verildi" && (
            <div className="mt-4">
              <ActionPanel title="Teslimat kaydını iptal et (ters kayıt)" tone="danger" endpoint={`/api/teslimatlar/${r.id}/iptal`} extra={{ version: r.version }}
                description="Yanlış girilmiş teslimat için. Kabul edilen miktarlar geri alınır, bu teslimatın açık sorunları kapanır; kayıt silinmez."
                fields={[{ name: "reason", label: "Gerekçe", type: "textarea", required: true }]} />
            </div>
          )}
        </>
      )}
      <Card title="Teslimat fotoğrafları (irsaliye, hasarlı ambalaj, etiket)" className="mt-4">
        <Files entity="receipt" entityId={r.id} files={files} canUpload={canRecord && r.status !== "iptal"} pdf />
      </Card>
    </>
  );
}
