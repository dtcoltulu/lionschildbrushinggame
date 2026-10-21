import { notFound } from "next/navigation";
import { Notice, PageHeader } from "@/components/ui";
import { isUuid } from "@/lib/validate";
import { firstParam, pageCtx, type SearchParams } from "@/server/page";
import { listLookup } from "@/server/services/lookups";
import { getRequest } from "@/server/services/requests";
import { supplierOptions } from "@/server/services/suppliers";
import { EMPTY_VARIANT } from "@/lib/variant-form";
import { VariantForm } from "../VariantForm";

export const dynamic = "force-dynamic";

export default async function NewVariantPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx("catalog.manage");
  const sp = await searchParams;
  const talep = firstParam(sp.talep);
  const req = talep && isUuid(talep) ? await getRequest(ctx, talep).catch(() => null) : null;
  if (talep && (!req || req.variantId)) notFound();
  const [categories, suppliers] = await Promise.all([listLookup(ctx.db, "categories"), supplierOptions(ctx.db)]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={req ? "Talepten yeni ürün aç" : "Kataloğa ürün ekle"} back={req ? { href: `/talepler/${req.id}`, label: `Talep ${req.requestNo}` } : { href: "/katalog", label: "Katalog" }} />
      {req && <div className="mb-4"><Notice tone="blue" title={`Talepteki tanım: “${req.tempProductText}”`}>Ürünü açtığınızda talep bu ürüne bağlanır.</Notice></div>}
      <VariantForm mode={req ? "match" : "create"} initial={{ ...EMPTY_VARIANT, productName: req?.tempProductText ?? "" }}
        categories={categories.map((c) => ({ value: c.id, label: c.name }))} suppliers={suppliers}
        match={req ? { requestId: req.id, version: req.version, unitLabel: req.unitLabel } : undefined} />
    </div>
  );
}
