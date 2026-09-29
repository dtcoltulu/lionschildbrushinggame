import { describe, expect, it } from "vitest";
import { SupabaseStore } from "@/lib/supabase-store";
import { describeStoreError } from "@/lib/store-error";
import { computeKpis } from "@/lib/kpi";
import type { StoredEvent } from "@/types/analytics";

interface Call {
  method: string;
  path: string;
  query: string;
  prefer: string | null;
  body: unknown;
}

/** PostgREST'i taklit eden sahte fetch: gelen istekleri kaydeder. */
function fakePostgrest(handlers: { events?: unknown[]; sessions?: unknown[]; status?: number; errorBody?: unknown } = {}) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({
      method: init?.method ?? "GET",
      path: url.pathname,
      query: url.search,
      prefer: headers.get("prefer"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (handlers.status && handlers.status >= 400) {
      return new Response(JSON.stringify(handlers.errorBody ?? { message: "Invalid API key" }), {
        status: handlers.status,
        headers: { "content-type": "application/json" },
      });
    }
    if ((init?.method ?? "GET") === "GET") {
      const all = url.pathname.endsWith("/events") ? (handlers.events ?? []) : (handlers.sessions ?? []);
      // PostgREST gibi offset/limit'e uyar
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? all.length);
      return new Response(JSON.stringify(all.slice(offset, offset + limit)), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  return { f, calls };
}

const ev: StoredEvent = {
  id: "22222222-2222-4222-8222-222222222222",
  sessionId: "11111111-1111-4111-8111-111111111111",
  campaignId: "c1",
  name: "game_completed",
  occurredAt: "2026-10-11T08:00:00.000Z",
  playId: null,
  playIndex: 1,
  durationMs: 58000,
  phase: null,
};

describe("SupabaseStore (sahte PostgREST ile)", () => {
  it("yazma: önce oturum, sonra olaylar; çift kayıt yok (ignore-duplicates)", async () => {
    const { f, calls } = fakePostgrest();
    const store = new SupabaseStore("https://x.supabase.co", "sb_secret_dummy_key_value", { fetch: f });
    await store.insertBatch({ sessionId: ev.sessionId, campaignId: "c1", deviceClass: "mobile", firstSeenAt: ev.occurredAt, events: [ev] });

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /rest/v1/sessions", "POST /rest/v1/events"]);
    expect(calls[0]!.query).toContain("on_conflict=id%2Ccampaign_id");
    expect(calls[0]!.prefer).toContain("resolution=ignore-duplicates");
    expect(calls[1]!.query).toContain("on_conflict=id");
    expect(calls[1]!.prefer).toContain("resolution=ignore-duplicates");
    const row = (calls[1]!.body as Record<string, unknown>[])[0]!;
    expect(row).toMatchObject({ id: ev.id, session_id: ev.sessionId, campaign_id: "c1", name: "game_completed", duration_ms: 58000 });
    // kişisel alan yok
    expect(Object.keys(row).sort()).toEqual(["campaign_id", "duration_ms", "id", "name", "occurred_at", "phase", "play_id", "play_index", "session_id"]);
  });

  it("okuma: satırları uygulama tipine çevirir ve KPI hesaplanır", async () => {
    const { f, calls } = fakePostgrest({
      events: [
        { id: ev.id, session_id: ev.sessionId, campaign_id: "c1", name: "game_started", occurred_at: ev.occurredAt, play_id: null, play_index: 1, duration_ms: null, phase: null },
        { id: "33333333-3333-4333-8333-333333333333", session_id: ev.sessionId, campaign_id: "c1", name: "game_completed", occurred_at: ev.occurredAt, play_id: null, play_index: 1, duration_ms: 58000, phase: null },
      ],
      sessions: [{ id: ev.sessionId, campaign_id: "c1", first_seen_at: ev.occurredAt, device_class: "mobile" }],
    });
    const store = new SupabaseStore("https://x.supabase.co", "sb_secret_dummy_key_value", { fetch: f });
    const data = await store.loadCampaign("c1");
    expect(data.events).toHaveLength(2);
    expect(data.sessions[0]).toMatchObject({ id: ev.sessionId, deviceClass: "mobile" });
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls[0]!.query).toContain("campaign_id=eq.c1");
    const k = computeKpis(data.events, data.sessions, "Europe/Istanbul");
    expect(k.starters).toBe(1);
    expect(k.completers).toBe(1);
    expect(k.avgDurationMs).toBe(58000);
  });

  it("sayfalama: 1000'den fazla satırı birden çok istekle eksiksiz okur", async () => {
    const many = Array.from({ length: 2300 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      session_id: ev.sessionId,
      campaign_id: "c1",
      name: "landing_view",
      occurred_at: ev.occurredAt,
      play_id: null,
      play_index: null,
      duration_ms: null,
      phase: null,
    }));
    const { f, calls } = fakePostgrest({ events: many });
    const store = new SupabaseStore("https://x.supabase.co", "sb_secret_dummy_key_value", { fetch: f });
    const data = await store.loadCampaign("c1");
    expect(data.events).toHaveLength(2300);
    expect(calls.filter((c) => c.path.endsWith("/events"))).toHaveLength(3); // 1000 + 1000 + 300
  });

  it("geçersiz anahtar (401): hata fırlatır ve mesajı okunur", async () => {
    const { f } = fakePostgrest({ status: 401, errorBody: { message: "Invalid API key" } });
    const store = new SupabaseStore("https://x.supabase.co", "yanlis", { fetch: f });
    await expect(store.loadCampaign("c1")).rejects.toThrow(/Invalid API key/);
  });
});

describe("describeStoreError", () => {
  it("URL ve anahtar benzeri dizileri maskeler", () => {
    const msg = describeStoreError(new Error("fetch failed https://abc.supabase.co/rest/v1/events key sb_secret_AbCdEfGh12345678 eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc"));
    expect(msg).not.toMatch(/supabase\.co|sb_secret_AbCd|eyJhbGci/);
    expect(msg).toContain("fetch failed");
  });
  it("uzun rastgele dizileri gizler ve uzunluğu sınırlar", () => {
    const msg = describeStoreError(new Error("x".repeat(300) + " " + "A1".repeat(40)));
    expect(msg.length).toBeLessThanOrEqual(240);
    expect(msg).not.toMatch(/A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1/);
  });
  it("Error olmayan değeri de metne çevirir", () => {
    expect(describeStoreError("düz metin")).toBe("düz metin");
  });
});
