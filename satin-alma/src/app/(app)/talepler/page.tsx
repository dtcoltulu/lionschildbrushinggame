import Link from "next/link";
import { RequestList } from "@/components/lists";
import { FilterBar, PageHeader, Tabs } from "@/components/ui";
import type { RequestProgress } from "@/lib/labels";
import { dateParam, firstParam, pageCtx, type SearchParams } from "@/server/page";
import { can } from "@/server/permissions";
import { listRequests } from "@/server/services/requests";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "acik", label: "Açık" },
  { key: "degerlendirme", label: "Değerlendirme bekleyen" },
  { key: "eslestirme", label: "Katalog dışı" },
  { key: "kapali", label: "Kapanan" },
  { key: "tumu", label: "Tümü" },
] as const;

export default async function RequestsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx("request.create");
  const sp = await searchParams;
  const view = (VIEWS.find((v) => v.key === firstParam(sp.gorunum))?.key ?? "acik") as (typeof VIEWS)[number]["key"];
  const q = firstParam(sp.q) ?? "";
  const from = dateParam(sp.from);
  const to = dateParam(sp.to);
  const all = can(ctx.actor, "request.viewAll");
  const isProgress = view === "degerlendirme" || view === "eslestirme";
  const rows = await listRequests(ctx, { view: isProgress ? "tumu" : view, progress: isProgress ? (view as RequestProgress) : undefined, q, from, to });
  const href = (k: string) => `/talepler?${new URLSearchParams({ gorunum: k, ...(q ? { q } : {}) })}`;
  return (
    <>
      <PageHeader
        title={all ? "Talepler" : "Taleplerim"}
        subtitle={all ? "Klinikteki bütün malzeme talepleri" : "Yalnızca sizin açtığınız talepler görünür"}
        actions={
          <>
            <Link href="/talepler/yeni" className="btn btn-primary">+ Talep</Link>
            {can(ctx.actor, "export.operations") && <a className="btn btn-secondary" href={`/api/disa-aktar/talepler?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`}>CSV</a>}
          </>
        }
      />
      <Tabs current={view} items={VIEWS.filter((v) => all || v.key !== "eslestirme").map((v) => ({ key: v.key, label: v.label, href: href(v.key) }))} />
      <FilterBar action="/talepler" from={from} to={to} q={q} hidden={{ gorunum: view }} />
      <RequestList rows={rows} showRequester={all} />
    </>
  );
}
