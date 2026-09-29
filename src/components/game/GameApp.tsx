"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createAnalytics, detectDeviceClass, type Analytics } from "@/analytics/client";
import type { CampaignConfig } from "@/config/campaigns";
import { installAudioUnlock, sfx, unlockAudio } from "@/game/audio";
import { Landing } from "./Landing";
import { PlayScreen } from "./PlayScreen";
import { RewardScreen } from "./RewardScreen";
import { TutorialScreen } from "./TutorialScreen";

type Screen = "landing" | "tutorial" | "playing" | "reward";

interface Props {
  campaigns: CampaignConfig[];
  defaultCampaignId: string;
}

interface PlayInfo {
  playId: string;
  playIndex: number;
}

export function GameApp({ campaigns, defaultCampaignId }: Props) {
  const fallback = campaigns.find((c) => c.campaignId === defaultCampaignId) ?? campaigns[0]!;
  // Kampanya: sunucuda varsayılan, tarayıcıda isteğe bağlı ?k=... (sayfa statik kalsın diye istemcide okunur)
  const requested = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("k") ?? "",
    () => "",
  );
  const campaign = campaigns.find((c) => c.campaignId === requested) ?? fallback;
  const [screen, setScreen] = useState<Screen>("landing");
  const [playKey, setPlayKey] = useState(0);
  const analytics = useRef<Analytics | null>(null);
  const play = useRef<PlayInfo | null>(null);
  const finished = useRef(false);

  // Telefonda ses: her dokunuşta ses bağlamı (askıdaysa) yeniden açılır
  useEffect(() => installAudioUnlock(), []);

  // Analytics başlatma + landing_view
  useEffect(() => {
    // URL'den doğrudan okunur (hidratasyon sırasındaki geçici değere güvenilmez): landing_view tek kez, doğru kampanyayla.
    const k = new URLSearchParams(window.location.search).get("k");
    const chosen = campaigns.find((c) => c.campaignId === k) ?? fallback;
    const a = createAnalytics(chosen.campaignId, {
      storage: window.localStorage,
      fetch: (url, init) => fetch(url, init),
      now: () => Date.now(),
      deviceClass: detectDeviceClass(),
    });
    analytics.current = a;
    a.track("landing_view");
    return () => {
      a.dispose();
      analytics.current = null;
    };
    // yalnızca ilk yüklemede
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPlaying = useCallback(() => {
    const a = analytics.current;
    finished.current = false;
    if (a) {
      const p = a.beginPlay();
      play.current = { playId: p.playId, playIndex: p.playIndex };
      // İlk oyun → game_started, sonraki her oyun → replay_started (yeni oyuncu sayılmaz)
      a.track(p.isReplay ? "replay_started" : "game_started", { playId: p.playId, playIndex: p.playIndex });
    } else {
      play.current = null;
    }
    setPlayKey((k) => k + 1);
    setScreen("playing");
  }, []);

  const onStart = useCallback(() => {
    unlockAudio();
    sfx.tap();
    const a = analytics.current;
    if (a && a.playsStarted() === 0) {
      a.track("tutorial_started");
      setScreen("tutorial");
    } else {
      startPlaying();
    }
  }, [startPlaying]);

  const onTutorialDone = useCallback(() => {
    analytics.current?.track("tutorial_completed");
    startPlaying();
  }, [startPlaying]);

  const onTutorialSkip = useCallback(() => {
    analytics.current?.track("tutorial_skipped");
    startPlaying();
  }, [startPlaying]);

  const onPhaseComplete = useCallback((i: number, durationMs: number) => {
    const p = play.current;
    analytics.current?.track("phase_completed", {
      playId: p?.playId,
      playIndex: p?.playIndex,
      phase: i + 1,
      durationMs,
    });
  }, []);

  const onComplete = useCallback((totalMs: number) => {
    if (finished.current) return;
    finished.current = true;
    const p = play.current;
    const a = analytics.current;
    a?.track("game_completed", { playId: p?.playId, playIndex: p?.playIndex, durationMs: totalMs });
    a?.track("reward_screen_viewed", { playId: p?.playId, playIndex: p?.playIndex });
    setScreen("reward");
  }, []);

  switch (screen) {
    case "landing":
      return <Landing campaign={campaign} onStart={onStart} />;
    case "tutorial":
      return <TutorialScreen onDone={onTutorialDone} onSkip={onTutorialSkip} />;
    case "playing":
      return <PlayScreen key={playKey} onPhaseComplete={onPhaseComplete} onComplete={onComplete} />;
    case "reward":
      return (
        <RewardScreen
          campaign={campaign}
          onReplay={() => {
            unlockAudio();
            sfx.tap();
            startPlaying();
          }}
        />
      );
  }
}
