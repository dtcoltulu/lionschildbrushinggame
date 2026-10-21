import { notFound } from "next/navigation";
import { ActionPanel } from "@/components/ActionPanel";
import { Files } from "@/components/Files";
import { Card, DataTable, Info, Notice, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { decimalInput, formatPct, formatPrice, formatQty } from "@/lib/decimal";
import { CURRENCIES } from "@/lib/labels";
import { isUuid } from "@/lib/validate";
import { firstParam, pageCtx, type SearchParams } from "@/server/page";
import { can } from "@/server/permissions";
import { getVariant, lastPurchase, priceHistory, variantSuppliers } from "@/server/services/catalog";
import { listFiles } from "@/server/services/files";
import { listLookup } from "@/server/services/lookups";
import { openNeeds } from "@/server/services/requests";
import { supplierOptions } from "@/server/services/suppliers";
import { VariantForm } from "../VariantForm";

export const dynamic = "force-dynamic";

const SOURCE = { fatura: "Fatura", siparis: "Sipariş", teklif: "Teklif" } as const;

export default async function VariantPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx("catalog.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const v = await getVariant(ctx.db, id);
  if (!v) notFound();
  const prices = can(ctx.actor, "price.view");
  const manage = can(ctx.actor, "catalog.manage");
  const [prefs, history, files, needs, categories, suppliers] = await Promise.all([
    variantSuppliers(ctx.db, id), prices ? priceHistory(ctx, id) : Promise.resolve([]), listFiles(ctx, "variant", id),
    openNeeds(ctx.db, id, { showSupplier: can(ctx.actor, "order.view") }), manage ? listLookup(ctx.db, "categories", { includeInactive: true }) : Promise.resolve([]),
    prices ? supplierOptions(ctx.db) : Promise.resolve([]),
  ]);
  const last = lastPurchase(history);
  return (
    <>
      <PageHeader title={v.label} subtitle={`${v.categoryName} · ${v.packText}`} back={{ href: "/katalog", label: "Katalog" }} />
      {firstParam(sp.yeni) && <div className="mb-4"><Notice tone="green">Ürün kataloğa eklendi.</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Ürün" className="lg:col-span-2">
          <dl className="grid gap-x-6 sm:grid-cols-2">
            <Info label="Ürün adı">{v.productName}</Info>
            <Info label="Marka">{v.brand}</Info>
            <Info label="Tip / model / seri">{v.model}</Info>
            <Info label="Ölçü / özellik">{v.attributes}</Info>
            <Info label="Kod / barkod">{v.code}</Info>
            <Info label="Sipariş birimi ve paket">{v.packText}</Info>
            <Info label="Varsayılan KDV">{formatPct(v.defaultVatRate)}</Info>
            <Info label="Teslimat kontrolü">{[v.trackExpiry && "SKT takibi", v.minShelfLifeDays != null && `en az ${v.minShelfLifeDays} gün raf ömrü`, v.trackLot && "lot takibi"].filter(Boolean).join(", ") || "Ek takip yok"}</Info>
            <Info label="Tercih edilen tedarikçiler">{prefs.map((p) => `${p.preference}. ${p.supplierName}${p.supplierCode ? ` (${p.supplierCode})` : ""}`).join(", ")}</Info>
            <Info label="Durum">{v.active ? "Aktif" : "Pasif"}</Info>
          </dl>
        </Card>
        <Card title="Görsel">
          <Files entity="variant" entityId={v.id} files={files} canUpload={manage} label="Ürün görseli ekle" />
        </Card>
      </div>
      {(needs.requests.length > 0 || needs.orders.length > 0) && (
        <div className="mt-4">
          <Notice tone="amber" title="Açık talep / beklenen sipariş">
            {needs.requests.map((r) => <div key={r.id}>Talep {r.requestNo}: {formatQty(r.qty)} {r.unitLabel} – {r.progressLabel}</div>)}
            {needs.orders.map((o) => <div key={o.orderId}>Sipariş {o.orderNo}{o.supplierName ? ` (${o.supplierName})` : ""}: {formatQty(o.pendingQty)} {o.unitLabel} bekleniyor</div>)}
          </Notice>
        </div>
      )}
      {prices && (
        <Card title="Son satın alma ve fiyat karşılaştırması" className="mt-4">
          {last ? (
            <p className="mb-3 text-[15px]">
              Son satın alma: <b>{formatPrice(last.perOrderUnitExcl, last.currency)}</b> / {v.orderUnit} (KDV hariç, iskonto düşülmüş) · {formatDate(last.date)} · {last.supplierName} ({SOURCE[last.source]})
              {v.orderUnit !== v.baseUnit && <> · {formatPrice(last.perBaseUnitExcl, last.currency)} / {v.baseUnit}</>}
            </p>
          ) : <p className="mb-3 text-muted">Henüz satın alma yok.</p>}
          <DataTable
            rows={history}
            rowKey={(h) => `${h.source}-${h.refId}-${h.date}-${h.unitPrice}`}
            empty="Fiyat kaydı yok."
            columns={[
              { label: "Kaynak", cell: (h) => <>{SOURCE[h.source]}{h.ref ? ` ${h.ref}` : ""}{h.validUntil ? <div className="text-sm text-muted">geçerli {formatDate(h.validUntil)}</div> : null}</> },
              { label: "Tarih", cell: (h) => formatDate(h.date) },
              { label: "Tedarikçi", cell: (h) => h.supplierName },
              { label: `${v.orderUnit} – KDV hariç`, align: "right", cell: (h) => formatPrice(h.perOrderUnitExcl, h.currency) },
              { label: `${v.orderUnit} – KDV dahil`, align: "right", cell: (h) => formatPrice(h.perOrderUnitIncl, h.currency) },
              { label: `${v.baseUnit} – KDV hariç`, align: "right", cell: (h) => formatPrice(h.perBaseUnitExcl, h.currency) },
              { label: "Liste / iskonto / KDV", cell: (h) => `${formatPrice(h.unitPrice, h.currency)} · ${formatPct(h.discountPct)} · ${formatPct(h.vatRate)}` },
            ]}
          />
          <p className="mt-2 text-sm text-muted">Fiyatlar aynı temelde (iskonto düşülmüş; KDV hariç/dahil ayrı) gösterilir. Farklı para birimleri karşılaştırılmaz. Sistem tedarikçiyi otomatik seçmez.</p>
          {can(ctx.actor, "quote.manage") && (
            <div className="mt-3">
              <ActionPanel title="+ Teklif gir" tone="secondary" endpoint="/api/teklifler" extra={{ variantId: v.id }}
                fields={[
                  { name: "supplierId", label: "Tedarikçi", type: "select", required: true, options: suppliers },
                  { name: "unitPrice", label: `Birim fiyat (${v.orderUnit} başına)`, type: "decimal", required: true },
                  { name: "priceIncludesVat", label: "Girilen fiyat KDV dahil", type: "checkbox" },
                  { name: "vatRate", label: "KDV %", type: "decimal", initial: decimalInput(v.defaultVatRate), required: true },
                  { name: "discountPct", label: "İskonto %", type: "decimal" },
                  { name: "currency", label: "Para birimi", type: "select", options: CURRENCIES.items.map((c) => ({ value: c.value, label: c.label })), initial: "TRY" },
                  { name: "quotedOn", label: "Teklif tarihi", type: "date", initial: ctx.today },
                  { name: "validUntil", label: "Geçerlilik", type: "date" },
                  { name: "minQty", label: "En az sipariş miktarı", type: "decimal" },
                  { name: "note", label: "Not", type: "text" },
                ]} />
            </div>
          )}
        </Card>
      )}
      {manage && (
        <Card title="Düzenle" className="mt-4">
          <VariantForm mode="edit" variantId={v.id} version={v.version} categories={categories.map((c) => ({ value: c.id, label: c.name }))} suppliers={suppliers}
            initial={{
              productName: v.productName, categoryId: v.categoryId, brand: v.brand ?? "", model: v.model ?? "", attributes: v.attributes ?? "", code: v.code ?? "",
              orderUnit: v.orderUnit, baseUnit: v.baseUnit, packSize: decimalInput(v.packSize), defaultVatRate: decimalInput(v.defaultVatRate), trackExpiry: v.trackExpiry,
              trackLot: v.trackLot, minShelfLifeDays: v.minShelfLifeDays?.toString() ?? "", active: v.active, suppliers: prefs.map((p) => p.supplierId),
            }} />
        </Card>
      )}
    </>
  );
}
