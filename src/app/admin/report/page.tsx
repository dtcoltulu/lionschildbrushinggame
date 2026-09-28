import { HourlyTable } from "@/components/admin/HourlyTable";
import { PrintButton } from "@/components/admin/PrintButton";
import { resolveCampaign } from "@/config/campaigns";
import { reportLines } from "@/lib/csv";
import { requireAdmin } from "@/lib/admin-guard";
import { getStore } from "@/lib/get-store";
import { computeKpis, hourlyForDate } from "@/lib/kpi";

export const dynamic = "force-dynamic";
export const metadata = { title: "Etkinlik Raporu | Diş Kahramanı" };

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  await requireAdmin("/admin/report");
  const sp = await searchParams;
  const campaign = resolveCampaign(sp.k);
  const store = getStore();
  if (!store) return <main className="p-6">Veri deposu yapılandırılmamış.</main>;
  const data = await store.loadCampaign(campaign.campaignId);
  const k = computeKpis(data.events, data.sessions, campaign.timezone);
  const generated = new Intl.DateTimeFormat("tr-TR", { timeZone: campaign.timezone, dateStyle: "long", timeStyle: "short" }).format(new Date());

  return (
    <main className="mx-auto max-w-3xl bg-white px-6 py-8 text-ink">
      <div className="no-print mb-6 flex flex-wrap gap-2">
        <PrintButton />
        <a href={`/api/admin/export?k=${campaign.campaignId}&type=report`} className="inline-flex min-h-[44px] items-center rounded-full bg-gold px-5 font-extrabold" data-testid="csv-link">
          CSV indir
        </a>
        <a href={`/admin?k=${campaign.campaignId}`} className="inline-flex min-h-[44px] items-center px-3 font-semibold underline">← Panele dön</a>
      </div>

      <header className="border-b-4 border-purple pb-4 text-center">
        <h1 className="text-3xl font-black leading-tight text-purple">{campaign.reportTitle}</h1>
        <p className="mt-2 text-lg font-bold">{campaign.district.replace(" Bölgesi", "")} Sağlık Hedef Liderliği</p>
        <p className="text-lg font-bold">{campaign.committee}</p>
        <p className="mt-1 text-base font-semibold">Dijital Ağız ve Diş Sağlığı Farkındalık Etkinliği</p>
        <p className="mt-2 text-sm text-ink/70">
          {campaign.eventDateLabel} · {campaign.eventLocation}
        </p>
      </header>

      <section className="mt-6" aria-labelledby="ozet">
        <h2 id="ozet" className="text-xl font-extrabold">Özet</h2>
        <table className="mt-2 w-full border-collapse text-base">
          <tbody>
            {reportLines(k).map((l) => (
              <tr key={l.label} className="border-b border-purple/20">
                <th scope="row" className="py-2 pr-3 text-left font-semibold">{l.label}</th>
                <td className="py-2 text-right text-xl font-black tabular-nums" data-testid="report-value">{l.value}</td>
                <td className="py-2 pl-3 text-xs text-ink/70">{l.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6" aria-labelledby="saat">
        <h2 id="saat" className="text-xl font-extrabold">Saatlik dağılım</h2>
        <HourlyTable rows={hourlyForDate(k.hourly, null)} />
      </section>

      <footer className="mt-8 border-t pt-3 text-xs text-ink/70">
        <p>Rapor oluşturma zamanı: {generated}. Veriler anonimdir; kişisel veri toplanmamıştır.</p>
        <p>“Benzersiz” sayılar tarayıcı bazlı yaklaşık değerlerdir. Kullanım = başlatılan oyunlar (ilk oyun + tekrar oynama).</p>
      </footer>
    </main>
  );
}
