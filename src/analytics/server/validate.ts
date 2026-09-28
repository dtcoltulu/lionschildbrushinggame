import { isKnownCampaign } from "@/config/campaigns";
import { DEVICE_CLASSES, EVENT_NAMES, type ClientEvent, type EventBatch, type StoredEvent } from "@/types/analytics";
import { UUID_RE } from "../ids";

export const MAX_BATCH = 20;
export const MAX_BODY_BYTES = 16 * 1024;
const MAX_AGE_MS = 3 * 24 * 3600 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_DURATION_MS = 2 * 3600 * 1000;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** Bilinmeyen alanları yok sayar (kişisel veri sızmasın), gerekenleri katı doğrular. */
export function validateBatch(input: unknown): Result<EventBatch> {
  if (!isObj(input)) return { ok: false, error: "body" };
  const { sessionId, campaignId, deviceClass, sentAt, events } = input;
  if (!isUuid(sessionId)) return { ok: false, error: "sessionId" };
  if (typeof campaignId !== "string" || !isKnownCampaign(campaignId)) return { ok: false, error: "campaignId" };
  if (deviceClass !== undefined && !(DEVICE_CLASSES as readonly unknown[]).includes(deviceClass)) {
    return { ok: false, error: "deviceClass" };
  }
  if (!isInt(sentAt, 1, 4102444800000)) return { ok: false, error: "sentAt" };
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_BATCH) return { ok: false, error: "events" };

  const clean: ClientEvent[] = [];
  for (const e of events) {
    if (!isObj(e)) return { ok: false, error: "event" };
    if (!isUuid(e.id)) return { ok: false, error: "event.id" };
    if (typeof e.name !== "string" || !(EVENT_NAMES as readonly string[]).includes(e.name)) {
      return { ok: false, error: "event.name" };
    }
    if (!isInt(e.ts, 1, 4102444800000)) return { ok: false, error: "event.ts" };
    const out: ClientEvent = { id: e.id, name: e.name as ClientEvent["name"], ts: e.ts };
    if (e.playId !== undefined) {
      if (!isUuid(e.playId)) return { ok: false, error: "event.playId" };
      out.playId = e.playId;
    }
    if (e.playIndex !== undefined) {
      if (!isInt(e.playIndex, 1, 1000)) return { ok: false, error: "event.playIndex" };
      out.playIndex = e.playIndex;
    }
    if (e.durationMs !== undefined) {
      if (!isInt(e.durationMs, 0, MAX_DURATION_MS)) return { ok: false, error: "event.durationMs" };
      out.durationMs = e.durationMs;
    }
    if (e.phase !== undefined) {
      if (!isInt(e.phase, 1, 4)) return { ok: false, error: "event.phase" };
      out.phase = e.phase;
    }
    clean.push(out);
  }
  return {
    ok: true,
    value: {
      sessionId,
      campaignId,
      deviceClass: deviceClass as EventBatch["deviceClass"],
      sentAt,
      events: clean,
    },
  };
}

/**
 * İstemci saatindeki sapmayı düzeltir: skew = sunucuNow − istemci.sentAt.
 * Çok eski olayları atar, gelecekteki olayları "şimdi"ye çeker.
 */
export function normalizeBatch(batch: EventBatch, serverNow: number): StoredEvent[] {
  const skew = serverNow - batch.sentAt;
  const out: StoredEvent[] = [];
  for (const e of batch.events) {
    let at = e.ts + skew;
    if (at > serverNow + MAX_FUTURE_MS) at = serverNow;
    if (at > serverNow) at = serverNow;
    if (serverNow - at > MAX_AGE_MS) continue;
    out.push({
      id: e.id,
      sessionId: batch.sessionId,
      campaignId: batch.campaignId,
      name: e.name,
      occurredAt: new Date(at).toISOString(),
      playId: e.playId ?? null,
      playIndex: e.playIndex ?? null,
      durationMs: e.durationMs ?? null,
      phase: e.phase ?? null,
    });
  }
  return out;
}
