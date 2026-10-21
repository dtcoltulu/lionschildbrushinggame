import Link from "next/link";
import { ActionPanel } from "@/components/ActionPanel";
import { OrderTable } from "@/components/lists";
import { FilterBar, PageHeader, Tabs } from "@/components/ui";
import { dateParam, firstParam, pageCtx, type SearchParams } from "@/server/page";
import { can } from "@/server/permissions";
import { listOrders, type OrderFilters } from "@/server/services/orders";
import { supplierOptions } from "@/server/services/suppliers";

export const dynamic = "force-dynamic";

const VIEWS: { key: NonNullable<OrderFilters["view"]> | "acik"; label: string }[] = [
  { key: "acik", label: "Açık" },
  { key: "taslak", label: "Verilecek (taslak)" },
  { key: "bekleyen", label: "Teslimat bekleyen" },
  { key: "geciken", label: "Geciken" },
  { key: "kontrol", label: "Kontrol sürüyor" },
  { key: "sorunlu", label: "Sorunlu" },
  { key: "kapali", label: "Kapanan / iptal" },
  { key: "tumu", label: "Tümü" },
];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx("order.view");
  const sp = await searchParams;
  const view = VIEWS.find((v) => v.key === firstParam(sp.gorunum))?.key ?? "acik";
  const q = firstParam(sp.q) ?? "";
  const from = dateParam(sp.from);
  const to = dateParam(sp.to);
  const supplierId = firstParam(sp.tedarikci) ?? null;
  const all = await listOrders(ctx, { view: view === "acik" ? "tumu" : view, q, from, to, supplierId });
  const rows = view === "acik" ? all.filter((o) => o.status === "taslak" || o.status === "verildi") : all;
  const suppliers = await supplierOptions(ctx.db);
  return (
    <>
      <PageHeader
        title="Siparişler"
        actions={
          <>
            {can(ctx.actor, "order.manage") && <Link className="btn btn-primary" href="/siparisler/planla">Talepleri siparişe dönüştür</Link>}
            <a className="btn btn-secondary" href={`/api/disa-aktar/siparis-kalemleri?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`}>CSV</a>
          </>
        }
      />
      <Tabs current={view} items={VIEWS.map((v) => ({ key: v.key, label: v.label, href: `/siparisler?${new URLSearchParams({ gorunum: v.key, ...(q ? { q } : {}) })}` }))} />
      <FilterBar action="/siparisler" from={from} to={to} q={q} hidden={{ gorunum: view }}>
        <label className="block text-sm font-semibold">
          Tedarikçi
          <select className="field mt-1" name="tedarikci" defaultValue={supplierId ?? ""}>
            <option value="">Tümü</option>
            {suppliers.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </FilterBar>
      <OrderTable rows={rows} />
      {can(ctx.actor, "order.manage") && (
        <div className="mt-4">
          <ActionPanel title="Talepsiz boş sipariş taslağı aç" tone="secondary" endpoint="/api/siparisler" redirectTo="/siparisler/{id}"
            fields={[{ name: "supplierId", label: "Tedarikçi", type: "select", required: true, options: suppliers }]} />
        </div>
      )}
    </>
  );
}
