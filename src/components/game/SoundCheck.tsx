"use client";
import { useEffect, useState } from "react";
import { audioState, getSpeechInfo, installAudioUnlock, isMuted, setMuted, sfx, unlockAudio } from "@/game/audio";

const STATE_TEXT: Record<string, string> = {
  none: "Henüz açılmadı: aşağıdaki düğmeye dokun",
  running: "Açık ✅",
  suspended: "Askıda ⚠️ (düğmeye tekrar dokun)",
  interrupted: "Kesildi ⚠️ (düğmeye tekrar dokun)",
  closed: "Kapandı ❌ (sayfayı yenile)",
};

/** Etkinlik günü herkesin telefonunda sesi hızlıca denemesi için basit bir sayfa. */
export function SoundCheck() {
  const [state, setState] = useState("none");
  const [speech, setSpeech] = useState({ supported: false, localTurkish: false, voiceCount: 0 });
  const [muted, setMutedState] = useState(false);
  const [tested, setTested] = useState(false);

  useEffect(() => {
    const off = installAudioUnlock();
    const refresh = () => {
      setState(audioState());
      setSpeech(getSpeechInfo());
      setMutedState(isMuted());
    };
    refresh();
    const id = setInterval(refresh, 500);
    return () => {
      off();
      clearInterval(id);
    };
  }, []);

  const play = (fn: () => void) => () => {
    unlockAudio();
    setTested(true);
    fn();
  };

  const btn = "btn-big btn-gold w-full text-xl";
  return (
    <main className="screen mx-auto flex max-w-md flex-col gap-4 px-5 py-6">
      <h1 className="text-3xl font-black text-purple">Ses testi</h1>
      <p className="text-lg">Telefonunda sesin çalıştığını kontrol et. Sesi duymazsan aşağıdaki ipuçlarına bak.</p>

      <dl className="grid gap-2 rounded-2xl bg-white p-4 text-base shadow ring-1 ring-purple/10" data-testid="sound-status">
        <div>
          <dt className="font-bold">Ses durumu</dt>
          <dd data-testid="state">{STATE_TEXT[state] ?? state}</dd>
        </div>
        <div>
          <dt className="font-bold">Oyun sesi</dt>
          <dd>{muted ? "Kapalı 🔇" : "Açık 🔊"}</dd>
        </div>
        <div>
          <dt className="font-bold">Türkçe konuşma</dt>
          <dd data-testid="speech">
            {!speech.supported
              ? "Bu tarayıcıda yok (yalnızca ses efektleri çalar)"
              : speech.localTurkish
                ? "Var ✅ (cihazın Türkçe sesi bulundu)"
                : "Yok (yalnızca ses efektleri çalar; sorun değil)"}
          </dd>
        </div>
      </dl>

      <button type="button" className={btn} onClick={play(() => sfx.yay(0))} data-testid="play-yay">
        🔊 Sesi dene
      </button>
      <button type="button" className={btn} onClick={play(() => sfx.yay(1))}>
        ✨ Büyü sesi
      </button>
      <button type="button" className={btn} onClick={play(() => sfx.turn())}>
        🌀 Yüz dönme sesi
      </button>
      <button type="button" className={btn} onClick={play(() => sfx.fanfare())}>
        🏆 Final sesi
      </button>
      <button
        type="button"
        className="btn-big btn-ghost text-purple"
        onClick={() => {
          unlockAudio();
          setMuted(!muted);
          setMutedState(!muted);
        }}
      >
        {muted ? "Sesi aç" : "Sesi kapat"}
      </button>

      {tested && (
        <p className="rounded-2xl bg-purple-soft p-4 text-base font-semibold" data-testid="tips">
          Sesi duymadın mı?
          <br />
          1) 🔔 iPhone&apos;da yan taraftaki <strong>sessiz düğmesini</strong> kapat (turuncu görünmemeli).
          <br />
          2) 🔊 Telefonun <strong>medya ses</strong> düzeyini yükselt.
          <br />
          3) 🎧 Bluetooth kulaklık bağlıysa sesi oraya gidiyor olabilir.
          <br />
          4) 🔄 Sayfayı kapatıp yeniden aç, düğmeye tekrar dokun.
        </p>
      )}
    </main>
  );
}
