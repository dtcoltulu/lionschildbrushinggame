import { formatDuration, formatPercent, type Kpis } from "@/lib/kpi";

function Card({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-purple/10">
      <div className="text-sm font-semibold text-ink/70">{label}</div>
      <div className="mt-1 text-4xl font-black tabular-nums text-purple" data-testid={testId}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-ink/70">{sub}</div>}
    </div>
  );
}

export function KpiCards({ k }: { k: Kpis }) {
  return (
    <section aria-label="Özet" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      <Card testId="kpi-landing" label="QR Landing" value={String(k.landingVisitors)} sub={`${k.landingViews} sayfa görüntüleme`} />
      <Card testId="kpi-starters" label="Oyunu Başlatan" value={String(k.starters)} />
      <Card testId="kpi-completers" label="Tamamlayan" value={String(k.completers)} sub="benzersiz kişi (tarayıcı)" />
      <Card testId="kpi-rate" label="Tamamlama" value={formatPercent(k.completionRate)} sub="tamamlayan / başlayan" />
      <Card testId="kpi-avg" label="Ortalama Süre" value={formatDuration(k.avgDurationMs)} sub={`Medyan ${formatDuration(k.medianDurationMs)} · ${k.durationSamples} oyun`} />
      <Card testId="kpi-replays" label="Tekrar Oynama" value={String(k.replays)} />
      <Card testId="kpi-total" label="Toplam Başarılı Tamamlanma" value={String(k.totalCompletions)} sub="tekrarlar dahil · diş macunuyla kıyaslanabilir" />
      <Card testId="kpi-tutorial" label="Öğretici" value={`${k.tutorialCompleted} / ${k.tutorialSkipped}`} sub="bitiren / atlayan" />
    </section>
  );
}
