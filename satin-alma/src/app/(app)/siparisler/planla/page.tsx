import Link from "next/link";
import { RequestList } from "@/components/lists";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { pageCtx } from "@/server/page";
import { getVariant, priceHistory, variantSuppliers } from "@/server/services/catalog";
import { planningQueue, unallocatedBase } from "@/server/services/requests";
import { supplierOptions } from "@/server/services/suppliers";
import { PlanGroup } from "./PlanGroup";

export const dynamic = "force-dynamic";

/** Siparişe eklenmeyi bekleyen talepler ürün bazında gruplanır; yönetim tedarikçi ve fiyatı seçip taslağa ekler. */
export default async function PlanPage() {
  const ctx = await pageCtx("order.manage");
  const queue = await planningQueue(ctx);
  const temp = queue.filter((r) => !r.variantId);
  const byVariant = new Map<string, typeof queue>();
  for (const r of queue.filter((x) => x.variantId)) byVariant.set(r.variantId!, [...(byVariant.get(r.variantId!) ?? []), r]);
  const suppliers = await supplierOptions(ctx.db);
  const groups = await Promise.all(
    [...byVariant.entries()].map(async ([variantId, reqs]) => {
      const [v, prefs, prices] = await Promise.all([getVariant(ctx.db, variantId), variantSuppliers(ctx.db, variantId), priceHistory(ctx, variantId)]);
      return { v: v!, prefs, prices, reqs };
    }),
  );
  return (
    <>
      <PageHeader title="Sipariş planla" subtitle="Bekleyen talepleri birleştirip tedarikçinin sipariş taslağına ekleyin. Tedarikçiyi ve fiyatı siz seçersiniz."
        back={{ href: "/siparisler", label: "Siparişler" }} actions={<Link className="btn btn-secondary" href="/siparisler?gorunum=taslak">Taslak siparişler</Link>} />
      <div className="mb-4"><Notice tone="blue">Aynı tedarikçinin açık taslağı varsa kalem ona eklenir; yoksa yeni taslak açılır. Sipariş, taslakta “Sipariş verildi” işaretlenene kadar tedarikçiye gitmiş sayılmaz.</Notice></div>
      {temp.length > 0 && (
        <Card title={`Katalog eşleştirmesi bekleyen talepler (${temp.length})`} className="mb-4">
          <p className="mb-2 text-sm text-muted">Bu talepler katalogda olmayan ürünler içindir. Talebi açıp mevcut bir ürünle eşleştirin ya da yeni ürün olarak açın.</p>
          <RequestList rows={temp} />
        </Card>
      )}
      {groups.length ? (
        <div className="space-y-4">
          {groups.map(({ v, prefs, prices, reqs }) => (
            <PlanGroup key={v.id} variantId={v.id} label={v.label} packText={v.packText} orderUnit={v.orderUnit} baseUnit={v.baseUnit} packSize={v.packSize}
              defaultVatRate={v.defaultVatRate} suppliers={suppliers} preferred={prefs.map((p) => p.supplierId)}
              prices={prices.map((x) => ({ source: x.source, date: x.date, supplierId: x.supplierId, supplierName: x.supplierName, currency: x.currency, perOrderUnitExcl: x.perOrderUnitExcl, perBaseUnitExcl: x.perBaseUnitExcl, perOrderUnitIncl: x.perOrderUnitIncl, unitPrice: x.unitPrice }))}
              requests={reqs.map((r) => ({ id: r.id, requestNo: r.requestNo, requesterName: r.requesterName, qty: r.qty, unitLabel: r.unitLabel, urgency: r.urgency, neededBy: r.neededBy, freeBase: unallocatedBase(r), status: r.status }))} />
          ))}
        </div>
      ) : (
        <EmptyState>Siparişe eklenmeyi bekleyen talep yok.</EmptyState>
      )}
    </>
  );
}
