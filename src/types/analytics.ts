export const EVENT_NAMES = [
  "landing_view",
  "tutorial_started",
  "tutorial_completed",
  "tutorial_skipped",
  "game_started",
  "phase_completed",
  "game_completed",
  "reward_screen_viewed",
  "replay_started",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export const DEVICE_CLASSES = ["mobile", "tablet", "desktop"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/** İstemcinin ürettiği olay. Kişisel veri içermez; yalnızca rastgele UUID'ler. */
export interface ClientEvent {
  id: string; // uuid (idempotency)
  name: EventName;
  ts: number; // epoch ms (istemci saati)
  playId?: string; // uuid
  playIndex?: number; // 1..n
  durationMs?: number;
  phase?: number; // 1..4
}

export interface EventBatch {
  sessionId: string; // uuid
  campaignId: string;
  deviceClass?: DeviceClass;
  sentAt: number; // epoch ms (istemci saati) – saat sapması düzeltmesi için
  events: ClientEvent[];
}

/** Sunucunun sakladığı satır. */
export interface StoredEvent {
  id: string;
  sessionId: string;
  campaignId: string;
  name: EventName;
  occurredAt: string; // ISO
  playId: string | null;
  playIndex: number | null;
  durationMs: number | null;
  phase: number | null;
}

export interface StoredSession {
  id: string;
  campaignId: string;
  firstSeenAt: string;
  deviceClass: DeviceClass | null;
}
