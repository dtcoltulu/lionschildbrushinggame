import { describe, expect, it } from "vitest";
import { computeKpis, hourlyForDate, formatDuration, formatPercent, localParts } from "@/lib/kpi";
import { reportCsv, reportLines, eventsCsv, toCsv } from "@/lib/csv";
import { CAMPAIGNS } from "@/config/campaigns";
import type { EventName, StoredEvent } from "@/types/analytics";

const TZ = "Europe/Istanbul";
let n = 0;
const ev = (sessionId: string, name: EventName, iso: string, extra: Partial<StoredEvent> = {}): StoredEvent => ({
  id: `e${n++}`,
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

// 11 Ekim 2026 İstanbul = UTC+3
const events: StoredEvent[] = [
  // A: geldi, oynadı, bitirdi (58 sn), tekrar oynadı ve bitirdi (40 sn)
  ev("A", "landing_view", "2026-10-11T08:05:00Z"), // 11:05
  ev("A", "game_started", "2026-10-11T08:06:00Z", { playIndex: 1 }),
  ev("A", "game_completed", "2026-10-11T08:07:00Z", { playIndex: 1, durationMs: 58000 }),
  ev("A", "reward_screen_viewed", "2026-10-11T08:07:01Z"),
  ev("A", "replay_started", "2026-10-11T08:08:00Z", { playIndex: 2 }),
  ev("A", "game_completed", "2026-10-11T08:09:00Z", { playIndex: 2, durationMs: 40000 }),
  // B: geldi, başlattı, bırakti
  ev("B", "landing_view", "2026-10-11T09:10:00Z"), // 12:10
  ev("B", "game_started", "2026-10-11T09:11:00Z", { playIndex: 1 }),
  // C: sadece landing (2 kez)
  ev("C", "landing_view", "2026-10-11T09:20:00Z"),
  ev("C", "landing_view", "2026-10-11T09:25:00Z"),
  // D: başlattı, 70 sn ile bitirdi
  ev("D", "landing_view", "2026-10-11T09:30:00Z"),
  ev("D", "game_started", "2026-10-11T09:31:00Z", { playIndex: 1 }),
  ev("D", "game_completed", "2026-10-11T09:32:00Z", { playIndex: 1, durationMs: 70000 }),
  ev("D", "phase_completed", "2026-10-11T09:31:20Z", { phase: 1, durationMs: 15000 }),
  ev("D", "phase_completed", "2026-10-11T09:31:40Z", { phase: 1, durationMs: 25000 }),
];
const sessions = [
  { id: "A", campaignId: "c", firstSeenAt: "", deviceClass: "mobile" as const },
  { id: "B", campaignId: "c", firstSeenAt: "", deviceClass: "tablet" as const },
  { id: "C", campaignId: "c", firstSeenAt: "", deviceClass: null },
];

describe("computeKpis", () => {
  const k = computeKpis(events, sessions, TZ);

  it("ziyaret / başlama / tamamlama ayrımı", () => {
    expect(k.landingViews).toBe(5);
    expect(k.landingVisitors).toBe(4); // A B C D
    expect(k.starters).toBe(3); // A B D
    expect(k.completers).toBe(2); // A D
    expect(k.totalCompletions).toBe(3);
  });

  it("tamamlama oranı = tamamlayan / başlayan", () => {
    expect(k.completionRate).toBeCloseTo(2 / 3);
  });

  it("tekrar oynama ayrı sayılır ve yeni oyuncu sayılmaz", () => {
    expect(k.replays).toBe(1);
    expect(k.starters).toBe(3);
  });

  it("ortalama süre yalnızca ilk oyunlardan hesaplanır", () => {
    expect(k.avgDurationMs).toBe(64000); // (58000+70000)/2
    expect(k.medianDurationMs).toBe(64000);
    expect(k.durationSamples).toBe(2);
  });

  it("saatlik dağılım İstanbul saatine göre", () => {
    const h = hourlyForDate(k.hourly, "2026-10-11");
    expect(h[11]!.plays).toBe(2); // A ilk + A tekrar
    expect(h[11]!.landing).toBe(1);
    expect(h[12]!.plays).toBe(2); // B + D
    expect(h[12]!.landing).toBe(4); // B, C, C, D
    expect(h[12]!.completions).toBe(1);
    expect(h[0]!.plays).toBe(0);
  });

  it("gün ayrımı ve tüm günler toplamı", () => {
    expect(k.dates).toEqual(["2026-10-11"]);
    const all = hourlyForDate(k.hourly, null);
    expect(all.reduce((s, r) => s + r.plays, 0)).toBe(4);
  });

  it("aşama ortalaması ve cihaz sınıfı", () => {
    expect(k.phases).toEqual([{ phase: 1, count: 2, avgMs: 20000 }]);
    expect(k.devices).toEqual({ mobile: 1, tablet: 1, desktop: 0, unknown: 1 });
  });

  it("boş veri: bölme hatası yok", () => {
    const e = computeKpis([], [], TZ);
    expect(e.completionRate).toBeNull();
    expect(e.avgDurationMs).toBeNull();
    expect(formatPercent(e.completionRate)).toBe("—");
  });

  it("aykırı süreyi (>15 dk) ortalamaya katmaz", () => {
    const x = computeKpis(
      [ev("Z", "game_started", "2026-10-11T08:00:00Z", { playIndex: 1 }), ev("Z", "game_completed", "2026-10-11T08:30:00Z", { playIndex: 1, durationMs: 3_600_000 })],
      [],
      TZ,
    );
    expect(x.avgDurationMs).toBeNull();
  });
});

describe("yardımcılar", () => {
  it("gece yarısı sınırı (00:xx) doğru", () => {
    expect(localParts("2026-10-10T21:30:00Z", TZ)).toEqual({ date: "2026-10-11", hour: 0 });
  });
  it("biçimlendirme", () => {
    expect(formatDuration(58000)).toBe("58 sn");
    expect(formatDuration(125000)).toBe("2 dk 5 sn");
    expect(formatPercent(0.866)).toBe("%86,6");
  });
});

describe("CSV", () => {
  it("BOM, noktalı virgül ve Türkçe karakterleri içerir", () => {
    const csv = reportCsv(CAMPAIGNS[0]!, computeKpis(events, sessions, TZ), new Date("2026-10-11T18:00:00Z"));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Ağız ve Diş Sağlığı Komitesi");
    expect(csv).toContain("Tamamlama oranı;%66,7");
    expect(csv).toContain("11:00–12:00");
  });
  it("formül enjeksiyonunu etkisizleştirir ve tırnakları kaçırır", () => {
    expect(toCsv([["=1+1", 'a"b', "x;y"]])).toContain(`'=1+1;"a""b";"x;y"`);
  });
  it("ham olay CSV'sinde kişisel alan yok", () => {
    const csv = eventsCsv(events);
    expect(csv.split("\r\n")[0]).toBe("﻿zaman_utc;olay;oturum_kodu_kisa;oyun_no;sure_ms;asama");
  });
});

describe("kendini değerlendirme (Evet / Hayır) göstergeleri", () => {
  const phase = (n: number) => ({ phase: n });
  const checks: StoredEvent[] = [
    // A: aşama 1'de Evet dedi (erken bıraktı), aşama 2'de Hayır
    ev("A", "self_check_yes", "2026-10-11T08:06:10Z", phase(1)),
    ev("A", "self_check_no", "2026-10-11T08:06:40Z", phase(2)),
    // B: iki aşamada da Hayır
    ev("B", "self_check_no", "2026-10-11T09:11:10Z", phase(1)),
    ev("B", "self_check_no", "2026-10-11T09:11:40Z", phase(2)),
    // C: aşama 1'de Evet
    ev("C", "self_check_yes", "2026-10-11T09:20:10Z", phase(1)),
    // D: aşama 1'de Hayır
    ev("D", "self_check_no", "2026-10-11T09:31:10Z", phase(1)),
  ];
  const k = computeKpis([...events, ...checks], sessions, TZ);

  it("Evet / Hayır sayısı ve oranı (cevap bazlı)", () => {
    expect(k.selfCheck.yes).toBe(2);
    expect(k.selfCheck.no).toBe(4);
    expect(k.selfCheck.total).toBe(6);
    expect(k.selfCheck.yesRate).toBeCloseTo(2 / 6);
    expect(k.selfCheck.noRate).toBeCloseTo(4 / 6);
    expect((k.selfCheck.yesRate ?? 0) + (k.selfCheck.noRate ?? 0)).toBeCloseTo(1);
  });

  it("çocuk (tarayıcı) bazlı: cevaplayan ve en az bir kez Evet diyen", () => {
    expect(k.selfCheck.children).toBe(4); // A B C D
    expect(k.selfCheck.childrenYes).toBe(2); // A ve C
  });

  it("aşama bazlı döküm, aşama sırasıyla", () => {
    expect(k.selfCheck.byPhase).toEqual([
      { phase: 1, yes: 2, no: 2, total: 4, yesRate: 0.5 },
      { phase: 2, yes: 0, no: 2, total: 2, yesRate: 0 },
    ]);
  });

  it("diğer göstergeleri (ziyaret, başlama, saatlik) etkilemez", () => {
    const base = computeKpis(events, sessions, TZ);
    expect(k.landingViews).toBe(base.landingViews);
    expect(k.starters).toBe(base.starters);
    expect(k.completers).toBe(base.completers);
    expect(k.hourly).toEqual(base.hourly);
    expect(k.avgDurationMs).toBe(base.avgDurationMs);
  });

  it("cevap yokken sıfırlar ve null oran (bölme hatası yok)", () => {
    const e = computeKpis(events, sessions, TZ).selfCheck;
    expect(e).toEqual({ yes: 0, no: 0, total: 0, yesRate: null, noRate: null, children: 0, childrenYes: 0, byPhase: [] });
  });

  it("rapor satırları ve CSV yalnızca cevap varsa soruyu içerir", () => {
    const withData = reportLines(k).map((l) => l.label);
    expect(withData.some((l) => l.includes("Yeterli temizlendi mi"))).toBe(true);
    const yesLine = reportLines(k).find((l) => l.label.startsWith("“Evet”"))!;
    expect(yesLine.value).toBe("2");
    expect(yesLine.note).toBe("%33,3");
    const none = computeKpis(events, sessions, TZ);
    expect(reportLines(none).some((l) => l.label.includes("Yeterli temizlendi mi"))).toBe(false);

    const c = CAMPAIGNS[0]!;
    const csv = reportCsv(c, k, new Date("2026-10-11T12:00:00Z"));
    expect(csv).toContain("KENDİNİ DEĞERLENDİRME");
    expect(csv).toContain("Aşama 1;Dış yüzeyler;2;2;4;%50,0");
    expect(csv).toContain("Aşama 2;Diş araları;0;2;2;%0,0");
    expect(reportCsv(c, none, new Date("2026-10-11T12:00:00Z"))).not.toContain("KENDİNİ DEĞERLENDİRME");
  });
});
