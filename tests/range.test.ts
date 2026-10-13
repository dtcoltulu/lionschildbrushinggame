import { describe, expect, it } from "vitest";
import { CAMPAIGNS } from "@/config/campaigns";
import { reportCsv } from "@/lib/csv";
import { computeKpis } from "@/lib/kpi";
import { filterByRange, hasRange, isValidDay, NO_RANGE, parseRange, rangeLabel, rangeParams } from "@/lib/range";
import type { CampaignData } from "@/lib/store";
import type { EventName, StoredEvent, StoredSession } from "@/types/analytics";

const TZ = "Europe/Istanbul"; // UTC+3 (Ekim 2026)
let n = 0;
const ev = (sessionId: string, name: EventName, iso: string, extra: Partial<StoredEvent> = {}): StoredEvent => ({
  id: `r${n++}`,
  sessionId,
  campaignId: "c",
  name,
  occurredAt: iso,
  playId: null,
  playIndex: null,
  durationMs: null,
  phase: null,
  ...extra,
});
const sess = (id: string, deviceClass: StoredSession["deviceClass"] = "mobile"): StoredSession => ({ id, campaignId: "c", firstSeenAt: "", deviceClass });

describe("tarih aralığı: ayrıştırma", () => {
  it("geçerli takvim günlerini kabul eder, geçersizleri (biçim ya da takvim) yok sayar", () => {
    expect(isValidDay("2026-10-11")).toBe(true);
    expect(isValidDay("2028-02-29")).toBe(true); // artık yıl
    for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "26-10-11", "2026-1-1", "2026/10/11", "", "abc", "2026-10-11T00:00", "2026-10-32"]) {
      expect(isValidDay(bad), bad).toBe(false);
    }
    expect(parseRange("2026-02-30", "abc")).toEqual(NO_RANGE);
    expect(parseRange("2026-10-11", "bozuk")).toEqual({ from: "2026-10-11", to: null });
    expect(parseRange(undefined, null)).toEqual(NO_RANGE);
  });

  it("uçlar ters verilirse yer değiştirir; dizi değerde ilk eleman alınır", () => {
    expect(parseRange("2026-10-13", "2026-10-11")).toEqual({ from: "2026-10-11", to: "2026-10-13" });
    expect(parseRange(["2026-10-11", "2026-10-20"], ["2026-10-12"])).toEqual({ from: "2026-10-11", to: "2026-10-12" });
  });

  it("adres parçaları yalnızca dolu uçları içerir; etiket okunur", () => {
    expect(hasRange(NO_RANGE)).toBe(false);
    expect(hasRange({ from: "2026-10-11", to: null })).toBe(true);
    expect(rangeParams(NO_RANGE)).toEqual({});
    expect(rangeParams({ from: "2026-10-11", to: null })).toEqual({ from: "2026-10-11" });
    expect(rangeParams({ from: "2026-10-11", to: "2026-10-13" })).toEqual({ from: "2026-10-11", to: "2026-10-13" });
    expect(rangeLabel(NO_RANGE)).toBe("Tüm dönem");
    expect(rangeLabel({ from: "2026-10-11", to: "2026-10-13" })).toBe("11.10.2026 – 13.10.2026");
    expect(rangeLabel({ from: "2026-10-11", to: "2026-10-11" })).toBe("11.10.2026");
    expect(rangeLabel({ from: "2026-10-11", to: null })).toBe("11.10.2026 ve sonrası");
    expect(rangeLabel({ from: null, to: "2026-10-13" })).toBe("13.10.2026 ve öncesi");
  });
});

describe("tarih aralığı: süzme (kampanya saat diliminde yerel gün, uçlar dahil)", () => {
  const data: CampaignData = {
    events: [
      // 10 Ekim 23:59:59 (yerel) = 20:59:59Z → 10 Ekim
      ev("A", "landing_view", "2026-10-10T20:59:59Z"),
      // 11 Ekim 00:00:00 (yerel) = 21:00:00Z (10 Ekim UTC'de) → 11 Ekim: gün sınırı UTC'ye değil kampanya saatine göre
      ev("B", "landing_view", "2026-10-10T21:00:00Z"),
      ev("B", "game_started", "2026-10-11T08:00:00Z", { playIndex: 1 }),
      // 11 Ekim 23:59:59 (yerel) = 20:59:59Z
      ev("C", "landing_view", "2026-10-11T20:59:59Z"),
      // 12 Ekim 00:30 (yerel) = 21:30Z (11 Ekim UTC'de)
      ev("D", "landing_view", "2026-10-11T21:30:00Z"),
    ],
    sessions: [sess("A", "mobile"), sess("B", "tablet"), sess("C", "desktop"), sess("D", null)],
  };
  const ids = (d: CampaignData) => d.events.map((e) => e.sessionId + ":" + e.name);

  it("aralık yoksa veri olduğu gibi döner", () => {
    expect(filterByRange(data, NO_RANGE, TZ)).toBe(data);
  });

  it("gün sınırları kampanya saat dilimine göredir ve uçlar dahildir", () => {
    const oct11 = filterByRange(data, { from: "2026-10-11", to: "2026-10-11" }, TZ);
    expect(ids(oct11)).toEqual(["B:landing_view", "B:game_started", "C:landing_view"]);
    expect(ids(filterByRange(data, { from: "2026-10-12", to: null }, TZ))).toEqual(["D:landing_view"]);
    expect(ids(filterByRange(data, { from: null, to: "2026-10-10" }, TZ))).toEqual(["A:landing_view"]);
    expect(ids(filterByRange(data, { from: "2026-10-10", to: "2026-10-12" }, TZ))).toHaveLength(5);
    expect(ids(filterByRange(data, { from: "2026-10-13", to: "2026-10-20" }, TZ))).toEqual([]);
  });

  it("oturumlar yalnızca aralıkta olayı olanlarla kalır (cihaz sayıları tutarlı); asıl veri değişmez", () => {
    const oct11 = filterByRange(data, { from: "2026-10-11", to: "2026-10-11" }, TZ);
    expect(oct11.sessions.map((s) => s.id)).toEqual(["B", "C"]);
    expect(computeKpis(oct11.events, oct11.sessions, TZ).devices).toEqual({ mobile: 0, tablet: 1, desktop: 1, unknown: 0 });
    expect(data.events).toHaveLength(5); // veri silinmez / değiştirilmez
    expect(data.sessions).toHaveLength(4);
  });

  it("süzülmüş veriden hesaplanan göstergeler yalnızca aralığı sayar", () => {
    const all = computeKpis(data.events, data.sessions, TZ);
    const oct11 = filterByRange(data, { from: "2026-10-11", to: "2026-10-11" }, TZ);
    const k = computeKpis(oct11.events, oct11.sessions, TZ);
    expect(all.landingVisitors).toBe(4);
    expect(k.landingVisitors).toBe(2); // B ve C
    expect(k.starters).toBe(1); // B
    expect(k.startRate).toBe(0.5);
  });

  it("çözümlenemeyen zaman damgası hata vermez, süzülmüş görünümde yer almaz", () => {
    const bad: CampaignData = { events: [ev("X", "landing_view", "bozuk-tarih"), ev("Y", "landing_view", "2026-10-11T10:00:00Z")], sessions: [sess("X"), sess("Y")] };
    const out = filterByRange(bad, { from: "2026-10-11", to: null }, TZ);
    expect(ids(out)).toEqual(["Y:landing_view"]);
    expect(out.sessions.map((s) => s.id)).toEqual(["Y"]);
  });
});

describe("tarih aralığı: CSV raporu", () => {
  it("aralık varsa rapor dönemi satırı eklenir; yoksa eklenmez", () => {
    const c = CAMPAIGNS[0]!;
    const k = computeKpis([], [], TZ);
    const at = new Date("2026-10-13T12:00:00Z");
    expect(reportCsv(c, k, at)).not.toContain("Rapor dönemi");
    expect(reportCsv(c, k, at, NO_RANGE)).not.toContain("Rapor dönemi");
    expect(reportCsv(c, k, at, { from: "2026-10-11", to: "2026-10-13" })).toContain("Rapor dönemi;11.10.2026 – 13.10.2026");
  });
});
