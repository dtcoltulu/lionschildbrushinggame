import { GameApp } from "@/components/game/GameApp";
import { CAMPAIGNS, getDefaultCampaignId } from "@/config/campaigns";

export default function OyunPage() {
  return <GameApp campaigns={[...CAMPAIGNS]} defaultCampaignId={getDefaultCampaignId()} />;
}
