import type { CampaignConfig } from "@/config/campaigns";
import { LionsLogo } from "./LionsLogo";

/** Küçük, profesyonel marka satırı: oyunu boğmaz. */
export function EventBadge({ campaign, tone = "dark" }: { campaign: CampaignConfig; tone?: "dark" | "light" }) {
  return (
    <div className={`flex items-center gap-3 ${tone === "light" ? "text-white" : "text-ink"}`}>
      {/* Beyaz yuvarlak zemin: logo koyu (mor) yüzeylerde de net okunur */}
      <span className="inline-flex shrink-0 items-center justify-center rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-black/10">
        <LionsLogo src={campaign.logoPath} size={40} />
      </span>
      <div className="text-left leading-tight">
        <div className="text-sm font-extrabold">{campaign.organization}</div>
        <div className="text-xs opacity-80">{campaign.committee}</div>
      </div>
    </div>
  );
}
