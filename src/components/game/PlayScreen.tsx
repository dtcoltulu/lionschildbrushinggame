"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { tr } from "@/content/tr";
import { sfx } from "@/game/audio";
import { TOTAL_PHASES } from "@/game/constants";
import { GameCanvas, type GameCanvasHandle } from "./GameCanvas";
import { ProgressBar } from "./ProgressBar";
import { SoundToggle } from "./SoundToggle";

interface Props {
  onPhaseComplete: (phaseIndex: number, durationMs: number) => void;
  onComplete: (totalMs: number) => void;
  /** Her aşama BİTTİKTEN sonra (sahne tamamen temizken, son aşama hariç) "Sence yeterli ve etkin temizlendi mi?" sorusu (kampanya ayarı; varsayılan kapalı). */
  selfCheck?: boolean;
  onCheckAnswer?: (phaseIndex: number, answer: "yes" | "no") => void;
}

type CheckState = { phase: number; stage: "ask" } | { phase: number; stage: "feedback"; answer: "yes" | "no" };

/** Geri bildirim yazısı bu kadar sonra kendiliğinden kapanır (ya da "Devam"a dokunulur). */
const FEEDBACK_MS = 4500;
/** Aşama bitince çocuk önce temiz sahneyi ve parıltıyı görsün; soru bu kadar gecikmeyle açılır. */
const CHECK_DELAY_MS = 900;

const yesText = (phaseIndex: number): string => tr.check.yesFeedback[phaseIndex] ?? tr.check.yesFallback;

export function PlayScreen({ onPhaseComplete, onComplete, selfCheck = false, onCheckAnswer }: Props) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState(0);
  const [message, setMessage] = useState<string>(tr.phases[0].intro);
  const [live, setLive] = useState<string>(tr.phases[0].intro);
  const [callout, setCallout] = useState<string>("");
  const calloutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlRef = useRef<GameCanvasHandle | null>(null);
  const cleaned = useRef(0);
  const flash = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef(0);
  const [check, setCheck] = useState<CheckState | null>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cevap/geri bildirim bitti: her zamanki "Harika! ..." yazısıyla sonraki aşamaya geçiş başlar.
  const finishCheck = useCallback(() => {
    const text = tr.phases[phaseRef.current]?.done ?? "";
    setCheck(null);
    setMessage(text);
    setLive(text);
    controlRef.current?.resume();
  }, []);

  // Cevaptan sonra geri bildirim kısa süre görünür, sonra oyun kendiliğinden devam eder.
  useEffect(() => {
    if (check?.stage !== "feedback") return;
    const id = setTimeout(finishCheck, FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [check, finishCheck]);

  const answerCheck = (answer: "yes" | "no") => {
    if (!check || check.stage !== "ask") return;
    sfx.tap();
    onCheckAnswer?.(check.phase, answer);
    setCheck({ phase: check.phase, stage: "feedback", answer });
    setLive(answer === "yes" ? yesText(check.phase) : tr.check.noFeedback);
  };

  useEffect(
    () => () => {
      if (flash.current) clearTimeout(flash.current);
      if (calloutTimer.current) clearTimeout(calloutTimer.current);
      if (checkTimer.current) clearTimeout(checkTimer.current);
    },
    [],
  );

  const showFor = useCallback((text: string, restore: string, ms = 1300) => {
    setMessage(text);
    if (flash.current) clearTimeout(flash.current);
    flash.current = setTimeout(() => setMessage(restore), ms);
  }, []);

  const callbacks = {
    onPhaseStart: (i: number) => {
      phaseRef.current = i;
      setPhase(i);
      cleaned.current = 0;
      if (flash.current) clearTimeout(flash.current);
      const text = tr.phases[i]?.intro ?? "";
      const call = tr.phases[i]?.callout ?? "";
      setMessage(text);
      setLive(call ? `${call} ${text}` : text);
      if (calloutTimer.current) clearTimeout(calloutTimer.current);
      setCallout(call);
      if (call) calloutTimer.current = setTimeout(() => setCallout(""), 1700);
    },
    onPhaseComplete: (i: number, ms: number) => {
      sfx.yay(i);
      if (flash.current) clearTimeout(flash.current);
      // Soru sorulacaksa "Harika! Ama dişlerin arası kaldı." gibi ipucu veren yazı cevaptan sonra gösterilir.
      const quiet = selfCheck && i < TOTAL_PHASES - 1;
      const text = quiet ? "" : (tr.phases[i]?.done ?? "");
      setMessage(text);
      setLive(text);
      onPhaseComplete(i, ms);
    },
    onProgress: setProgress,
    onComplete: (ms: number) => {
      sfx.fanfare();
      onComplete(ms);
    },
    onSwipe: () => sfx.swipe(),
    onTurn: () => sfx.turn(),
    onCheck: (i: number) => {
      // Oyun bu sırada zaten durmuştur (motor "asking"de); çocuk önce temiz sahneyi görür, soru kısa gecikmeyle açılır.
      if (checkTimer.current) clearTimeout(checkTimer.current);
      checkTimer.current = setTimeout(() => {
        setCheck({ phase: i, stage: "ask" });
        setLive(tr.check.question);
      }, CHECK_DELAY_MS);
    },
    onPatchCleaned: () => {
      sfx.clean();
      cleaned.current += 1;
      if (cleaned.current % 4 === 0) {
        const enc = tr.encouragement[Math.floor(cleaned.current / 4) % tr.encouragement.length]!;
        showFor(enc, tr.phases[phaseRef.current]?.intro ?? "");
      }
    },
  };

  return (
    <main className="screen relative flex flex-col bg-purple text-white" data-testid="play-screen" data-phase={phase + 1}>
      <header className="z-10 flex flex-col gap-2 px-4 pb-2 pt-3" inert={check ? true : undefined}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <ProgressBar value={progress} />
          </div>
          <SoundToggle />
        </div>
        <div className="flex min-h-[3.5rem] items-center gap-2">
          <span className="shrink-0 rounded-full bg-gold px-3 py-1 text-sm font-black text-ink" data-testid="phase-pill">
            {phase + 1}/{TOTAL_PHASES}
          </span>
          <p className="text-lg font-extrabold leading-snug" aria-hidden="true" data-testid="message">
            {message}
          </p>
        </div>
        <p className="sr-only" aria-live="polite">
          {tr.phases[phase]?.name}. {live}
        </p>
      </header>

      <div className="relative flex-1 touch-none" style={{ minHeight: 320 }} inert={check ? true : undefined}>
        <GameCanvas mode="game" callbacks={callbacks} controlRef={controlRef} selfCheck={selfCheck} />
        {callout && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center px-3" data-testid="callout">
            <span key={callout} className="anim-pop rounded-full bg-gold px-6 py-2 text-3xl font-black text-ink shadow-xl ring-4 ring-white">
              {callout}
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={() => controlRef.current?.assist()}
          aria-label={tr.helpLabel}
          className="absolute bottom-4 right-4 z-10 min-h-[48px] min-w-[48px] rounded-full bg-white/90 px-4 text-base font-extrabold text-purple shadow-lg"
          data-testid="help"
        >
          ✨ {tr.help}
        </button>
      </div>

      {check && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/75 px-5" data-testid="check-overlay">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="check-title"
            data-testid="check-dialog"
            data-stage={check.stage}
            className="anim-pop w-full max-w-sm rounded-3xl bg-white p-6 text-center text-ink shadow-2xl"
          >
            {check.stage === "ask" ? (
              <>
                <h2 id="check-title" className="text-2xl font-black leading-snug text-purple">
                  {tr.check.question}
                </h2>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button type="button" autoFocus onClick={() => answerCheck("yes")} className="btn-big bg-purple px-4 text-white" data-testid="check-yes">
                    {tr.check.yes}
                  </button>
                  <button type="button" onClick={() => answerCheck("no")} className="btn-big bg-purple px-4 text-white" data-testid="check-no">
                    {tr.check.no}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p id="check-title" className="text-xl font-black leading-snug text-purple" data-testid="check-feedback" data-answer={check.answer}>
                  {check.answer === "yes" ? yesText(check.phase) : tr.check.noFeedback}
                </p>
                <button type="button" autoFocus onClick={finishCheck} className="btn-big btn-gold mt-5" data-testid="check-continue">
                  {tr.check.next}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
