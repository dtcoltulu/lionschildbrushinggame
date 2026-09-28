import { describe, expect, it } from "vitest";
import { normalizeBatch, validateBatch } from "@/analytics/server/validate";
import { uuid } from "@/analytics/ids";
import { FALLBACK_CAMPAIGN_ID } from "@/config/campaigns";
import { MemoryStore } from "@/lib/store";

const base = (over: Record<string, unknown> = {}) => ({
  sessionId: uuid(),
  campaignId: FALLBACK_CAMPAIGN_ID,
  sentAt: 1_000_000,
  events: [{ id: uuid(), name: "landing_view", ts: 999_000 }],
  ...over,
});

describe("validateBatch", () => {
  it("geçerli isteği kabul eder", () => {
    expect(validateBatch(base()).ok).toBe(true);
  });
  it("bilinmeyen kampanyayı reddeder", () => {
    expect(validateBatch(base({ campaignId: "yok" })).ok).toBe(false);
  });
  it("bilinmeyen olay adını reddeder", () => {
    expect(validateBatch(base({ events: [{ id: uuid(), name: "x", ts: 1 }] })).ok).toBe(false);
  });
  it("UUID olmayan oturum kodunu reddeder", () => {
    expect(validateBatch(base({ sessionId: "ahmet" })).ok).toBe(false);
  });
  it("20'den fazla olayı reddeder", () => {
    const events = Array.from({ length: 21 }, () => ({ id: uuid(), name: "landing_view", ts: 1 }));
    expect(validateBatch(base({ events })).ok).toBe(false);
  });
  it("boş olay listesini reddeder", () => {
    expect(validateBatch(base({ events: [] })).ok).toBe(false);
  });
  it("kişisel veri olabilecek fazladan alanları çıktıya taşımaz", () => {
    const r = validateBatch(
      base({
        name: "Ayşe",
        events: [{ id: uuid(), name: "landing_view", ts: 5, email: "a@b.c", phone: "555" }],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.value)).not.toMatch(/Ayşe|a@b\.c|555/);
  });
  it("saçma sayısal değerleri reddeder", () => {
    const e = (extra: object) => base({ events: [{ id: uuid(), name: "game_completed", ts: 5, ...extra }] });
    expect(validateBatch(e({ durationMs: -1 })).ok).toBe(false);
    expect(validateBatch(e({ phase: 7 })).ok).toBe(false);
    expect(validateBatch(e({ phase: 6 })).ok).toBe(true);
    expect(validateBatch(e({ playIndex: 1.5 })).ok).toBe(false);
    expect(validateBatch(e({ durationMs: 58000, playIndex: 1 })).ok).toBe(true);
  });
});

describe("normalizeBatch (saat sapması düzeltmesi)", () => {
  it("istemci saati 1 saat geride olsa bile doğru zamana taşır", () => {
    const serverNow = Date.parse("2026-10-11T12:00:00Z");
    const clientNow = serverNow - 3600_000; // telefon 1 saat geri
    const parsed = validateBatch({
      sessionId: uuid(),
      campaignId: FALLBACK_CAMPAIGN_ID,
      sentAt: clientNow,
      events: [{ id: uuid(), name: "landing_view", ts: clientNow - 60_000 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [ev] = normalizeBatch(parsed.value, serverNow);
    expect(ev!.occurredAt).toBe("2026-10-11T11:59:00.000Z");
  });

  it("çevrimdışı kuyruktan gelen eski olay kendi saatini korur", () => {
    const serverNow = Date.parse("2026-10-11T13:00:00Z");
    const parsed = validateBatch({
      sessionId: uuid(),
      campaignId: FALLBACK_CAMPAIGN_ID,
      sentAt: serverNow,
      events: [{ id: uuid(), name: "game_completed", ts: serverNow - 20 * 60_000 }],
    });
    if (!parsed.ok) throw new Error("invalid");
    expect(normalizeBatch(parsed.value, serverNow)[0]!.occurredAt).toBe("2026-10-11T12:40:00.000Z");
  });

  it("4 günden eski olayı atar", () => {
    const serverNow = Date.parse("2026-10-11T13:00:00Z");
    const parsed = validateBatch({
      sessionId: uuid(),
      campaignId: FALLBACK_CAMPAIGN_ID,
      sentAt: serverNow,
      events: [{ id: uuid(), name: "landing_view", ts: serverNow - 4 * 86400_000 }],
    });
    if (!parsed.ok) throw new Error("invalid");
    expect(normalizeBatch(parsed.value, serverNow)).toHaveLength(0);
  });
});

describe("MemoryStore", () => {
  it("aynı olayı iki kez göndermek çift kayıt oluşturmaz", async () => {
    const store = new MemoryStore();
    const parsed = validateBatch(base());
    if (!parsed.ok) throw new Error("invalid");
    const events = normalizeBatch(parsed.value, 1_000_500);
    const input = { sessionId: parsed.value.sessionId, campaignId: FALLBACK_CAMPAIGN_ID, deviceClass: null, firstSeenAt: events[0]!.occurredAt, events };
    await store.insertBatch(input);
    await store.insertBatch(input);
    const data = await store.loadCampaign(FALLBACK_CAMPAIGN_ID);
    expect(data.events).toHaveLength(1);
    expect(data.sessions).toHaveLength(1);
  });
});
