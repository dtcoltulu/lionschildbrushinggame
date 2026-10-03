/**
 * WebAudio ile üretilen çok kısa, yumuşak sesler. Dosya yok (0 KB), çevrimdışı çalışır.
 *
 * TELEFONDA çalışması için:
 * - AudioContext ilk kullanıcı dokunuşunda oluşturulur ve her dokunuşta (suspended/interrupted ise) yeniden açılır.
 * - iPhone'un sessiz düğmesi WebAudio'yu susturur: `navigator.audioSession = "playback"` (iOS 17+) ve
 *   sessiz bir <audio> döngüsü (eski iOS) ile ses "medya" olarak çalınır.
 * - Telefon hoparlörleri kısık olduğundan tüm sesler bir ana ses yükselticiden + sınırlayıcıdan (compressor) geçer.
 * - Durum `<html data-audio="none|suspended|running|interrupted">` olarak yayımlanır (destek/test için).
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
  try {
    if (value) silentEl?.pause();
    else playAsMedia();
  } catch {
    /* yoksay */
  }
  listeners.forEach((l) => l());
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    /* yoksay */
  }
}

/** Telefon hoparlörleri için ana ses düzeyi; sınırlayıcı tepe noktalarında bozulmayı önler. */
export const MASTER_GAIN = 1.9;

let master: AudioNode | null = null;

function out(): AudioNode | null {
  return master ?? ctx?.destination ?? null;
}

function publishState(): void {
  try {
    document.documentElement.dataset.audio = ctx ? String(ctx.state) : "none";
  } catch {
    /* document yoksa yoksay */
  }
}

/** 0.2 sn'lik tamamen sessiz 8 bit WAV (data URI) – iOS'ta ses oturumunu "medya" kategorisine almak için. */
function silentWavDataUri(): string {
  const samples = 1600; // 8 kHz × 0.2 sn
  const bytes = new Uint8Array(44 + samples);
  const dv = new DataView(bytes.buffer);
  const wr = (o: number, t: string) => [...t].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  wr(0, "RIFF");
  dv.setUint32(4, 36 + samples, true);
  wr(8, "WAVEfmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, 8000, true);
  dv.setUint32(28, 8000, true);
  dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true);
  wr(36, "data");
  dv.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8 bit PCM'de sessizlik = 128
  let bin = "";
  bytes.forEach((v) => (bin += String.fromCharCode(v)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

let silentEl: HTMLAudioElement | null = null;

/** iPhone/iPad (iPadOS 13+ "Mac" gibi görünür, ama dokunmatiktir). */
function isIOS(): boolean {
  try {
    const n = navigator;
    return /iPad|iPhone|iPod/.test(n.userAgent) || (n.platform === "MacIntel" && n.maxTouchPoints > 1);
  } catch {
    return false;
  }
}

/** iPhone sessiz düğmesini aşar: ses "medya" gibi çalınır. Kullanıcı dokunuşu içinde çağrılmalı. */
function playAsMedia(): void {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = "playback"; // iOS 17+
  } catch {
    /* yoksay */
  }
  // Sessiz <audio> hilesi yalnızca iOS'ta gerekir; Android'de bildirim çubuğunda "medya çalıyor" göstergesi çıkarabilir.
  if (muted || !isIOS()) return;
  try {
    if (!silentEl) {
      silentEl = document.createElement("audio");
      silentEl.setAttribute("playsinline", "");
      silentEl.setAttribute("aria-hidden", "true");
      silentEl.loop = true;
      silentEl.src = silentWavDataUri();
    }
    void silentEl.play()?.catch?.(() => {});
  } catch {
    /* yoksay */
  }
}

/** Ses bağlamını oluşturur/açar. Dokunuş içinde çağırın (ilk dokunuş ve her yeni dokunuş güvenlidir). */
export function unlockAudio(): void {
  prepareSpeech(); // konuşma motorunu da ısıt (ilk "Yuppi" zayıf/eksik kalmasın)
  playAsMedia();
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      // ana ses + sınırlayıcı
      const gain = ctx.createGain();
      gain.gain.value = MASTER_GAIN;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      gain.connect(comp);
      comp.connect(ctx.destination);
      master = gain;
      ctx.onstatechange = publishState;
    }
    if (ctx.state !== "running") void ctx.resume().then(publishState, publishState);
    // iOS: dokunuş içinde tek örneklik sessiz bir kaynak çalarak sesi kilit açar
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    ctx = null;
    master = null;
  }
  publishState();
}

/**
 * Sayfadaki HER dokunuş/tıklama/tuşta ses bağlamını (askıdaysa) yeniden açar.
 * Telefon kilitlenince, arama gelince ya da sekme değişince ses "askıya" alınabilir.
 */
export function installAudioUnlock(): () => void {
  if (typeof document === "undefined") return () => {};
  const onGesture = () => {
    if (!ctx || ctx.state !== "running") unlockAudio();
  };
  const events = ["pointerup", "touchend", "click", "keydown"] as const;
  events.forEach((e) => document.addEventListener(e, onGesture, { capture: true, passive: true }));
  const onVisible = () => {
    if (document.visibilityState === "visible" && ctx && ctx.state !== "running") void ctx.resume().then(publishState, publishState);
  };
  document.addEventListener("visibilitychange", onVisible);
  publishState();
  return () => {
    events.forEach((e) => document.removeEventListener(e, onGesture, true));
    document.removeEventListener("visibilitychange", onVisible);
  };
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
  osc.connect(g).connect(out()!);
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
  osc.connect(filt).connect(g).connect(out()!);
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
  src.connect(filt).connect(g).connect(out()!);
  src.start(t0);
}

// ---- Konuşma – yalnızca cihazın YEREL Türkçe sesiyle ------------------------------------
// Bulut sesleri metni bir sunucuya gönderebilir; gizlilik için yerel olmayan sesler kullanılmaz.
/** Konuşma ayarları: rate 1 = cihazın normal hızı. Çocuklar için biraz daha yavaş ve net. */
export const SPEECH = { rate: 0.88, pitchMin: 1.2, pitchMax: 1.4, volume: 1, delayMs: 320 } as const;

let trVoice: SpeechSynthesisVoice | null = null;
let speechPrepared = false;

function pickVoice(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;
  trVoice = voices.find((v) => v.lang.toLowerCase().startsWith("tr") && v.localService) ?? null;
}

/**
 * Sesler bazı tarayıcılarda geç yüklenir; ilk konuşma boşa gitmesin diye ilk dokunuşta hazırlanır:
 * ses listesi okunur, değişince güncellenir ve sessiz bir cümleyle motor ısıtılır.
 */
function prepareSpeech(): void {
  if (speechPrepared || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  speechPrepared = true;
  try {
    pickVoice();
    window.speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
    const warm = new SpeechSynthesisUtterance(" ");
    warm.volume = 0;
    window.speechSynthesis.speak(warm);
  } catch {
    /* desteklenmiyorsa sessizce geç */
  }
}

/** Ses testi sayfası için: konuşma desteği ve yerel Türkçe ses var mı? */
export function getSpeechInfo(): { supported: boolean; localTurkish: boolean; voiceCount: number } {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return { supported: false, localTurkish: false, voiceCount: 0 };
  try {
    pickVoice();
    return { supported: true, localTurkish: trVoice !== null, voiceCount: window.speechSynthesis.getVoices().length };
  } catch {
    return { supported: false, localTurkish: false, voiceCount: 0 };
  }
}

export function audioState(): string {
  return ctx ? String(ctx.state) : "none";
}

function speak(text: string): void {
  if (muted || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    if (!trVoice) pickVoice(); // sesler o arada yüklenmiş olabilir
    if (!trVoice) return;
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = trVoice;
    u.lang = trVoice.lang;
    // Doğal, rahat hız (çocuklar anlasın) ve hafif tiz, canlı ton; her seferinde küçük bir çeşitleme.
    u.pitch = SPEECH.pitchMin + Math.random() * (SPEECH.pitchMax - SPEECH.pitchMin);
    u.rate = SPEECH.rate;
    u.volume = SPEECH.volume;
    // Bazı Android cihazlarda hemen ardından gelen cancel→speak konuşmayı yutar: yalnızca gerekiyorsa iptal et.
    if (synth.speaking || synth.pending) synth.cancel();
    synth.speak(u);
  } catch {
    /* konuşma desteklenmiyorsa sessizce geç */
  }
}

/**
 * Oyun dünyası tarzında (seviye atlama, yıldız, büyü) kısa ve telaffuzu kolay Türkçe övgüler.
 * Sıra: 6 aşamanın her biri için biri; tekrar oynamada baştan.
 */
export const CHEERS = ["Yuppi!", "Süper güç!", "Seviye atladın!", "Sihirbaz gibisin!", "Bir yıldız daha!", "Pırıl pırıl!"] as const;
export const FINAL_CHEER = "Diş kahramanı oldun! Bravo sana!";

/** Oyun tarzı 8-bit "madeni para/yıldız": iki kısa, yüksek kare dalga notası. */
function coin(): void {
  tone(988, 0, 0.07, "square", 0.045);
  tone(1319, 0.07, 0.3, "square", 0.045);
}

/** 8-bit "güç artışı": hızla yükselen kare dalga arpej (seviye atlama hissi). */
function powerUp(): void {
  [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.1 + i * 0.055, 0.1, "square", 0.04));
  tone(2093, 0.44, 0.22, "square", 0.035);
}

/** Büyülü ışıltı: çan/celesta benzeri, yukarı saçılan yumuşak notalar. */
function magicSparkle(): void {
  [784, 988, 1175, 1319, 1568, 1760, 2093, 2349].forEach((f, i) => tone(f, 0.1 + i * 0.06, 0.4, "sine", 0.045));
  tone(3136, 0.62, 0.45, "sine", 0.03);
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
  /** Bir yüzey/aşama bitince: "yu-up-pi!" + parıltı + (varsa yerel Türkçe ses) kısa övgü. */
  yay: (phaseIndex = 0) => {
    vocalGlide(0, 0.16, 330, 620, 700, 1800);
    vocalGlide(0.19, 0.22, 520, 980, 900, 2400, 0.08);
    // Çift sayılı aşamalarda oyun tarzı (yıldız + güç artışı), tek sayılılarda büyü tarzı ışıltı.
    if (phaseIndex % 2 === 0) {
      coin();
      powerUp();
    } else {
      magicSparkle();
    }
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
    // "Bölüm tamamlandı" tarzı: 8-bit yükselen arpej + uzun son nota, üstüne büyülü ışıltı
    [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.11, 0.24, "square", 0.05));
    tone(2093, 0.95, 0.5, "square", 0.05);
    vocalGlide(0.5, 0.25, 400, 1100, 800, 2600, 0.09);
    magicSparkle();
    setTimeout(() => speak(FINAL_CHEER), SPEECH.delayMs + 250);
  },
};
