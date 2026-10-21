import Link from "next/link";
import { Badge, DataTable, PageHeader } from "@/components/ui";
import { formatPct } from "@/lib/decimal";
import { firstParam, pageCtx, type SearchParams } from "@/server/page";
import { can } from "@/server/permissions";
import { searchVariants } from "@/server/services/catalog";
import { listLookup } from "@/server/services/lookups";

export const dynamic = "force-dynamic";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx("catalog.view");
  const sp = await searchParams;
  const q = firstParam(sp.q) ?? "";
  const categoryId = firstParam(sp.kategori) ?? null;
  const manage = can(ctx.actor, "catalog.manage");
  const inactive = manage && firstParam(sp.pasif) === "1";
  const [rows, categories] = await Promise.all([searchVariants(ctx.db, q, { limit: 500, includeInactive: inactive, categoryId }), listLookup(ctx.db, "categories")]);
  return (
    <>
      <PageHeader title="Ürün kataloğu" subtitle="Farklı marka, ölçü, tip veya paket içeriği ayrı varyanttır."
        actions={manage ? <Link className="btn btn-primary" href="/katalog/yeni">+ Ürün ekle</Link> : undefined} />
      <form className="card mb-4 grid gap-3 p-3 sm:grid-cols-[2fr_1fr_auto_auto] sm:items-end" method="get">
        <label className="block text-sm font-semibold">Ara<input className="field mt-1" type="search" name="q" defaultValue={q} placeholder="Ad, marka, ölçü, kod…" /></label>
        <label className="block text-sm font-semibold">Kategori
          <select className="field mt-1" name="kategori" defaultValue={categoryId ?? ""}>
            <option value="">Tümü</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {manage && <label className="flex min-h-12 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="pasif" value="1" defaultChecked={inactive} className="h-5 w-5" /> Pasifler de</label>}
        <button className="btn btn-secondary" type="submit">Ara</button>
      </form>
      <DataTable
        rows={rows}
        rowKey={(v) => v.id}
        empty={q ? "Eşleşen ürün yok. Katalogda yoksa talep formundan “Ürün katalogda yok” ile talep açılabilir." : "Katalog boş."}
        columns={[
          { label: "Ürün", cell: (v) => <><Link className="font-semibold text-brand hover:underline" href={`/katalog/${v.id}`}>{v.label}</Link>{!v.active && <> <Badge tone="gray">Pasif</Badge></>}</> },
          { label: "Kategori", cell: (v) => v.categoryName },
          { label: "Paket", cell: (v) => v.packText },
          { label: "Kod", cell: (v) => v.code ?? "—" },
          { label: "Takip", cell: (v) => [v.trackExpiry && `SKT${v.minShelfLifeDays != null ? ` (≥${v.minShelfLifeDays} gün)` : ""}`, v.trackLot && "Lot"].filter(Boolean).join(", ") || "—" },
          { label: "KDV", cell: (v) => formatPct(v.defaultVatRate) },
        ]}
      />
    </>
  );
}
