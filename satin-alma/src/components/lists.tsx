import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/decimal";
import { DELIVERY_STATES, INVOICE_KINDS, INVOICE_REVIEWS, ISSUE_ACTIONS, ISSUE_STATUSES, ISSUE_TYPES, ORDER_STATUSES, REQUEST_PROGRESS, URGENCIES } from "@/lib/labels";
import type { SupplierBalance } from "@/server/services/balances";
import type { InvoiceSummary } from "@/server/services/invoices";
import type { IssueRow } from "@/server/services/issues";
import type { OrderSummary } from "@/server/services/orders";
import type { RequestRow } from "@/server/services/requests";
import { Badge, DataTable, EmptyState } from "./ui";

export function RequestList({ rows, showRequester = true, empty = "Talep yok." }: { rows: RequestRow[]; showRequester?: boolean; empty?: string }) {
  if (!rows.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/talepler/${r.id}`} className="card block p-3 hover:border-brand">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-muted">{r.requestNo} · {formatDateTime(r.requestedAt)}</div>
                <div className="text-[17px] font-semibold">{r.label}</div>
                <div className="text-[15px] text-slate-700">
                  {formatQty(r.qty)} {r.unitLabel}
                  {r.locationName && ` · ${r.locationName}`}
                  {showRequester && ` · ${r.requesterName}`}
                  {r.neededBy && ` · ihtiyaç ${formatDate(r.neededBy)}`}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.urgency !== "normal" && <Badge tone={URGENCIES.tone(r.urgency)}>{URGENCIES.label(r.urgency)}</Badge>}
                <Badge tone={REQUEST_PROGRESS.tone(r.progress)}>{r.progressLabel}</Badge>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function OrderTable({ rows, empty = "Sipariş yok." }: { rows: OrderSummary[]; empty?: string }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(o) => o.id}
      empty={empty}
      columns={[
        { label: "Sipariş", cell: (o) => <Link className="font-bold text-brand hover:underline" href={`/siparisler/${o.id}`}>{o.orderNo}</Link> },
        { label: "Tedarikçi", cell: (o) => o.supplierName },
        { label: "Sipariş", cell: (o) => <Badge tone={ORDER_STATUSES.tone(o.status)}>{ORDER_STATUSES.label(o.status)}</Badge> },
        { label: "Teslimat", cell: (o) => (o.deliveryState === "yok" ? "—" : <Badge tone={DELIVERY_STATES.tone(o.deliveryState)}>{DELIVERY_STATES.label(o.deliveryState)}</Badge>) },
        { label: "Beklenen", cell: (o) => (o.overdue ? <Badge tone="orange">Gecikti · {formatDate(o.expectedOn)}</Badge> : formatDate(o.expectedOn)) },
        { label: "Teslim alacak", cell: (o) => o.receiverName ?? "—" },
        { label: "Sorun", cell: (o) => (o.openIssues ? <Badge tone="red">{o.openIssues} açık</Badge> : o.draftReceiptId ? <Badge tone="amber">Kontrol sürüyor</Badge> : "—") },
        { label: "Tutar (KDV dahil)", align: "right", cell: (o) => (o.total === null ? "—" : formatMoney(o.total, o.currency)) },
      ]}
    />
  );
}

export function IssueList({ rows, empty = "Açık sorun yok." }: { rows: IssueRow[]; empty?: string }) {
  if (!rows.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="space-y-2">
      {rows.map((i) => (
        <li key={i.id}>
          <Link href={`/sorunlar/${i.id}`} className="card block p-3 hover:border-brand">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-muted">{i.issueNo} · sipariş {i.orderNo} · {i.supplierName}</div>
                <div className="font-semibold">{i.orderedLabel ?? i.receivedLabel ?? i.receivedDesc ?? "Sipariş dışı ürün"}</div>
                <div className="text-sm text-slate-700">
                  {i.qty && `${formatQty(i.qty)} ${i.unitLabel ?? ""}`}
                  {i.action && ` · ${ISSUE_ACTIONS.label(i.action)}`}
                  {i.returnedOn && ` · geri verildi ${formatDate(i.returnedOn)}`}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={ISSUE_TYPES.tone(i.type)}>{ISSUE_TYPES.label(i.type)}</Badge>
                <Badge tone={ISSUE_STATUSES.tone(i.status)}>{ISSUE_STATUSES.label(i.status)}</Badge>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const DUE_TONES = { gecikti: "red", yaklasiyor: "amber", acik: "gray", odendi: "green", iptal: "gray" } as const;
const DUE_LABELS = { gecikti: "Vadesi geçti", yaklasiyor: "Vadesi yaklaşıyor", acik: "Açık", odendi: "Ödendi", iptal: "İptal edildi" } as const;

export function DueBadge({ i }: { i: Pick<InvoiceSummary, "dueState" | "daysToDue"> }) {
  const extra = i.dueState === "gecikti" ? ` (${-i.daysToDue!} gün)` : i.dueState === "yaklasiyor" ? ` (${i.daysToDue} gün)` : "";
  return <Badge tone={DUE_TONES[i.dueState]}>{DUE_LABELS[i.dueState]}{extra}</Badge>;
}

export function InvoiceTable({ rows, empty = "Fatura yok." }: { rows: InvoiceSummary[]; empty?: string }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(i) => i.id}
      empty={empty}
      columns={[
        { label: "Fatura", cell: (i) => <Link className="font-bold text-brand hover:underline" href={`/finans/faturalar/${i.id}`}>{i.kind === "acilis" ? INVOICE_KINDS.label("acilis") : i.invoiceNo}</Link> },
        { label: "Tedarikçi", cell: (i) => i.supplierName },
        { label: "Tarih", cell: (i) => formatDate(i.invoiceDate) },
        { label: "Vade", cell: (i) => formatDate(i.dueDate) },
        { label: "Toplam (KDV dahil)", align: "right", cell: (i) => formatMoney(i.total, i.currency) },
        { label: "Kalan", align: "right", cell: (i) => <span className="font-semibold">{formatMoney(i.open, i.currency)}</span> },
        { label: "Durum", cell: (i) => <DueBadge i={i} /> },
        { label: "Fark", cell: (i) => (i.reviewStatus === "yok" ? "—" : <Badge tone={INVOICE_REVIEWS.tone(i.reviewStatus)}>{INVOICE_REVIEWS.label(i.reviewStatus)}</Badge>) },
      ]}
    />
  );
}

export function BalanceTable({ rows }: { rows: SupplierBalance[] }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(b) => `${b.supplierId}-${b.currency}`}
      empty="Açık bakiye yok."
      columns={[
        { label: "Tedarikçi", cell: (b) => <Link className="font-semibold text-brand hover:underline" href={`/tedarikciler/${b.supplierId}`}>{b.supplierName}</Link> },
        { label: "Bakiye (borç)", align: "right", cell: (b) => <span className="font-bold">{formatMoney(b.balance, b.currency)}</span> },
        { label: "Vadesi geçmiş", align: "right", cell: (b) => (b.overdue === "0.00" ? "—" : <span className="font-semibold text-red-700">{formatMoney(b.overdue, b.currency)}</span>) },
        { label: "7 gün içinde", align: "right", cell: (b) => (b.dueSoon === "0.00" ? "—" : formatMoney(b.dueSoon, b.currency)) },
        { label: "Avans (faturaya bağlanmamış ödeme)", align: "right", cell: (b) => (b.unallocated === "0.00" ? "—" : formatMoney(b.unallocated, b.currency)) },
        { label: "Açık satın alma taahhüdü", align: "right", cell: (b) => (b.commitment === "0.00" ? "—" : formatMoney(b.commitment, b.currency)) },
      ]}
    />
  );
}
