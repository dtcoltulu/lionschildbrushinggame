"use client";
import { useEffect, useState } from "react";
import type { CampaignConfig } from "@/config/campaigns";
import { tr } from "@/content/tr";
import { EventBadge } from "@/components/brand/EventBadge";
import { formatStamp } from "@/lib/stamp";
import { Mascot } from "./Mascot";

/**
 * Tarih-saat şeridi: eski bir ekran görüntüsüyle ödül alınmasını zorlaştırır.
 * Saniye AKMAZ: eskiden saniye sayacı vardı, çocuklar "oyun hâlâ süre tutuyor" sandı. Şimdi şerit bir "bilet damgası"
 * gibi durur; görevli yine de canlı ekranı ayırt eder (parıltı ve yıldızlar hareket eder, tarih/saat bugüne uyar).
 */
function StampStrip({ timeZone }: { timeZone: string }) {
  const [stamp, setStamp] = useState<string>("");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const now = new Date();
      setStamp(formatStamp(now, timeZone));
      // Bir sonraki dakika başında yeniden çalış: yazı dakika değişince tam zamanında güncellenir, arada hiç oynamaz.
      timer = setTimeout(tick, 60_000 - (now.getTime() % 60_000) + 50);
    };
    // Telefon kilidinden / başka uygulamadan dönünce bekleme, hemen güncelle.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      tick();
    };
    tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [timeZone]);
  return (
    <div
      aria-hidden="true"
      className="anim-shine mx-auto mt-2 flex w-full max-w-xs items-center justify-center gap-2 rounded-full bg-gradient-to-r from-gold via-white to-gold px-4 py-1 text-lg font-extrabold tabular-nums text-ink"
    >
      <span className="anim-twinkle">⭐</span>
      {stamp || "\u00a0"}
      <span className="anim-twinkle" style={{ animationDelay: "0.8s" }}>
        ⭐
      </span>
    </div>
  );
}

export function RewardScreen({ campaign, onReplay }: { campaign: CampaignConfig; onReplay: () => void }) {
  return (
    <main className="screen flex flex-col items-center bg-gradient-to-b from-purple to-ink px-5 pb-6 pt-4 text-center text-white" data-testid="reward-screen">
      <div className="w-full max-w-md">
        <div className="flex justify-start">
          <EventBadge campaign={campaign} tone="light" />
        </div>
      </div>

      <section className="anim-pop mt-2 flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3" aria-labelledby="reward-title">
        <div role="img" aria-label={tr.reward.trophyLabel} className="text-8xl leading-none drop-shadow-lg">
          🏆
        </div>
        <h1 id="reward-title" className="text-4xl font-black leading-tight">
          {tr.reward.title}
          <span className="block text-gold">{tr.reward.subtitle}</span>
        </h1>
        <StampStrip timeZone={campaign.timezone} />

        <div className="mt-2 w-full rounded-3xl bg-white p-4 text-ink shadow-xl">
          <p className="text-xl font-extrabold">{tr.reward.showStaff}</p>
          <p className="mt-1 text-2xl font-black text-mint-deep">{campaign.rewardLine}</p>
        </div>

        <p className="mt-1 text-lg font-semibold">{tr.reward.learned}</p>
        <ul className="grid w-full gap-2">
          {tr.reward.tips.map((t) => (
            <li key={t.text} className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 text-left text-lg font-bold ring-1 ring-white/25">
              <span className="text-3xl" aria-hidden="true">
                {t.icon}
              </span>
              {t.text}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-5 flex flex-col items-center gap-3">
        <Mascot size={70} cheer />
        <button type="button" onClick={onReplay} className="btn-big btn-ghost" data-testid="replay">
          {tr.reward.replay}
        </button>
        <p className="max-w-xs text-xs opacity-75">{tr.landing.disclaimer}</p>
      </div>
    </main>
  );
}
