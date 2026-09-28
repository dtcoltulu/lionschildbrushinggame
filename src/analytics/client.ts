import type { ClientEvent, DeviceClass, EventBatch, EventName } from "@/types/analytics";
import { uuid } from "./ids";

/**
 * Anonim, çevrimdışı-dayanıklı analytics istemcisi.
 * - Kimlik: yalnızca rastgele UUID (bu uygulamaya özel). Kişisel veri yok.
 * - Olaylar önce kalıcı kuyruğa yazılır; ağ yoksa bekler, gelince gönderilir.
 * - Gönderim hatası oyunu asla etkilemez.
 */

export interface KeyValueStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface AnalyticsDeps {
  storage: KeyValueStorage;
  fetch: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;
  now: () => number;
  endpoint?: string;
  deviceClass?: DeviceClass;
  batchSize?: number;
  maxQueue?: number;
  /** Test için: zamanlayıcıyı devre dışı bırakır. */
  autoSchedule?: boolean;
}

const SID_KEY = "lions.sid";
const QUEUE_KEY = "lions.q";
const PLAYED_PREFIX = "lions.played.";

export interface Analytics {
  readonly sessionId: string;
  track(name: EventName, extra?: Partial<Pick<ClientEvent, "playId" | "playIndex" | "durationMs" | "phase">>): void;
  flush(): Promise<void>;
  pending(): number;
  /** Bu kampanyada başlatılmış oyun sayısını verir (tekrar oynama ayrımı için). */
  playsStarted(): number;
  /** Yeni bir oyun denemesi başlatır: ilk oyun mu tekrar mı olduğunu belirler. */
  beginPlay(): { playId: string; playIndex: number; isReplay: boolean };
  dispose(): void;
}

export function createAnalytics(campaignId: string, deps: AnalyticsDeps): Analytics {
  const { storage } = deps;
  const endpoint = deps.endpoint ?? "/api/events";
  const batchSize = deps.batchSize ?? 20;
  const maxQueue = deps.maxQueue ?? 200;
  const auto = deps.autoSchedule ?? true;

  const safeGet = (k: string): string | null => {
    try {
      return storage.getItem(k);
    } catch {
      return null;
    }
  };
  const safeSet = (k: string, v: string): void => {
    try {
      storage.setItem(k, v);
    } catch {
      /* depolama kapalı: bellek içi devam */
    }
  };

  let sessionId = safeGet(SID_KEY);
  if (!sessionId || sessionId.length !== 36) {
    sessionId = uuid();
    safeSet(SID_KEY, sessionId);
  }

  let queue: ClientEvent[] = [];
  try {
    const raw = safeGet(QUEUE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) queue = parsed as ClientEvent[];
    }
  } catch {
    queue = [];
  }

  // Oturum sayacı bellekte de tutulur (depolama yoksa da doğru çalışsın).
  let memPlayed = Number(safeGet(PLAYED_PREFIX + campaignId) ?? 0) || 0;

  let inFlight = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const persist = () => {
    if (queue.length > maxQueue) queue = queue.slice(queue.length - maxQueue);
    safeSet(QUEUE_KEY, JSON.stringify(queue));
  };

  const schedule = (delay: number) => {
    if (!auto || disposed || timer || !queue.length) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
  };

  async function flush(): Promise<void> {
    if (inFlight || disposed || !queue.length) return;
    inFlight = true;
    const chunk = queue.slice(0, batchSize);
    const batch: EventBatch = {
      sessionId: sessionId!,
      campaignId,
      deviceClass: deps.deviceClass,
      sentAt: deps.now(),
      events: chunk,
    };
    try {
      const res = await deps.fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
        keepalive: true,
      });
      // 2xx: kaydedildi. 4xx (429 hariç): kalıcı hata, tekrar denemenin anlamı yok → at.
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408)) {
        const sent = new Set(chunk.map((e) => e.id));
        queue = queue.filter((e) => !sent.has(e.id));
        persist();
        failures = 0;
      } else {
        throw new Error(`status ${res.status}`);
      }
    } catch {
      failures += 1;
    } finally {
      inFlight = false;
    }
    if (queue.length) schedule(failures ? Math.min(60000, 2000 * 2 ** (failures - 1)) : 300);
  }

  const onOnline = () => {
    failures = 0;
    void flush();
  };
  const onHidden = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") void flush();
  };
  if (auto && typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onHidden);
  }
  // Önceki oturumdan kalan olaylar varsa gönder.
  if (queue.length) schedule(1500);

  return {
    sessionId,
    track(name, extra = {}) {
      queue.push({ id: uuid(), name, ts: deps.now(), ...extra });
      persist();
      schedule(name === "game_completed" || name === "reward_screen_viewed" ? 200 : 1500);
    },
    flush,
    pending: () => queue.length,
    playsStarted: () => memPlayed,
    beginPlay() {
      memPlayed += 1;
      safeSet(PLAYED_PREFIX + campaignId, String(memPlayed));
      return { playId: uuid(), playIndex: memPlayed, isReplay: memPlayed > 1 };
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (auto && typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        document.removeEventListener("visibilitychange", onHidden);
        window.removeEventListener("pagehide", onHidden);
      }
    },
  };
}

export function detectDeviceClass(): DeviceClass {
  if (typeof window === "undefined") return "desktop";
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  if (!coarse) return "desktop";
  return Math.min(window.screen.width, window.screen.height) >= 600 ? "tablet" : "mobile";
}
