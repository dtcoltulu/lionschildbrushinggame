import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DeviceClass, EventName, StoredEvent, StoredSession } from "@/types/analytics";
import type { CampaignData, EventStore } from "./store";

const PAGE = 1000;

interface EventRow {
  id: string;
  session_id: string;
  campaign_id: string;
  name: EventName;
  occurred_at: string;
  play_id: string | null;
  play_index: number | null;
  duration_ms: number | null;
  phase: number | null;
}

interface SessionRow {
  id: string;
  campaign_id: string;
  first_seen_at: string;
  device_class: DeviceClass | null;
}

/** Yalnızca sunucuda, service-role anahtarıyla kullanılır. RLS anon erişimi tamamen kapatır. */
export class SupabaseStore implements EventStore {
  readonly kind = "supabase" as const;
  private db: SupabaseClient;

  constructor(url: string, serviceKey: string, options: { fetch?: typeof fetch } = {}) {
    this.db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
    });
  }

  async insertBatch(input: Parameters<EventStore["insertBatch"]>[0]): Promise<void> {
    const s = await this.db.from("sessions").upsert(
      {
        id: input.sessionId,
        campaign_id: input.campaignId,
        first_seen_at: input.firstSeenAt,
        device_class: input.deviceClass,
      },
      { onConflict: "id,campaign_id", ignoreDuplicates: true },
    );
    if (s.error) throw new Error(`sessions: ${s.error.message}`);

    const rows = input.events.map((e) => ({
      id: e.id,
      session_id: e.sessionId,
      campaign_id: e.campaignId,
      name: e.name,
      occurred_at: e.occurredAt,
      play_id: e.playId,
      play_index: e.playIndex,
      duration_ms: e.durationMs,
      phase: e.phase,
    }));
    if (!rows.length) return;
    const r = await this.db.from("events").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (r.error) throw new Error(`events: ${r.error.message}`);
  }

  async loadCampaign(campaignId: string): Promise<CampaignData> {
    const events: StoredEvent[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db
        .from("events")
        .select("id,session_id,campaign_id,name,occurred_at,play_id,play_index,duration_ms,phase")
        .eq("campaign_id", campaignId)
        .order("occurred_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1)
        .returns<EventRow[]>();
      if (error) throw new Error(`events: ${error.message}`);
      for (const r of data) {
        events.push({
          id: r.id,
          sessionId: r.session_id,
          campaignId: r.campaign_id,
          name: r.name,
          occurredAt: r.occurred_at,
          playId: r.play_id,
          playIndex: r.play_index,
          durationMs: r.duration_ms,
          phase: r.phase,
        });
      }
      if (data.length < PAGE) break;
    }

    const sessions: StoredSession[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db
        .from("sessions")
        .select("id,campaign_id,first_seen_at,device_class")
        .eq("campaign_id", campaignId)
        .order("first_seen_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1)
        .returns<SessionRow[]>();
      if (error) throw new Error(`sessions: ${error.message}`);
      for (const r of data) {
        sessions.push({ id: r.id, campaignId: r.campaign_id, firstSeenAt: r.first_seen_at, deviceClass: r.device_class });
      }
      if (data.length < PAGE) break;
    }
    return { events, sessions };
  }
}
