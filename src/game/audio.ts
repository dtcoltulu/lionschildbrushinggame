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

/** "Yu-up-pi!" benzeri, ünlü harf hissi veren iki kısa kayan ses (testere dişi dalga + gezinen süzgeç). */
function vocalGlide(start: number, dur: number, f0: number, f1: number, formant0: number, formant1: number, gain = 0.07): void {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const filt = ctx.createBiquadFilter();
  const g = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  filt.type = "bandpass";
  filt.Q.value = 3.5;
  filt.frequency.setValueAtTime(formant0, t0);
  filt.frequency.exponentialRampToValueAtTime(formant1, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(filt).connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** Süzülen kısa "vınn": yüz dönerken. */
function whoosh(): void {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * 0.5);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = "bandpass";
  filt.Q.value = 1.2;
  filt.frequency.setValueAtTime(300, t0);
  filt.frequency.exponentialRampToValueAtTime(2200, t0 + 0.28);
  filt.frequency.exponentialRampToValueAtTime(500, t0 + 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.08, t0 + 0.12);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
  src.connect(filt).connect(g).connect(ctx.destination);
  src.start(t0);
}

// ---- Konuşma ("Yuppi!") – yalnızca cihazın YEREL Türkçe sesiyle ----------------------
// Bulut sesleri metni bir sunucuya gönderebilir; gizlilik için yerel olmayan sesler kullanılmaz.
/** Konuşma ayarları: rate 1 = cihazın normal hızı. Çocuklar için biraz daha yavaş ve net. */
export const SPEECH = { rate: 0.88, pitchMin: 1.2, pitchMax: 1.4, volume: 0.9, delayMs: 320 } as const;

let trVoice: SpeechSynthesisVoice | null = null;
let voicesLoaded = false;

function pickVoice(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;
  voicesLoaded = true;
  trVoice = voices.find((v) => v.lang.toLowerCase().startsWith("tr") && v.localService) ?? null;
}

function speak(text: string): void {
  if (muted || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    if (!voicesLoaded) {
      pickVoice();
      window.speechSynthesis.addEventListener?.("voiceschanged", pickVoice, { once: true });
    }
    if (!trVoice) return;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = trVoice;
    u.lang = trVoice.lang;
    // Doğal, rahat hız (çocuklar anlasın) ve hafif tiz, canlı ton; her seferinde küçük bir çeşitleme.
    u.pitch = SPEECH.pitchMin + Math.random() * (SPEECH.pitchMax - SPEECH.pitchMin);
    u.rate = SPEECH.rate;
    u.volume = SPEECH.volume;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* konuşma desteklenmiyorsa sessizce geç */
  }
}

/** Alfa kuşağının (4-12 yaş) sevdiği, enerjik ve olumlu kısa övgüler. */
export const CHEERS = ["Yuppi!", "Efsane!", "Süpersin!", "Yaşasın!", "Bomba!", "Harikasın!", "Şahane!", "Bravo sana!"] as const;
export const FINAL_CHEER = "Diş kahramanı oldun! Efsanesin!";

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
  /** Bir yüzey/aşama bitince: "yu-up-pi!" + parıltı + (varsa yerel Türkçe ses) kısa övgü. */
  yay: (phaseIndex = 0) => {
    vocalGlide(0, 0.16, 330, 620, 700, 1800);
    vocalGlide(0.19, 0.22, 520, 980, 900, 2400, 0.08);
    [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.12 + i * 0.07, 0.2, "sine", 0.05));
    // Önce ses efekti duyulsun, konuşma biraz sonra gelsin (üst üste binip hızlı/karışık duyulmasın).
    const text = CHEERS[phaseIndex % CHEERS.length]!;
    setTimeout(() => speak(text), SPEECH.delayMs);
  },
  /** Yüz dönerken. */
  turn: () => whoosh(),
  phase: () => {
    [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.18, "triangle", 0.07));
  },
  fanfare: () => {
    [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.11, 0.24, "triangle", 0.08));
    vocalGlide(0.5, 0.25, 400, 1100, 800, 2600, 0.09);
    setTimeout(() => speak(FINAL_CHEER), SPEECH.delayMs + 250);
  },
};
