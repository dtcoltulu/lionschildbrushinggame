export interface Point {
  x: number;
  y: number;
}

export type PhaseKind = "outer" | "gaps" | "inner" | "chewing" | "tongue" | "floss" | "tutorial";

/** Temizlenecek artık türü: plak, çikolata, cips, mikrop (karakter) veya dil pası. */
export type DebrisKind = "plaque" | "chocolate" | "chips" | "germ" | "coating";

export interface Patch {
  x: number;
  y: number;
  r: number;
  kind: DebrisKind;
  /** Görsel çeşitlilik için sabit tohum (0..1). */
  seed: number;
}

export interface PatchState extends Patch {
  /** Tamamlanan swipe sayısı. */
  swipes: number;
  /** Devam eden hareketten gelen kısmi ilerleme (0..1 swipe). */
  partial: number;
  /** Bu lekeyi temizlemek için gereken swipe. Yardımda 1'e düşer. */
  need: number;
  /** 0 = kirli, 1 = temiz. Görsel bunu kullanır. */
  clean: number;
  /** Temizlendiği andan beri geçen ms (animasyon için). */
  cleanedFor: number;
  done: boolean;
}

export interface PhaseSpec {
  kind: PhaseKind;
  patches: Patch[];
  /** Bu aşamada leke başına gereken swipe (verilmezse varsayılan). */
  swipes?: number;
}

export interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  hue: number;
}

export type EngineStatus = "idle" | "playing" | "transition" | "done";

export interface EngineCallbacks {
  onPhaseStart?: (phaseIndex: number) => void;
  onPhaseComplete?: (phaseIndex: number, durationMs: number) => void;
  onProgress?: (overall: number) => void;
  onComplete?: (totalMs: number) => void;
  onSwipe?: () => void;
  onPatchCleaned?: () => void;
  /** Yüz dönerken, sahnenin değiştiği anda bir kez çağrılır. */
  onTurn?: () => void;
}
