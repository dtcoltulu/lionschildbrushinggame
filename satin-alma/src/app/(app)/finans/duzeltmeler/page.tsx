import { ActionPanel } from "@/components/ActionPanel";
import { FinanceTabs } from "@/components/FinanceTabs";
import { Badge, DataTable, Notice, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/decimal";
import { ADJ_DIRECTIONS, ADJ_STATUSES, ADJ_TYPES, CURRENCIES } from "@/lib/labels";
import { pageCtx } from "@/server/page";
import { can } from "@/server/permissions";
import { listAdjustments } from "@/server/services/adjustments";
import { listIssues } from "@/server/services/issues";
import { supplierOptions } from "@/server/services/suppliers";

export const dynamic = "force-dynamic";

export default async function AdjustmentsPage() {
  const ctx = await pageCtx("finance.view");
  const [rows, suppliers, issues, invoices] = await Promise.all([
    listAdjustments(ctx), supplierOptions(ctx.db), listIssues(ctx, { status: "tumu" }),
    ctx.db.query<{ id: string; label: string }>(`select i.id, s.name || ' · ' || coalesce(i.invoice_no, 'açılış') || ' · ' || to_char(i.invoice_date, 'DD.MM.YYYY') as label from invoices i join suppliers s on s.id = i.supplier_id where i.canceled_at is null order by i.invoice_date desc limit 300`),
  ]);
  const expecting = issues.filter((i) => (i.action === "iade" || i.action === "fiyat_duzeltmesi") && !i.hasAdjustment);
  const manage = can(ctx.actor, "finance.manage");
  return (
    <>
      <PageHeader title="Finansal düzeltmeler" subtitle="İade faturası, fiyat farkı, sonradan iskonto, kur farkı. Bakiyeye yalnızca onaylanınca yansır." />
      <FinanceTabs current="duzeltmeler" />
      {expecting.length > 0 && (
        <div className="mb-4">
          <Notice tone="amber" title={`Düzeltme belgesi beklenen ${expecting.length} teslimat sorunu`}>
            Fiziksel iade veya fiyat farkı borcu kendiliğinden düşürmez. Tedarikçinin belgesi gelince aşağıdan girin ve soruna bağlayın:
            <ul className="mt-1 list-disc pl-5">{expecting.map((i) => <li key={i.id}>{i.issueNo} · {i.supplierName} · sipariş {i.orderNo} · {i.orderedLabel ?? i.receivedDesc}</li>)}</ul>
          </Notice>
        </div>
      )}
      <DataTable rows={rows} rowKey={(a) => a.id} empty="Düzeltme kaydı yok."
        columns={[
          { label: "No", cell: (a) => <b>{a.adjustmentNo}</b> },
          { label: "Tedarikçi", cell: (a) => a.supplierName },
          { label: "Tarih", cell: (a) => formatDate(a.adjDate) },
          { label: "Tür / belge", cell: (a) => <>{ADJ_TYPES.label(a.type)}{a.documentNo ? ` · ${a.documentNo}` : ""}<div className="text-sm text-muted">{a.description}{a.invoiceNo ? ` · fatura ${a.invoiceNo}` : ""}{a.issueNo ? ` · sorun ${a.issueNo}` : ""}</div></> },
          { label: "Etkisi", cell: (a) => <Badge tone={ADJ_DIRECTIONS.tone(a.direction)}>{ADJ_DIRECTIONS.label(a.direction)}</Badge> },
          { label: "Tutar (KDV dahil)", align: "right", cell: (a) => formatMoney(a.totalAmount, a.currency) },
          { label: "Durum", cell: (a) => <><Badge tone={ADJ_STATUSES.tone(a.status)}>{ADJ_STATUSES.label(a.status)}</Badge><div className="text-sm text-muted">{a.createdByName}{a.approvedByName ? ` → onay ${a.approvedByName}` : ""}</div></> },
          ...(manage ? [{ label: "", cell: (a: (typeof rows)[number]) => a.status === "iptal" ? null : (
            <div className="flex flex-col gap-1">
              {a.status === "onay_bekliyor" && can(ctx.actor, "adjustment.approve") && <ActionPanel title="Onayla" endpoint={`/api/duzeltmeler/${a.id}/onayla`} extra={{ version: a.version }} description="Onaylanınca tedarikçi bakiyesine yansır." />}
              <ActionPanel title="İptal" tone="danger" endpoint={`/api/duzeltmeler/${a.id}/iptal`} extra={{ version: a.version }} fields={[{ name: "reason", label: "Gerekçe", type: "text", required: true }]} />
            </div>
          ) }] : []),
        ]} />
      {manage && (
        <div className="mt-4">
          <ActionPanel title="+ Düzeltme belgesi gir" endpoint="/api/duzeltmeler"
            fields={[
              { name: "supplierId", label: "Tedarikçi", type: "select", required: true, options: suppliers },
              { name: "type", label: "Tür", type: "select", required: true, options: ADJ_TYPES.items.map((t) => ({ value: t.value, label: t.label })) },
              { name: "direction", label: "Etkisi", type: "radio", initial: "borc_azaltir", options: ADJ_DIRECTIONS.items.map((d) => ({ value: d.value, label: d.label })) },
              { name: "adjDate", label: "Belge tarihi", type: "date", required: true, initial: ctx.today },
              { name: "currency", label: "Para birimi", type: "select", initial: "TRY", options: CURRENCIES.items.map((c) => ({ value: c.value, label: c.label })) },
              { name: "netAmount", label: "Tutar (KDV hariç)", type: "decimal", required: true },
              { name: "vatAmount", label: "KDV tutarı", type: "decimal" },
              { name: "documentNo", label: "Belge no", type: "text" },
              { name: "invoiceId", label: "İlgili fatura (isteğe bağlı)", type: "select", options: invoices.map((i) => ({ value: i.id, label: i.label })), emptyLabel: "Bağlama" },
              { name: "issueId", label: "İlgili teslimat sorunu (isteğe bağlı)", type: "select", options: issues.map((i) => ({ value: i.id, label: `${i.issueNo} · ${i.supplierName} · ${i.orderNo}` })), emptyLabel: "Bağlama" },
              { name: "description", label: "Açıklama", type: "textarea", required: true },
            ]} />
        </div>
      )}
    </>
  );
}
