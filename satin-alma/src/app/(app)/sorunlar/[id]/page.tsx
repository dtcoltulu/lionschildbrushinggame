import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionPanel, type FieldSpec } from "@/components/ActionPanel";
import { Files } from "@/components/Files";
import { Badge, Card, Info, Notice, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatQty, isPositive } from "@/lib/decimal";
import { ISSUE_ACTIONS, ISSUE_STATUSES, ISSUE_TYPES, type IssueAction } from "@/lib/labels";
import { isUuid } from "@/lib/validate";
import { AppError } from "@/server/errors";
import { pageCtx } from "@/server/page";
import { can } from "@/server/permissions";
import { listFiles } from "@/server/services/files";
import { getIssue } from "@/server/services/issues";

export const dynamic = "force-dynamic";

/** Sorun türüne göre anlamlı çözüm yolları. */
function actionsFor(type: string, held: boolean, orderLine: boolean): IssueAction[] {
  if (type === "eksik") return ["eksik_bekleniyor", "iptal"];
  if (type === "skt_gecmis") return ["degisim", "iade", "iptal"];
  const accept: IssueAction[] = type === "farkli_marka" || type === "yanlis_urun" ? ["alternatif_kabul"] : ["kabul"];
  return [...(held ? accept : []), "degisim", "iade", ...(held || orderLine ? (["fiyat_duzeltmesi"] as IssueAction[]) : []), ...(orderLine ? (["iptal"] as IssueAction[]) : [])];
}

export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageCtx(["order.view", "issue.report"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const i = await getIssue(ctx, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const [files, receiptFiles] = await Promise.all([listFiles(ctx, "issue", id), i.receiptId ? listFiles(ctx, "receipt", i.receiptId) : Promise.resolve([])]);
  const open = i.status === "acik";
  const resolve = can(ctx.actor, "issue.resolve");
  const held = isPositive(i.qtyHeld);
  const options = actionsFor(i.type, held, !!i.orderLineId).map((a) => ({ value: a, label: ISSUE_ACTIONS.label(a), hint: ISSUE_ACTIONS.items.find((x) => x.value === a)?.hint }));
  const resolveFields: FieldSpec[] = [
    { name: "action", label: "Karar / çözüm", type: "radio", options, initial: i.action ?? "" },
    { name: "returnedOn", label: "Ürün tedarikçiye geri verildiği gün", type: "date", initial: i.returnedOn ?? "", when: { field: "action", in: ["degisim", "iade"] } },
    ...(held ? [{ name: "acceptQty", label: `Kabul edilecek miktar (incelemede ${formatQty(i.qtyHeld)})`, type: "decimal" as const, when: { field: "action", in: ["kabul", "alternatif_kabul", "fiyat_duzeltmesi"] } }] : []),
    ...(!i.orderLineId && held ? [
      { name: "unitPrice", label: "Siparişe eklenecek birim fiyat (KDV hariç)", type: "decimal" as const, when: { field: "action", in: ["kabul"] } },
      { name: "vatRate", label: "KDV %", type: "decimal" as const, when: { field: "action", in: ["kabul"] } },
    ] : []),
    { name: "note", label: "Karar açıklaması", type: "textarea", required: true },
  ];
  return (
    <>
      <PageHeader title={`Sorun ${i.issueNo}`} subtitle={<>Sipariş <Link className="underline" href={`/siparisler/${i.orderId}`}>{i.orderNo}</Link> · {i.supplierName}</>}
        back={{ href: "/sorunlar", label: "Sorunlar" }}
        actions={<div className="flex gap-1.5"><Badge tone={ISSUE_TYPES.tone(i.type)}>{ISSUE_TYPES.label(i.type)}</Badge><Badge tone={ISSUE_STATUSES.tone(i.status)}>{ISSUE_STATUSES.label(i.status)}</Badge></div>} />
      {i.type === "eksik" && open && <div className="mb-4"><Notice tone="blue">Eksik miktar teslim alındığında bu kayıt kendiliğinden çözülür. Gelmeyecekse “Kalan miktar iptal edildi” seçip gerekçe yazın.</Notice></div>}
      {(i.action === "iade" || i.action === "fiyat_duzeltmesi") && (
        <div className="mb-4"><Notice tone="amber" title="Borç kendiliğinden düşmez">Fiziksel iade veya fiyat farkı tedarikçi borcunu ancak finansal düzeltme belgesi (iade faturası / fiyat farkı) girilip onaylanınca azaltır.{i.hasAdjustment ? " Bu soruna bağlı düzeltme kaydı var." : " Bu soruna bağlı düzeltme kaydı henüz yok."}</Notice></div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Sorun">
          <dl>
            <Info label="Siparişteki ürün">{i.orderedLabel ?? "Sipariş dışı ürün"}{i.lineNo ? ` (${i.lineNo}. kalem)` : ""}</Info>
            <Info label="Gerçekte gelen">{i.receivedLabel ?? i.receivedDesc ?? (i.receiptLineId ? "Siparişteki ürün" : null)}</Info>
            <Info label="Etkilenen miktar">{i.qty ? `${formatQty(i.qty)} ${i.unitLabel ?? ""}` : null}</Info>
            <Info label="Açıklama">{i.description}</Info>
            <Info label="Bildiren">{i.reportedByName} · {formatDateTime(i.reportedAt)}</Info>
            {i.receiptNo && <Info label="Teslimat"><Link className="underline" href={`/teslimatlar/${i.receiptId}`}>{i.receiptNo}</Link></Info>}
          </dl>
        </Card>
        <Card title="Teslimat satırı ve durum">
          <dl>
            {i.receiptLineId && <Info label="Kabul / ret / incelemede">{formatQty(i.qtyAccepted)} / {formatQty(i.qtyRejected)} / {formatQty(i.qtyHeld)}</Info>}
            {i.lotNo && <Info label="Lot">{i.lotNo}</Info>}
            {i.expiryDate && <Info label="Son kullanma tarihi">{formatDate(i.expiryDate)}</Info>}
            {i.linePending !== null && <Info label="Kalemde bekleyen">{formatQty(i.linePending)} {i.unitLabel}</Info>}
            <Info label="Çözüm yolu" missing="Seçilmedi">{i.action ? ISSUE_ACTIONS.label(i.action) : null}</Info>
            <Info label="Tedarikçiye geri verildi">{i.returnedOn ? formatDate(i.returnedOn) : null}</Info>
            {!open && <Info label="Çözüm">{i.resolutionNote} · {i.resolvedByName} · {formatDateTime(i.resolvedAt)}</Info>}
          </dl>
        </Card>
      </div>
      {open && (
        <div className="mt-4 flex flex-wrap items-start gap-2">
          {resolve && <ActionPanel title="Karar ver / çöz" endpoint={`/api/sorunlar/${i.id}/coz`} extra={{ version: i.version }} fields={resolveFields} />}
          {(can(ctx.actor, "issue.report") || resolve) && (
            <ActionPanel title="Bilgi güncelle" tone="secondary" method="PATCH" endpoint={`/api/sorunlar/${i.id}`} extra={{ version: i.version }}
              fields={[
                { name: "description", label: "Açıklama", type: "textarea", initial: i.description ?? "" },
                { name: "returnedOn", label: "Ürün tedarikçiye geri verildiği gün", type: "date", initial: i.returnedOn ?? "" },
                ...(resolve ? [{ name: "action", label: "Çözüm yolu (karar vermeden)", type: "select" as const, options: options.map((o) => ({ value: o.value, label: o.label })), initial: i.action ?? "", emptyLabel: "Seçilmedi" }] : []),
              ]} />
          )}
        </div>
      )}
      <Card title="Sorun fotoğrafları" className="mt-4">
        <Files entity="issue" entityId={i.id} files={files} canUpload={open && (can(ctx.actor, "issue.report") || resolve)} />
        {receiptFiles.length > 0 && (
          <>
            <h3 className="mb-2 mt-4 font-semibold">Teslimatta çekilen fotoğraflar</h3>
            <Files entity="receipt" entityId={i.receiptId!} files={receiptFiles} canUpload={false} />
          </>
        )}
      </Card>
    </>
  );
}
