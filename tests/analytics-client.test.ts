import { describe, expect, it } from "vitest";
import { createAnalytics, type KeyValueStorage } from "@/analytics/client";

function memStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function setup(fetchImpl: (body: { events: { id: string }[] }) => { ok: boolean; status: number } | Promise<never>) {
  const storage = memStorage();
  const sent: { events: { id: string; name: string }[] }[] = [];
  const a = createAnalytics("c1", {
    storage,
    now: () => 1000,
    autoSchedule: false,
    fetch: async (_u, init) => {
      const body = JSON.parse(String(init.body));
      const r = await fetchImpl(body);
      if (r.ok) sent.push(body);
      return r;
    },
  });
  return { storage, sent, a };
}

describe("analytics istemcisi", () => {
  it("oturum kodu kalıcıdır ve rastgele UUID'dir", () => {
    const s = memStorage();
    const mk = () => createAnalytics("c1", { storage: s, now: () => 1, autoSchedule: false, fetch: async () => ({ ok: true, status: 200 }) });
    const a = mk();
    const b = mk();
    expect(a.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.sessionId).toBe(a.sessionId);
  });

  it("ağ yokken olaylar kuyrukta kalır, ağ gelince gönderilir", async () => {
    let online = false;
    const { a, sent, storage } = setup(() => (online ? { ok: true, status: 200 } : Promise.reject(new Error("offline"))));
    a.track("landing_view");
    a.track("game_started", { playIndex: 1 });
    await a.flush();
    expect(a.pending()).toBe(2);
    expect(JSON.parse(storage.data.get("lions.q")!)).toHaveLength(2);
    online = true;
    await a.flush();
    expect(a.pending()).toBe(0);
    expect(sent[0]!.events.map((e) => e.name)).toEqual(["landing_view", "game_started"]);
  });

  it("sayfa yenilense bile kuyruk korunur", async () => {
    const storage = memStorage();
    const fail = async () => Promise.reject(new Error("x")) as never;
    const a1 = createAnalytics("c1", { storage, now: () => 1, autoSchedule: false, fetch: fail });
    a1.track("landing_view");
    await a1.flush();
    const a2 = createAnalytics("c1", { storage, now: () => 1, autoSchedule: false, fetch: async () => ({ ok: true, status: 200 }) });
    expect(a2.pending()).toBe(1);
    await a2.flush();
    expect(a2.pending()).toBe(0);
  });

  it("sunucu 503 verirse tutar, 400 verirse zehirli olayı atar", async () => {
    let status = 503;
    const { a } = setup(() => ({ ok: status < 300, status }));
    a.track("landing_view");
    await a.flush();
    expect(a.pending()).toBe(1);
    status = 400;
    await a.flush();
    expect(a.pending()).toBe(0);
  });

  it("20'lik gruplar halinde gönderir", async () => {
    const { a, sent } = setup(() => ({ ok: true, status: 200 }));
    for (let i = 0; i < 45; i++) a.track("landing_view");
    await a.flush();
    await a.flush();
    await a.flush();
    expect(sent.map((b) => b.events.length)).toEqual([20, 20, 5]);
  });

  it("kuyruk sınırını aşınca en eskileri atar", () => {
    const storage = memStorage();
    const a = createAnalytics("c1", { storage, now: () => 1, autoSchedule: false, maxQueue: 10, fetch: async () => ({ ok: false, status: 503 }) });
    for (let i = 0; i < 25; i++) a.track("landing_view");
    expect(JSON.parse(storage.data.get("lions.q")!)).toHaveLength(10);
  });

  it("ilk oyun / tekrar oyun ayrımı kalıcıdır", () => {
    const storage = memStorage();
    const mk = () => createAnalytics("c1", { storage, now: () => 1, autoSchedule: false, fetch: async () => ({ ok: true, status: 200 }) });
    const first = mk().beginPlay();
    expect(first).toMatchObject({ playIndex: 1, isReplay: false });
    const second = mk().beginPlay();
    expect(second).toMatchObject({ playIndex: 2, isReplay: true });
    expect(second.playId).not.toBe(first.playId);
  });

  it("depolama kapalıysa (private mode) bile çalışır", async () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    const a = createAnalytics("c1", { storage: broken, now: () => 1, autoSchedule: false, fetch: async () => ({ ok: true, status: 200 }) });
    a.track("landing_view");
    expect(a.beginPlay().playIndex).toBe(1);
    expect(a.beginPlay().playIndex).toBe(2);
    await a.flush();
    expect(a.pending()).toBe(0);
  });
});
