import type { StoredEvent, StoredSession } from "@/types/analytics";
import type { DeviceClass } from "@/types/analytics";

export interface CampaignData {
  events: StoredEvent[];
  sessions: StoredSession[];
}

/** Depolama arayüzü: Supabase (üretim) ve bellek içi (yerel geliştirme) uygulamaları var. */
export interface EventStore {
  readonly kind: "supabase" | "memory";
  insertBatch(input: {
    sessionId: string;
    campaignId: string;
    deviceClass: DeviceClass | null;
    firstSeenAt: string;
    events: StoredEvent[];
  }): Promise<void>;
  loadCampaign(campaignId: string): Promise<CampaignData>;
}

// ---- Bellek içi (geliştirme / test) -----------------------------------------

export class MemoryStore implements EventStore {
  readonly kind = "memory" as const;
  private events = new Map<string, StoredEvent>();
  private sessions = new Map<string, StoredSession>();

  async insertBatch(input: Parameters<EventStore["insertBatch"]>[0]): Promise<void> {
    if (!this.sessions.has(input.sessionId)) {
      this.sessions.set(input.sessionId, {
        id: input.sessionId,
        campaignId: input.campaignId,
        firstSeenAt: input.firstSeenAt,
        deviceClass: input.deviceClass,
      });
    }
    for (const e of input.events) if (!this.events.has(e.id)) this.events.set(e.id, e);
  }

  async loadCampaign(campaignId: string): Promise<CampaignData> {
    return {
      events: [...this.events.values()].filter((e) => e.campaignId === campaignId),
      sessions: [...this.sessions.values()].filter((s) => s.campaignId === campaignId),
    };
  }
}
