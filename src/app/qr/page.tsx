import Link from "next/link";
import { QrTool } from "@/components/admin/QrTool";
import { CAMPAIGNS, resolveCampaign, getDefaultCampaignId } from "@/config/campaigns";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "QR Kod | Diş Kahramanı" };

export default async function QrPage() {
  await requireAdmin("/qr");
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const campaign = resolveCampaign();
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-3xl font-black text-purple">QR Kod Oluştur</h1>
        <Link href="/admin" className="inline-flex min-h-[44px] items-center font-bold underline">← Panel</Link>
      </div>
      <QrTool
        defaultUrl={`${site}/oyun`}
        logoPath={campaign.logoPath}
        campaigns={CAMPAIGNS.map((c) => ({ id: c.campaignId, label: `${c.eventName} (${c.eventDateLabel})` }))}
        defaultCampaignId={getDefaultCampaignId()}
      />
    </main>
  );
}
