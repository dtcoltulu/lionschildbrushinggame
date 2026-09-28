import type { CampaignConfig } from "@/config/campaigns";
import { LionsLogo } from "./LionsLogo";

/** Küçük, profesyonel marka satırı: oyunu boğmaz. */
export function EventBadge({ campaign, tone = "dark" }: { campaign: CampaignConfig; tone?: "dark" | "light" }) {
  return (
    <div className={`flex items-center gap-3 ${tone === "light" ? "text-white" : "text-ink"}`}>
      <LionsLogo src={campaign.logoPath} size={44} />
      <div className="text-left leading-tight">
        <div className="text-sm font-extrabold">{campaign.organization}</div>
        <div className="text-xs opacity-80">{campaign.committee}</div>
      </div>
    </div>
  );
}
