import { NextResponse } from "next/server";
import { resolveCampaign } from "@/config/campaigns";
import { isAdmin } from "@/lib/admin-guard";
import { eventsCsv, reportCsv } from "@/lib/csv";
import { getStore } from "@/lib/get-store";
import { computeKpis } from "@/lib/kpi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = getStore();
  if (!store) return NextResponse.json({ error: "store_unavailable" }, { status: 503 });

  const url = new URL(request.url);
  const campaign = resolveCampaign(url.searchParams.get("k"));
  const type = url.searchParams.get("type") === "events" ? "events" : "report";

  const data = await store.loadCampaign(campaign.campaignId);
  const body =
    type === "events"
      ? eventsCsv(data.events)
      : reportCsv(campaign, computeKpis(data.events, data.sessions, campaign.timezone), new Date());

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${campaign.campaignId}-${type}-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
