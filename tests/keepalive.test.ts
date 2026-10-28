import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/store";

const ROOT = path.resolve(import.meta.dirname, "..");

/** `getStore`'u sahte depoyla değiştirip rotayı her testte yeniden yükler (rotanın kısıtlama durumu modül içindedir). */
async function loadRoute(store: { ping: () => Promise<void> } | null) {
  vi.resetModules();
  vi.doMock("@/lib/get-store", () => ({ getStore: () => (store ? { kind: "memory", ...store } : null) }));
  return await import("@/app/api/keepalive/route");
}

describe("GET /api/keepalive (Supabase ücretsiz plan duraklatmasına karşı günlük istek)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/get-store");
  });

  it("depoya küçük bir okuma isteği atar ve yalnızca { ok: true } döner (önbelleğe alınmaz)", async () => {
    const ping = vi.fn(async () => {});
    const { GET } = await loadRoute({ ping });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("depo yapılandırılmamışsa 503 (cron başarısız görünür; sessizce geçmez)", async () => {
    const { GET } = await loadRoute(null);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "store_unavailable" });
  });

  it("depo hata verirse 503 döner; hata ayrıntısı (adres/anahtar) yanıta sızmaz, loga yalnızca maskelenmiş özet gider", async () => {
    const ping = vi.fn(async () => {
      throw new Error("ping: fetch failed https://abc.supabase.co/rest/v1/sessions key sb_secret_AbCdEfGh12345678");
    });
    const { GET } = await loadRoute({ ping });
    const res = await GET();
    expect(res.status).toBe(503);
    const body = JSON.stringify(await res.json());
    expect(body).toBe('{"error":"store_error"}');
    const logged = String(vi.mocked(console.error).mock.calls[0]!.join(" "));
    expect(logged).toContain("keepalive failed");
    expect(logged).not.toMatch(/supabase\.co|sb_secret_AbCd/);
  });

  it("başarılı kontrolden sonra bir dakika içinde gelen istekler depoya gitmez; süre dolunca yeniden kontrol edilir", async () => {
    const ping = vi.fn(async () => {});
    const { GET } = await loadRoute({ ping });
    await GET();
    for (let i = 0; i < 20; i++) expect((await GET()).status).toBe(200); // adresi art arda çağıran veritabanını yormaz
    expect(ping).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    await GET();
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("başarısız deneme kısıtlama başlatmaz: veritabanı geri gelince hemen yeniden denenir", async () => {
    let down = true;
    const ping = vi.fn(async () => {
      if (down) throw new Error("ping: down");
    });
    const { GET } = await loadRoute({ ping });
    expect((await GET()).status).toBe(503);
    expect((await GET()).status).toBe(503);
    down = false;
    expect((await GET()).status).toBe(200);
    expect(ping).toHaveBeenCalledTimes(3);
  });

  it("bellek içi depo da ping'e hata vermeden yanıt verir (yerel geliştirme ve uçtan uca test)", async () => {
    await expect(new MemoryStore().ping()).resolves.toBeUndefined();
  });
});

describe("vercel.json: günlük keep-alive zamanlaması", () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as { crons?: { path: string; schedule: string }[]; regions?: string[] };

  it("keep-alive adresi günde bir kez çağrılır (Vercel Hobby planı daha sık zamanlamayı reddeder ve yayını bozar)", () => {
    const crons = cfg.crons ?? [];
    expect(crons.map((c) => c.path)).toEqual(["/api/keepalive"]);
    // dakika saat * * *  → günde tam bir çalışma
    expect(crons[0]!.schedule).toMatch(/^([0-5]?\d) ([01]?\d|2[0-3]) \* \* \*$/);
  });

  it("zamanlanan adres gerçekten var ve yönetici koruması (proxy) cron'u engellemez", () => {
    expect(fs.existsSync(path.join(ROOT, "src/app/api/keepalive/route.ts"))).toBe(true);
    const proxy = fs.readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
    const matcher = /matcher:\s*\[([^\]]*)\]/.exec(proxy)?.[1] ?? "";
    expect(matcher).not.toMatch(/keepalive|\/api\/:path\*|\/api"/);
  });

  it("bölge ayarı korunur (fra1)", () => {
    expect(cfg.regions).toEqual(["fra1"]);
  });
});
