import { IssueList } from "@/components/lists";
import { DownloadLink, PageHeader, Tabs } from "@/components/ui";
import { ISSUE_TYPES } from "@/lib/labels";
import { firstParam, pageCtx, type SearchParams } from "@/server/page";
import { can } from "@/server/permissions";
import { listIssues } from "@/server/services/issues";

export const dynamic = "force-dynamic";

export default async function IssuesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx(["order.view", "issue.report"]);
  const sp = await searchParams;
  const status = (["acik", "cozuldu", "tumu"] as const).find((s) => s === firstParam(sp.durum)) ?? "acik";
  const type = ISSUE_TYPES.values.find((t) => t === firstParam(sp.tur)) ?? null;
  const rows = await listIssues(ctx, { status, type });
  const href = (s: string, t?: string | null) => `/sorunlar?${new URLSearchParams({ durum: s, ...(t ? { tur: t } : {}) })}`;
  return (
    <>
      <PageHeader title="Teslimat sorunları" subtitle="Eksik, yanlış, farklı marka, hasarlı, tarihi uygun olmayan ve sipariş dışı ürünler"
        actions={can(ctx.actor, "export.operations") ? <DownloadLink href="/api/disa-aktar/sorunlar" className="btn btn-secondary">CSV</DownloadLink> : undefined} />
      <Tabs current={status} items={[{ key: "acik", label: "Açık" }, { key: "cozuldu", label: "Çözülen" }, { key: "tumu", label: "Tümü" }].map((t) => ({ ...t, href: href(t.key, type) }))} />
      <Tabs current={type ?? "hepsi"} items={[{ key: "hepsi", label: "Bütün türler", href: href(status) }, ...ISSUE_TYPES.items.map((t) => ({ key: t.value, label: t.label, href: href(status, t.value) }))]} />
      <IssueList rows={rows} />
    </>
  );
}
