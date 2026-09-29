import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Web Audio'yu sayan sahte uygulama: hangi düğümler kuruldu, ses çıkışına bağlandı mı? */
function installFakeBrowser(opts: { voices?: { lang: string; localService: boolean }[] } = {}) {
  const created: string[] = [];
  const node = (kind: string) => {
    created.push(kind);
    const n: Record<string, unknown> = {
      connect: (x: unknown) => x ?? n,
      start: () => {},
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
    state = "running";
    destination = {};
    resume() {}
    createOscillator() { return node("osc"); }
    createGain() { return node("gain"); }
    createBiquadFilter() { return node("filter"); }
    createBufferSource() { return node("buffer"); }
    createBuffer(_c: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
  }
  const spoken: { text: string; voice: unknown }[] = [];
  const voices = opts.voices ?? [];
  const w = {
    AudioContext: FakeCtx,
    speechSynthesis: {
      getVoices: () => voices,
      addEventListener: () => {},
      cancel: () => {},
      speak: (u: { text: string; voice: unknown }) => spoken.push({ text: u.text, voice: u.voice }),
    },
  };
  const store = new Map<string, string>();
  vi.stubGlobal("window", w);
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; voice: unknown = null; lang = ""; pitch = 1; rate = 1; volume = 1; constructor(t: string) { this.text = t; } });
  return { created, spoken };
}

describe("sesler", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
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
    expect(env.created.length).toBe(before);
    expect(env.spoken).toHaveLength(0);
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
    expect(env.spoken).toHaveLength(0); // yerel Türkçe yok → konuşma yok (yalnızca ses efekti)
  });

  it("yerel Türkçe ses varsa kısa bir övgü söyler", async () => {
    const local = { lang: "tr-TR", localService: true };
    const env = installFakeBrowser({ voices: [{ lang: "en-US", localService: true }, local] });
    const audio = await import("@/game/audio");
    audio.unlockAudio();
    audio.sfx.yay(0);
    expect(env.spoken).toHaveLength(1);
    expect(env.spoken[0]!.text).toBe("Yuppi!");
    expect(env.spoken[0]!.voice).toBe(local);
    audio.sfx.yay(2);
    expect(env.spoken[1]!.text).toBe("Aferin!");
  });
});
