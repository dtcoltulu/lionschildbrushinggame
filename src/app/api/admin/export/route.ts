import { NextResponse } from "next/server";
import { resolveCampaign } from "@/config/campaigns";
import { isAdmin } from "@/lib/admin-guard";
import { eventsCsv, reportCsv } from "@/lib/csv";
import { getStore } from "@/lib/get-store";
import { computeKpis } from "@/lib/kpi";
import { filterByRange, parseRange } from "@/lib/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = getStore();
  if (!store) return NextResponse.json({ error: "store_unavailable" }, { status: 503 });

  const url = new URL(request.url);
  const campaign = resolveCampaign(url.searchParams.get("k"));
  const type = url.searchParams.get("type") === "events" ? "events" : "report";
  // İsteğe bağlı tarih aralığı (kampanya saat diliminde yerel gün, uçlar dahil): yalnızca dışa aktarılan satırları sınırlar.
  const range = parseRange(url.searchParams.get("from"), url.searchParams.get("to"));

  const data = await store.loadCampaign(campaign.campaignId);
  const view = filterByRange(data, range, campaign.timezone);
  const body =
    type === "events"
      ? eventsCsv(view.events)
      : reportCsv(campaign, computeKpis(view.events, view.sessions, campaign.timezone), new Date(), range);

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${campaign.campaignId}-${type}-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
