/**
 * WebAudio ile üretilen çok kısa, yumuşak sesler. Dosya yok (0 KB), çevrimdışı çalışır.
 * Tarayıcı kısıtı nedeniyle AudioContext ilk kullanıcı dokunuşunda (unlock) oluşturulur.
 */
const KEY = "lions.muted";

let ctx: AudioContext | null = null;
let muted = false;
let lastSwipeAt = 0;

try {
  muted = typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
} catch {
  /* depolama kapalı olabilir */
}

export function isMuted(): boolean {
  return muted;
}

const listeners = new Set<() => void>();

export function subscribeMuted(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function setMuted(value: boolean): void {
  muted = value;
  listeners.forEach((l) => l());
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    /* yoksay */
  }
}

/** İlk dokunuş/tıklama içinde çağırın. */
export function unlockAudio(): void {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) ctx = new Ctor();
  } catch {
    ctx = null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.08): void {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  tap: () => tone(520, 0, 0.09, "triangle", 0.06),
  swipe: () => {
    const now = Date.now();
    if (now - lastSwipeAt < 90) return;
    lastSwipeAt = now;
    tone(300 + Math.random() * 80, 0, 0.06, "triangle", 0.035);
  },
  clean: () => {
    tone(784, 0, 0.12, "sine", 0.07);
    tone(1047, 0.07, 0.16, "sine", 0.06);
  },
  phase: () => {
    [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.18, "triangle", 0.07));
  },
  fanfare: () => {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.22, "triangle", 0.08));
  },
};
