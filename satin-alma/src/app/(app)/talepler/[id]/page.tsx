import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionPanel } from "@/components/ActionPanel";
import { Files } from "@/components/Files";
import { History } from "@/components/History";
import { Badge, Card, Info, Notice, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatQty } from "@/lib/decimal";
import { ORDER_STATUSES, REQUEST_PROGRESS, STOCK_STATES, URGENCIES } from "@/lib/labels";
import { isUuid } from "@/lib/validate";
import { AppError } from "@/server/errors";
import { firstParam, pageCtx, type SearchParams } from "@/server/page";
import { can } from "@/server/permissions";
import { listFiles } from "@/server/services/files";
import { getRequest } from "@/server/services/requests";
import { MatchForm } from "./MatchForm";

export const dynamic = "force-dynamic";

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx("request.create");
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const r = await getRequest(ctx, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const files = await listFiles(ctx, "request", id);
  const decide = can(ctx.actor, "request.decide");
  const own = r.requestedBy === ctx.actor.userId;
  const open = ["beklemede", "onaylandi"].includes(r.status);
  const baseUnit = r.baseUnit ?? r.unitLabel;
  return (
    <>
      <PageHeader title={`Talep ${r.requestNo}`} subtitle={r.label} back={{ href: "/talepler", label: "Talepler" }}
        actions={<Badge tone={REQUEST_PROGRESS.tone(r.progress)}>{r.progressLabel}</Badge>} />
      {firstParam(sp.yeni) && <div className="mb-4"><Notice tone="green" title="Talebiniz gönderildi.">Durumunu bu sayfadan ve “Taleplerim” listesinden izleyebilirsiniz.</Notice></div>}
      {r.status === "reddedildi" && <div className="mb-4"><Notice tone="red" title="Talep reddedildi">{r.decisionNote}</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Talep" className="lg:col-span-2">
          <dl className="grid gap-x-6 sm:grid-cols-2">
            <Info label="Ürün">{r.label}</Info>
            <Info label="Durum">{STOCK_STATES.label(r.stockState)}</Info>
            <Info label="İstenen miktar">{formatQty(r.qty)} {r.unitLabel}{r.unitKind === "siparis" && r.orderUnit !== r.baseUnit && r.baseUnit ? ` (= ${formatQty(r.needBase)} ${r.baseUnit})` : ""}</Info>
            <Info label="Bildirilen kalan (sayım değil)">{r.remainingQty ? `${formatQty(r.remainingQty)} ${r.unitLabel}` : null}</Info>
            <Info label="Aciliyet"><Badge tone={URGENCIES.tone(r.urgency)}>{URGENCIES.label(r.urgency)}</Badge></Info>
            <Info label="İhtiyaç tarihi">{r.neededBy ? formatDate(r.neededBy) : null}</Info>
            <Info label="Oda / bölüm">{r.locationName}</Info>
            <Info label="Talep eden">{r.requesterName} · {formatDateTime(r.requestedAt)}</Info>
            <Info label="Açıklama">{r.note}</Info>
            {r.extraNeedReason && <Info label="Ek ihtiyaç gerekçesi (açık talep/sipariş varken)">{r.extraNeedReason}</Info>}
            {r.decidedByName && <Info label="Değerlendiren">{r.decidedByName} · {formatDateTime(r.decidedAt)}{r.decisionNote ? ` – ${r.decisionNote}` : ""}</Info>}
          </dl>
        </Card>
        <Card title="Karşılanma">
          <dl>
            <Info label="İhtiyaç">{r.variantId ? `${formatQty(r.needBase)} ${baseUnit}` : "Katalog eşleştirmesi bekliyor"}</Info>
            <Info label="Siparişe bağlanan">{formatQty(r.allocBase)} {baseUnit}</Info>
            <Info label="Verilmiş siparişte">{formatQty(r.orderedBase)} {baseUnit}</Info>
            <Info label="Teslim alınan (kabul edilen)">{formatQty(r.recvBase)} {baseUnit}</Info>
          </dl>
          {r.allocations.length > 0 && (
            <ul className="mt-2 space-y-1 text-[15px]">
              {r.allocations.map((a) => (
                <li key={a.orderLineId}>
                  {can(ctx.actor, "order.view") ? <Link className="font-semibold text-brand underline" href={`/siparisler/${a.orderId}`}>{a.orderNo}</Link> : a.orderNo}
                  {" "}· {a.supplierName} · {formatQty(a.qtyBase)} {baseUnit} · {ORDER_STATUSES.label(a.orderStatus)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {r.openNeeds && (r.openNeeds.requests.length > 0 || r.openNeeds.orders.length > 0) && (
        <div className="mt-4">
          <Notice tone="amber" title="Aynı ürün için başka açık talep / beklenen sipariş">
            <ul className="list-disc pl-5">
              {r.openNeeds.requests.map((x) => <li key={x.id}><Link className="underline" href={`/talepler/${x.id}`}>{x.requestNo}</Link>: {formatQty(x.qty)} {x.unitLabel} – {x.progressLabel} ({x.requesterName})</li>)}
              {r.openNeeds.orders.map((o) => <li key={o.orderId}><Link className="underline" href={`/siparisler/${o.orderId}`}>{o.orderNo}</Link> ({o.supplierName}): {formatQty(o.pendingQty)} {o.unitLabel} bekleniyor</li>)}
            </ul>
          </Notice>
        </div>
      )}

      {open && (decide || own) && (
        <Card title="İşlemler" className="mt-4">
          <div className="flex flex-wrap items-start gap-2">
            {decide && !r.variantId && <div className="w-full"><MatchForm requestId={r.id} version={r.version} unitLabel={r.unitLabel} /></div>}
            {decide && r.status === "beklemede" && (
              <ActionPanel title="Onayla" endpoint={`/api/talepler/${r.id}/karar`} extra={{ version: r.version, decision: "onayla" }}
                fields={[{ name: "note", label: "Not (isteğe bağlı)", type: "textarea" }]} />
            )}
            {decide && r.variantId && r.progress !== "teslim_alindi" && <Link className="btn btn-secondary" href="/siparisler/planla">Siparişe ekle →</Link>}
            {decide && r.allocations.length === 0 && (
              <ActionPanel title="Reddet" tone="danger" endpoint={`/api/talepler/${r.id}/karar`} extra={{ version: r.version, decision: "reddet" }}
                fields={[{ name: "note", label: "Ret gerekçesi (talep eden görür)", type: "textarea", required: true }]} />
            )}
            {(own || decide) && r.allocations.length === 0 && (r.status === "beklemede" || decide) && (
              <ActionPanel title={own && !decide ? "Talebi geri çek" : "İptal et"} tone="secondary" endpoint={`/api/talepler/${r.id}/iptal`} extra={{ version: r.version }}
                fields={[{ name: "reason", label: decide && !own ? "İptal gerekçesi" : "Gerekçe (isteğe bağlı)", type: "text", required: decide && !own }]} />
            )}
          </div>
        </Card>
      )}

      <Card title="Fotoğraflar" className="mt-4">
        <Files entity="request" entityId={r.id} files={files} canUpload={own || decide} />
      </Card>
      {decide && (
        <Card title="İşlem geçmişi" className="mt-4">
          <History rows={r.history} />
        </Card>
      )}
    </>
  );
}
