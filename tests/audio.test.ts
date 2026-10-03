import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Web Audio'yu sayan sahte uygulama: hangi düğümler kuruldu, ses çıkışına bağlandı mı? */
function installFakeBrowser(opts: { voices?: { lang: string; localService: boolean }[]; initialState?: string; userAgent?: string } = {}) {
  const created: string[] = [];
  const resumeCalls = { n: 0 };
  const docListeners = new Map<string, ((e: unknown) => void)[]>();
  const audioEl = { played: 0, paused: 0, loop: false, src: "", attrs: {} as Record<string, string> };
  const docEl = { dataset: {} as Record<string, string> };
  const nav = { audioSession: { type: "auto" }, userAgent: opts.userAgent ?? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 };
  const oscTypes: string[] = [];
  const node = (kind: string) => {
    created.push(kind);
    const n: Record<string, unknown> = {
      connect: (x: unknown) => x ?? n,
      start: () => {
        if (kind === "osc") oscTypes.push(String(n.type));
      },
      stop: () => {},
      frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, value: 0 },
      gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, value: 0 },
      Q: { value: 0 },
      type: "",
      buffer: null,
    };
    return n;
  };
  class FakeCtx {
    currentTime = 0;
    sampleRate = 8000;
    state = opts.initialState ?? "running";
    destination = {};
    onstatechange: (() => void) | null = null;
    resume() {
      resumeCalls.n += 1;
      this.state = "running";
      this.onstatechange?.();
      return Promise.resolve();
    }
    createOscillator() { return node("osc"); }
    createGain() { return node("gain"); }
    createDynamicsCompressor() {
      const n = node("compressor");
      Object.assign(n, { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 } });
      return n;
    }
    createBiquadFilter() { return node("filter"); }
    createBufferSource() { return node("buffer"); }
    createBuffer(_c: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
  }
  const spoken: { text: string; voice: unknown; rate: number; pitch: number; volume: number }[] = [];
  const voices = opts.voices ?? [];
  const listeners: (() => void)[] = [];
  const w = {
    AudioContext: FakeCtx,
    speechSynthesis: {
      getVoices: () => voices,
      addEventListener: (_t: string, fn: () => void) => void listeners.push(fn),
      cancel: () => {},
      speaking: false,
      pending: false,
      speak: (u: { text: string; voice: unknown; rate: number; pitch: number; volume: number }) =>
        spoken.push({ text: u.text, voice: u.voice, rate: u.rate, pitch: u.pitch, volume: u.volume }),
    },
  };
  const store = new Map<string, string>();
  vi.stubGlobal("window", w);
  vi.stubGlobal("navigator", nav);
  vi.stubGlobal("document", {
    documentElement: docEl,
    visibilityState: "visible",
    createElement: () => ({
      setAttribute: (k: string, v: string) => (audioEl.attrs[k] = v),
      set loop(v: boolean) { audioEl.loop = v; },
      get loop() { return audioEl.loop; },
      set src(v: string) { audioEl.src = v; },
      get src() { return audioEl.src; },
      play: () => { audioEl.played += 1; return Promise.resolve(); },
      pause: () => { audioEl.paused += 1; },
    }),
    addEventListener: (t: string, f: (e: unknown) => void) => docListeners.set(t, [...(docListeners.get(t) ?? []), f]),
    removeEventListener: (t: string, f: (e: unknown) => void) => docListeners.set(t, (docListeners.get(t) ?? []).filter((x) => x !== f)),
  });
  vi.stubGlobal("btoa", (v: string) => Buffer.from(v, "binary").toString("base64"));
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; voice: unknown = null; lang = ""; pitch = 1; rate = 1; volume = 1; constructor(t: string) { this.text = t; } });
  /** Gerçek konuşmalar (ısınma için söylenen sessiz cümle hariç). */
  const said = () => spoken.filter((u) => u.text.trim() !== "");
  const fire = (type: string) => (docListeners.get(type) ?? []).forEach((f) => f({}));
  return { created, oscTypes, resumeCalls, audioEl, docEl, nav, fire, spoken, said, voices, fireVoicesChanged: () => listeners.forEach((f) => f()) };
}

describe("sesler", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ses sistemi yokken (unlock edilmeden) hiçbir şey patlamaz", async () => {
    const { sfx } = await import("@/game/audio");
    expect(() => {
      sfx.yay(0);
      sfx.turn();
      sfx.fanfare();
      sfx.clean();
    }).not.toThrow();
  });

  it("aşama bitiş sesi (yay) birden çok düğüm kurar; sessizdeyken hiç kurmaz", async () => {
    const env = installFakeBrowser();
    const audio = await import("@/game/audio");
    audio.unlockAudio();
    audio.sfx.yay(0);
    expect(env.created.filter((k) => k === "osc").length).toBeGreaterThanOrEqual(6); // 2 "yu-pi" kayması + 4 parıltı
    expect(env.created).toContain("filter"); // ünlü harf süzgeci

    const before = env.created.length;
    audio.setMuted(true);
    audio.sfx.yay(1);
    audio.sfx.turn();
    audio.sfx.fanfare();
    vi.advanceTimersByTime(2000);
    expect(env.created.length).toBe(before);
    expect(env.said()).toHaveLength(0);
  });

  it("yüz dönme sesi (whoosh) süzgeçli gürültü kurar", async () => {
    const env = installFakeBrowser();
    const audio = await import("@/game/audio");
    audio.unlockAudio();
    audio.sfx.turn();
    expect(env.created).toContain("buffer");
    expect(env.created).toContain("filter");
  });

  it("konuşma: yalnızca YEREL Türkçe ses kullanılır; bulut sesi asla", async () => {
    const cloud = { lang: "tr-TR", localService: false };
    const env = installFakeBrowser({ voices: [cloud, { lang: "en-US", localService: true }] });
    const audio = await import("@/game/audio");
    audio.unlockAudio();
    audio.sfx.yay(0);
    vi.advanceTimersByTime(2000);
    expect(env.said()).toHaveLength(0); // yerel Türkçe yok → konuşma yok (yalnızca ses efekti)
  });

  it("yerel Türkçe ses varsa kısa bir övgü söyler; efektten SONRA gelir", async () => {
    const local = { lang: "tr-TR", localService: true };
    const env = installFakeBrowser({ voices: [{ lang: "en-US", localService: true }, local] });
    const audio = await import("@/game/audio");
    audio.unlockAudio();
    audio.sfx.yay(0);
    expect(env.said()).toHaveLength(0); // hemen değil: önce efekt duyulur
    vi.advanceTimersByTime(audio.SPEECH.delayMs + 10);
    expect(env.said()).toHaveLength(1);
    expect(env.said()[0]!.text).toBe("Yuppi!");
    expect(env.said()[0]!.voice).toBe(local);
    audio.sfx.yay(2);
    vi.advanceTimersByTime(audio.SPEECH.delayMs + 10);
    expect(env.said()[1]!.text).toBe("Seviye atladın!");
  });

  it("konuşma hızı doğal ve çocuklara uygun: hızlı değil, ton çok tiz değil", async () => {
    const local = { lang: "tr-TR", localService: true };
    const env = installFakeBrowser({ voices: [local] });
    const audio = await import("@/game/audio");
    audio.unlockAudio();
    for (let i = 0; i < 12; i++) {
      audio.sfx.yay(i);
      vi.advanceTimersByTime(audio.SPEECH.delayMs + 10);
    }
    expect(env.said()).toHaveLength(12);
    for (const u of env.said()) {
      expect(u.rate).toBeGreaterThanOrEqual(0.8);
      expect(u.rate).toBeLessThanOrEqual(1.0); // normal hızdan hızlı değil
      expect(u.pitch).toBeGreaterThanOrEqual(1.1);
      expect(u.pitch).toBeLessThanOrEqual(1.5);
    }
  });

  it("övgüler kısa, olumlu ve çeşitli; oyun sonunda kahramanlık cümlesi vardır", async () => {
    const audio = await import("@/game/audio");
    expect(new Set(audio.CHEERS).size).toBe(audio.CHEERS.length);
    for (const c of audio.CHEERS) expect(c.length).toBeLessThanOrEqual(18);
    expect(audio.CHEERS).toHaveLength(6); // her aşama için bir tane
    // Telaffuzu kötü çıkan kelimeler kullanılmaz
    expect([...audio.CHEERS, audio.FINAL_CHEER].join(" ")).not.toMatch(/efsane/i);
    expect(audio.FINAL_CHEER).toContain("Diş kahramanı");
  });

  it("İLK 'Yuppi' kaçmaz: sesler geç yüklense bile ısınma + yeniden deneme ile söylenir", async () => {
    const local = { lang: "tr-TR", localService: true };
    const env = installFakeBrowser({ voices: [] }); // başta hiç ses yok
    const audio = await import("@/game/audio");
    audio.unlockAudio(); // ilk dokunuş: ısınma yapılır
    expect(env.spoken.some((u) => u.text.trim() === "" && u.volume === 0)).toBe(true);
    env.voices.push(local); // sesler o arada yüklendi (olay tetiklenmese bile)
    audio.sfx.yay(0);
    vi.advanceTimersByTime(audio.SPEECH.delayMs + 10);
    expect(env.said().map((u) => u.text)).toEqual(["Yuppi!"]);
    expect(env.said()[0]!.volume).toBe(1); // tam ses
  });

  it("voiceschanged olayı gelince de ses seçilir", async () => {
    const local = { lang: "tr-TR", localService: true };
    const env = installFakeBrowser({ voices: [] });
    const audio = await import("@/game/audio");
    audio.unlockAudio();
    env.voices.push(local);
    env.fireVoicesChanged();
    audio.sfx.yay(1);
    vi.advanceTimersByTime(audio.SPEECH.delayMs + 10);
    expect(env.said().map((u) => u.text)).toEqual(["Süper güç!"]);
  });

  it("aşama sesleri çift/tek sayılı aşamada farklı tarzda çalar (oyun: kare dalga / büyü: yumuşak)", async () => {
    const env = installFakeBrowser();
    const audio = await import("@/game/audio");
    audio.unlockAudio();

    const n0 = env.oscTypes.length;
    audio.sfx.yay(0); // oyun tarzı: yıldız + güç artışı (8-bit kare dalga)
    const gameTypes = env.oscTypes.slice(n0);
    const n1 = env.oscTypes.length;
    audio.sfx.yay(1); // büyü tarzı: çan benzeri ışıltı
    const magicTypes = env.oscTypes.slice(n1);

    expect(gameTypes).toContain("square");
    expect(magicTypes).not.toContain("square");
    expect(magicTypes).toContain("sine");
  });

  describe("telefon uyumu", () => {
    it("iPhone sessiz düğmesini aşar: audioSession=playback ve sessiz <audio> döngüsü çalınır", async () => {
      const env = installFakeBrowser();
      const audio = await import("@/game/audio");
      audio.unlockAudio();
      expect(env.nav.audioSession.type).toBe("playback"); // iOS 17+
      expect(env.audioEl.played).toBeGreaterThanOrEqual(1); // eski iOS için sessiz medya
      expect(env.audioEl.loop).toBe(true);
      expect(env.audioEl.attrs.playsinline).toBe("");
      expect(env.audioEl.src.startsWith("data:audio/wav;base64,UklGR")).toBe(true); // geçerli RIFF/WAV
    });

    it("Android'de sessiz <audio> hilesi KULLANILMAZ (bildirim çubuğunda medya göstergesi çıkmasın)", async () => {
      const env = installFakeBrowser({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120 Mobile" });
      const audio = await import("@/game/audio");
      audio.unlockAudio();
      expect(env.audioEl.played).toBe(0);
      expect(env.created).toContain("compressor"); // ana ses yine kurulur
      expect(env.docEl.dataset.audio).toBe("running");
    });

    it("sessize alınınca sessiz medya durur, açılınca yeniden başlar", async () => {
      const env = installFakeBrowser();
      const audio = await import("@/game/audio");
      audio.unlockAudio();
      const played = env.audioEl.played;
      audio.setMuted(true);
      expect(env.audioEl.paused).toBeGreaterThanOrEqual(1);
      audio.setMuted(false);
      expect(env.audioEl.played).toBeGreaterThan(played);
    });

    it("askıdaki (suspended) ses bağlamı dokunuşta yeniden açılır ve durum yayımlanır", async () => {
      const env = installFakeBrowser({ initialState: "suspended" });
      const audio = await import("@/game/audio");
      expect(env.docEl.dataset.audio).toBeUndefined();
      audio.unlockAudio();
      expect(env.resumeCalls.n).toBeGreaterThanOrEqual(1);
      await Promise.resolve();
      expect(env.docEl.dataset.audio).toBe("running");
    });

    it("global dokunuş dinleyicisi: touchend/pointerup/click/keydown sesi açar; kaldırılınca durur", async () => {
      const env = installFakeBrowser({ initialState: "suspended" });
      const audio = await import("@/game/audio");
      const remove = audio.installAudioUnlock();
      expect(env.docEl.dataset.audio).toBe("none"); // henüz hiç dokunuş yok
      env.fire("touchend"); // ilk dokunuş: bağlam oluşur ve açılır
      await Promise.resolve();
      expect(env.docEl.dataset.audio).toBe("running");
      remove();
      const before = env.resumeCalls.n;
      env.fire("click");
      expect(env.resumeCalls.n).toBe(before);
    });

    it("tüm sesler ana ses yükseltici + sınırlayıcıdan geçer (telefon hoparlörü için)", async () => {
      const env = installFakeBrowser();
      const audio = await import("@/game/audio");
      audio.unlockAudio();
      expect(env.created).toContain("compressor");
      expect(audio.MASTER_GAIN).toBeGreaterThan(1.3); // kısık telefon hoparlörlerini telafi eder
      expect(audio.MASTER_GAIN).toBeLessThan(3);
    });

    it("ses desteği olmayan tarayıcıda (AudioContext yok) hata vermez", async () => {
      installFakeBrowser();
      vi.stubGlobal("window", { speechSynthesis: undefined });
      const audio = await import("@/game/audio");
      expect(() => {
        audio.unlockAudio();
        audio.sfx.yay(0);
      }).not.toThrow();
    });
  });
});
