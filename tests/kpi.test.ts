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
    expect(e).toEqual({
      yes: 0,
      no: 0,
      total: 0,
      yesRate: null,
      noRate: null,
      children: 0,
      childrenYes: 0,
      firstYes: 0,
      firstYesRate: null,
      firstPlay: { yes: 0, no: 0, total: 0, yesRate: null },
      replayPlays: { yes: 0, no: 0, total: 0, yesRate: null },
      overheadMedianMs: null,
      overheadSamples: 0,
      byPhase: [],
    });
  });

  it("başlatma oranı: başlatan / QR landing; landing yoksa null; en çok %100", () => {
    const base = computeKpis(events, sessions, TZ);
    expect(base.startRate).toBeCloseTo(3 / 4); // 3 başlatan (A B D), 4 ziyaretçi (A B C D)
    expect(computeKpis([], [], TZ).startRate).toBeNull();
    // Landing olayı olmayan (ör. aralık dışında kalmış) başlatanlar oranı %100'ün üstüne çıkarmaz
    const noLanding = events.filter((e) => e.name !== "landing_view" || e.sessionId === "A");
    expect(computeKpis(noLanding, sessions, TZ).startRate).toBe(1);
  });

  it("rapor satırları ve CSV yeni göstergeleri (ilk cevap, ilk oyun/tekrar, soru süresi, başlatma oranı) içerir", () => {
    const lines = reportLines(k);
    const byLabel = (start: string) => lines.find((l) => l.label.startsWith(start))!;
    expect(byLabel("Oyuna başlayan").note).toBe("Başlatma oranı: %75,0 (başlayan / toplam erişim)");
    expect(byLabel("Başlangıç yanılgısı").value).toBe("%50,0"); // A ve C ilk cevabı Evet; B, D Hayır → 2/4
    expect(byLabel("Başlangıç yanılgısı").note).toContain("2 / 4 çocuk");
    expect(byLabel("İlk oyunlarda").note).toBe("6 cevap"); // playIndex'siz eski kayıtlar ilk oyun sayılır
    expect(byLabel("Tekrar oyunlarda").value).toBe("—");
    expect(byLabel("Soruların oyuna eklediği süre").value).toBe("—"); // playId'siz kayıtlar: ölçülemez
    const csv = reportCsv(CAMPAIGNS[0]!, k, new Date("2026-10-11T12:00:00Z"));
    expect(csv).toContain("Başlangıç yanılgısı: ilk cevabı “Evet” olan çocuk;%50,0;");
    expect(csv).toContain("İlk oyunlarda “Evet” oranı;%33,3;6 cevap");
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

describe("kendini değerlendirme: ilk cevap, ilk oyun / tekrar ve soruların eklediği süre", () => {
  const T = (s: string) => `2026-10-11T10:${s}Z`; // 10:MM:SS UTC
  const ans = (sid: string, yes: boolean, at: string, extra: Partial<StoredEvent> = {}) =>
    ev(sid, yes ? "self_check_yes" : "self_check_no", T(at), { phase: 1, ...extra });

  it("çocuğun İLK cevabı zaman sırasına göre bulunur (dizideki sıraya göre değil); eşit zamanda kimliğe göre", () => {
    const list: StoredEvent[] = [
      // A: önce Evet, sonra Hayır → ilk cevap Evet
      ans("A", true, "00:10"),
      ans("A", false, "00:40", { phase: 2 }),
      // B: önce Hayır, sonra Evet → ilk cevap Hayır
      ans("B", false, "00:10"),
      ans("B", true, "00:40", { phase: 2 }),
      // C: dizide Hayır önce görünür ama zamanca Evet daha erken → ilk cevap Evet
      ans("C", false, "01:30", { phase: 2 }),
      ans("C", true, "00:50"),
      // D: yalnızca Hayır
      ans("D", false, "00:20"),
    ];
    const s = computeKpis(list, [], TZ).selfCheck;
    expect(s.children).toBe(4);
    expect(s.firstYes).toBe(2); // A ve C
    expect(s.firstYesRate).toBe(0.5);
    expect(s.childrenYes).toBe(3); // A, B, C en az bir kez Evet dedi: "ilk" ile "en az bir kez" farklı şeyi ölçer

    // Zamanlar tıpatıp eşitse kimliği küçük olan ilk sayılır: sonuç dizi sırasından bağımsız ve kararlıdır
    const a = ev("E", "self_check_yes", T("02:00"), { id: "a1", phase: 1 });
    const b = ev("E", "self_check_no", T("02:00"), { id: "b1", phase: 1 });
    expect(computeKpis([a, b], [], TZ).selfCheck.firstYes).toBe(1);
    expect(computeKpis([b, a], [], TZ).selfCheck.firstYes).toBe(1);
  });

  it("ilk oyun / tekrar oyun ayrımı (playIndex ≥ 2 tekrar; yok ya da 1 ilk oyun)", () => {
    const list: StoredEvent[] = [
      ans("A", true, "00:10", { playIndex: 1 }),
      ans("A", false, "00:20", { playIndex: 1, phase: 2 }),
      ans("B", false, "00:30"), // playIndex yok: ilk oyun sayılır
      ans("A", false, "05:10", { playIndex: 2 }),
      ans("A", false, "05:20", { playIndex: 2, phase: 2 }),
      ans("A", true, "09:10", { playIndex: 3 }),
    ];
    const s = computeKpis(list, [], TZ).selfCheck;
    expect(s.firstPlay).toEqual({ yes: 1, no: 2, total: 3, yesRate: 1 / 3 });
    expect(s.replayPlays).toEqual({ yes: 1, no: 2, total: 3, yesRate: 1 / 3 });
    expect(s.firstPlay.total + s.replayPlays.total).toBe(s.total);
    expect(s.firstPlay.yes + s.replayPlays.yes).toBe(s.yes);
  });

  it("soruların eklediği süre = soru dahil gerçek süre − aktif süre; yalnızca tamamlanan ve cevaplı oyunlar; medyan", () => {
    const play = (sid: string, pid: string, startAt: string, endAt: string | null, activeMs: number, answers: boolean) => {
      const list: StoredEvent[] = [ev(sid, "game_started", T(startAt), { playId: pid, playIndex: 1 })];
      if (answers) list.push(ans(sid, false, startAt.slice(0, 3) + "20", { playId: pid, playIndex: 1 }));
      if (endAt) list.push(ev(sid, "game_completed", T(endAt), { playId: pid, playIndex: 1, durationMs: activeMs }));
      return list;
    };
    const list: StoredEvent[] = [
      ...play("A", "P1", "00:00", "01:30", 60_000, true), // gerçek 90 sn − aktif 60 sn = 30 sn
      ...play("B", "P2", "10:00", "11:30", 50_000, true), // 90 − 50 = 40 sn
      ...play("C", "P3", "20:00", "20:40", 50_000, true), // 40 − 50 < 0 → 0 (saat farkı)
      ...play("D", "P4", "30:00", "31:30", 60_000, false), // cevap yok: soru sorulmamış, dışlanır
      ...play("E", "P5", "40:00", null, 0, true), // tamamlanmamış: dışlanır
      ev("F", "game_started", "2026-10-11T10:50:00Z", { playId: "P6", playIndex: 1 }), // 2 saat sonra bitiyor: telefon bırakılmış
      ans("F", true, "50:10", { playId: "P6", playIndex: 1 }),
      ev("F", "game_completed", "2026-10-11T12:50:00Z", { playId: "P6", playIndex: 1, durationMs: 60_000 }),
    ];
    const s = computeKpis(list, [], TZ).selfCheck;
    expect(s.overheadSamples).toBe(3); // P1, P2, P3
    expect(s.overheadMedianMs).toBe(30_000); // [0, 30, 40] sn → medyan 30 sn

    // Cevap hiç yoksa ölçülmez
    const none = computeKpis(play("A", "P1", "00:00", "01:30", 60_000, false), [], TZ).selfCheck;
    expect(none.overheadMedianMs).toBeNull();
    expect(none.overheadSamples).toBe(0);
  });
});
