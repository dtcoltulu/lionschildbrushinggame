import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionPanel } from "@/components/ActionPanel";
import { BalanceTable, InvoiceTable, OrderTable } from "@/components/lists";
import { Card, DataTable, Info, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/decimal";
import { ADJ_DIRECTIONS, ADJ_STATUSES, ADJ_TYPES, CURRENCIES, PAYMENT_METHODS } from "@/lib/labels";
import { isUuid } from "@/lib/validate";
import { pageCtx } from "@/server/page";
import { can } from "@/server/permissions";
import { listAdjustments } from "@/server/services/adjustments";
import { supplierBalances } from "@/server/services/balances";
import { listInvoices } from "@/server/services/invoices";
import { listOrders } from "@/server/services/orders";
import { listPayments } from "@/server/services/payments";
import { getSupplier } from "@/server/services/suppliers";
import { supplierFields } from "@/server/supplier-fields";

export const dynamic = "force-dynamic";

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageCtx("supplier.view");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const s = await getSupplier(ctx, id);
  if (!s) notFound();
  const finance = can(ctx.actor, "finance.view");
  const [orders, balances, invoices, payments, adjustments] = await Promise.all([
    can(ctx.actor, "order.view") ? listOrders(ctx, { supplierId: id }) : Promise.resolve([]),
    finance ? supplierBalances(ctx, { supplierId: id }) : Promise.resolve([]),
    finance ? listInvoices(ctx, { supplierId: id }) : Promise.resolve([]),
    finance ? listPayments(ctx, { supplierId: id }) : Promise.resolve([]),
    finance ? listAdjustments(ctx, { supplierId: id }) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title={s.name} subtitle={s.active ? undefined : "Pasif tedarikçi"} back={{ href: "/tedarikciler", label: "Tedarikçiler" }}
        actions={finance ? <><Link className="btn btn-primary" href={`/finans/faturalar/yeni?tedarikci=${id}`}>+ Fatura</Link><Link className="btn btn-secondary" href={`/finans/odemeler/yeni?tedarikci=${id}`}>+ Ödeme</Link></> : undefined} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Tedarikçi kartı" className="lg:col-span-2">
          <dl className="grid gap-x-6 sm:grid-cols-2">
            <Info label="İlgili kişi">{s.contactName}</Info>
            <Info label="Telefon">{s.phone}</Info>
            <Info label="E-posta">{s.email}</Info>
            <Info label="Ödeme koşulları">{s.paymentTerms}</Info>
            <Info label="Varsayılan vade">{s.dueDays != null ? `${s.dueDays} gün` : null}</Info>
            <Info label="Para birimi">{CURRENCIES.label(s.currency)}</Info>
            <Info label="Notlar">{s.notes}</Info>
          </dl>
        </Card>
        {can(ctx.actor, "supplier.manage") && (
          <div><ActionPanel title="Kartı düzenle" tone="secondary" method="PATCH" endpoint={`/api/tedarikciler/${id}`} extra={{ version: s.version }} fields={supplierFields(s)} /></div>
        )}
      </div>
      {finance && (
        <section className="mt-6 space-y-4">
          <h2 className="text-xl font-bold">Borç ve ödemeler</h2>
          <BalanceTable rows={balances} />
          <Card title="Faturalar">
            <InvoiceTable rows={invoices} />
          </Card>
          <Card title="Ödemeler">
            <DataTable rows={payments} rowKey={(p) => p.id} empty="Ödeme yok."
              columns={[
                { label: "Ödeme", cell: (p) => <Link className="font-semibold text-brand hover:underline" href={`/finans/odemeler/${p.id}`}>{p.paymentNo}</Link> },
                { label: "Tarih", cell: (p) => formatDate(p.paidOn) },
                { label: "Yöntem", cell: (p) => PAYMENT_METHODS.label(p.method) },
                { label: "Tutar", align: "right", cell: (p) => <span className={p.canceledAt ? "line-through" : ""}>{formatMoney(p.amount, p.currency)}</span> },
                { label: "Avans (dağıtılmamış)", align: "right", cell: (p) => (p.canceledAt ? "İptal" : p.unallocated === "0.00" ? "—" : formatMoney(p.unallocated, p.currency)) },
              ]} />
          </Card>
          <Card title="Finansal düzeltmeler">
            <DataTable rows={adjustments} rowKey={(a) => a.id} empty="Düzeltme yok."
              columns={[
                { label: "No", cell: (a) => a.adjustmentNo },
                { label: "Tarih", cell: (a) => formatDate(a.adjDate) },
                { label: "Tür", cell: (a) => ADJ_TYPES.label(a.type) },
                { label: "Etkisi", cell: (a) => ADJ_DIRECTIONS.label(a.direction) },
                { label: "Tutar", align: "right", cell: (a) => formatMoney(a.totalAmount, a.currency) },
                { label: "Durum", cell: (a) => ADJ_STATUSES.label(a.status) },
              ]} />
          </Card>
          {can(ctx.actor, "finance.manage") && (
            <ActionPanel title="Açılış (başlangıç) borcu gir" tone="secondary" endpoint="/api/acilis-bakiyesi" extra={{ supplierId: id }}
              description="Uygulamaya geçmeden önceki borç. Tedarikçi ve para birimi başına bir kez girilir; ödemeler buna da dağıtılabilir."
              fields={[
                { name: "date", label: "Bakiye tarihi", type: "date", required: true },
                { name: "amount", label: "Tutar", type: "decimal", required: true },
                { name: "currency", label: "Para birimi", type: "select", options: CURRENCIES.items.map((c) => ({ value: c.value, label: c.label })), initial: s.currency },
                { name: "dueDate", label: "Vade (varsa)", type: "date" },
                { name: "documentNo", label: "Ekstre / belge no", type: "text" },
                { name: "description", label: "Açıklama", type: "text", required: true, placeholder: "30.09.2026 itibarıyla cari hesap ekstresi" },
              ]} />
          )}
        </section>
      )}
      {orders.length > 0 && (
        <Card title="Siparişler ve teslimatlar" className="mt-6">
          <OrderTable rows={orders} />
        </Card>
      )}
    </>
  );
}
