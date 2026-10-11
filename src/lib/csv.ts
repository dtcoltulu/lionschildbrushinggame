import type { CampaignConfig } from "@/config/campaigns";
import { tr } from "@/content/tr";
import type { StoredEvent } from "@/types/analytics";
import { formatDuration, formatPercent, hourlyForDate, type Kpis } from "./kpi";

/** Türkçe Excel varsayılanı noktalı virgüldür; UTF-8 BOM Türkçe karakterleri korur. */
const SEP = ";";
const BOM = "﻿";

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // CSV/formül enjeksiyonuna karşı
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return BOM + rows.map((r) => r.map(cell).join(SEP)).join("\r\n") + "\r\n";
}

export interface ReportLine {
  label: string;
  value: string;
  note?: string;
}

/** Rapor sayfası ve CSV aynı satırlardan üretilir → tutarlı sayılar. */
export function reportLines(k: Kpis): ReportLine[] {
  const lines: ReportLine[] = [
    { label: "Toplam erişim (benzersiz ziyaretçi)", value: String(k.landingVisitors), note: `${k.landingViews} sayfa görüntüleme` },
    { label: "Oyuna başlayan", value: String(k.starters) },
    { label: "Tamamlayan (benzersiz)", value: String(k.completers) },
    { label: "Tamamlama oranı", value: formatPercent(k.completionRate) },
    { label: "Toplam başarılı tamamlanma", value: String(k.totalCompletions), note: "Tekrar oynamalar dahil" },
    { label: "Ortalama süre", value: formatDuration(k.avgDurationMs), note: `Medyan: ${formatDuration(k.medianDurationMs)} (${k.durationSamples} oyun)` },
    { label: "Tekrar oynama", value: String(k.replays) },
  ];
  const c = k.selfCheck;
  if (c.total > 0) {
    lines.push(
      { label: "“Yeterli temizlendi mi?” sorusu: cevap sayısı", value: String(c.total), note: `${c.children} çocuk (tarayıcı) cevapladı` },
      { label: "“Evet” (temizlik bitmeden “yeterli” dedi)", value: String(c.yes), note: formatPercent(c.yesRate) },
      { label: "“Hayır” (doğru farkındalık)", value: String(c.no), note: formatPercent(c.noRate) },
      { label: "En az bir kez “Evet” diyen çocuk", value: String(c.childrenYes), note: `cevaplayanların ${formatPercent(c.children > 0 ? c.childrenYes / c.children : null)}` },
    );
  }
  return lines;
}

export function hourLabel(h: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:00–${p((h + 1) % 24)}:00`;
}

export function reportCsv(c: CampaignConfig, k: Kpis, generatedAt: Date): string {
  const rows: (string | number | null)[][] = [
    [c.reportTitle],
    [c.reportSubtitle],
    ["Kampanya", c.campaignId],
    ["Tarih", c.eventDateLabel],
    ["Yer", c.eventLocation],
    ["Rapor oluşturma zamanı", generatedAt.toISOString()],
    [],
    ["ÖZET"],
    ["Gösterge", "Değer", "Not"],
    ...reportLines(k).map((l) => [l.label, l.value, l.note ?? ""]),
    [],
    ["SAATLİK DAĞILIM (" + c.timezone + ")"],
    ["Tarih", "Saat aralığı", "Sayfa görüntüleme", "Oyun başlatma (ilk)", "Tekrar oynama", "Kullanım (toplam oyun)", "Tamamlanma"],
  ];
  const dates = k.dates.length ? k.dates : [];
  for (const d of dates) {
    for (const h of hourlyForDate(k.hourly, d)) {
      if (h.landing + h.plays + h.completions === 0) continue;
      rows.push([d, hourLabel(h.hour), h.landing, h.starts, h.replays, h.plays, h.completions]);
    }
  }
  rows.push([], ["AŞAMA SÜRELERİ"], ["Aşama", "Tamamlanan", "Ortalama süre"]);
  for (const p of k.phases) rows.push([`Aşama ${p.phase}`, p.count, formatDuration(p.avgMs)]);
  if (k.selfCheck.total > 0) {
    rows.push([], ["KENDİNİ DEĞERLENDİRME: “Sence yeterli ve etkin temizlendi mi?” (AŞAMA BAZLI)"], ["Aşama", "Aşama adı", "Evet", "Hayır", "Toplam", "Evet oranı"]);
    for (const p of k.selfCheck.byPhase) {
      rows.push([`Aşama ${p.phase}`, tr.phases[p.phase - 1]?.name ?? "", p.yes, p.no, p.total, formatPercent(p.yesRate)]);
    }
  }
  rows.push([], ["CİHAZ SINIFI (kaba)"], ["mobil", k.devices.mobile], ["tablet", k.devices.tablet], ["masaüstü", k.devices.desktop], ["bilinmiyor", k.devices.unknown]);
  return toCsv(rows);
}

export function eventsCsv(events: StoredEvent[]): string {
  const rows: (string | number | null)[][] = [
    ["zaman_utc", "olay", "oturum_kodu_kisa", "oyun_no", "sure_ms", "asama"],
    ...events.map((e) => [e.occurredAt, e.name, e.sessionId.slice(0, 8), e.playIndex, e.durationMs, e.phase]),
  ];
  return toCsv(rows);
}
