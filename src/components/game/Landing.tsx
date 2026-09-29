"use client";
import Link from "next/link";
import type { CampaignConfig } from "@/config/campaigns";
import { tr } from "@/content/tr";
import { EventBadge } from "@/components/brand/EventBadge";
import { Mascot } from "./Mascot";
import { SoundToggle } from "./SoundToggle";

export function Landing({ campaign, onStart }: { campaign: CampaignConfig; onStart: () => void }) {
  return (
    <main className="screen flex flex-col items-center bg-gradient-to-b from-cream to-purple-soft px-5 pb-5 pt-4 text-center">
      <header className="flex w-full max-w-md items-center justify-between">
        <EventBadge campaign={campaign} />
        <SoundToggle className="shadow-md ring-1 ring-black/10" />
      </header>

      <section className="flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 py-4">
        <Mascot size={170} />
        <h1 className="text-4xl font-black leading-tight text-purple">{tr.landing.title}</h1>
        <p className="text-2xl font-extrabold">{tr.landing.ready}</p>
        <p className="text-xl font-semibold text-ink/80">{tr.landing.lead}</p>
        <button type="button" onClick={onStart} className="btn-big btn-gold mt-2 w-full max-w-xs text-3xl" data-testid="start">
          {tr.landing.start}
        </button>
        <p className="text-sm font-semibold text-ink/60">{tr.landing.noData}</p>
        <p className="text-sm font-semibold text-ink/60" data-testid="sound-hint">
          <span aria-hidden="true">🔔 </span>
          {tr.landing.soundHint}
        </p>
      </section>

      <footer className="flex max-w-md flex-col items-center gap-1 text-xs text-ink/70">
        <p>{tr.landing.disclaimer}</p>
        <p>
          {campaign.eventName} · {campaign.eventDateLabel} ·{" "}
          <Link href="/gizlilik" className="inline-flex min-h-[44px] items-center font-bold underline">
            {tr.landing.privacy}
          </Link>
        </p>
      </footer>
    </main>
  );
}
