import Link from "next/link";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { EventsTable } from "@/components/admin/EventsTable";
import { HourlyChart } from "@/components/admin/HourlyChart";
import { HourlyTable } from "@/components/admin/HourlyTable";
import { KpiCards } from "@/components/admin/KpiCards";
import { CAMPAIGNS, resolveCampaign } from "@/config/campaigns";
import { requireAdmin } from "@/lib/admin-guard";
import { getStore } from "@/lib/get-store";
import { computeKpis, hourlyForDate } from "@/lib/kpi";
import { describeStoreError } from "@/lib/store-error";

export const dynamic = "force-dynamic";
export const metadata = { title: "Yönetim | Diş Kahramanı" };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ k?: string; d?: string }> }) {
  await requireAdmin("/admin");
  const sp = await searchParams;
  const campaign = resolveCampaign(sp.k);
  const store = getStore();

  if (!store) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-black text-purple">Veri deposu yapılandırılmamış</h1>
        <p className="mt-2">SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY ortam değişkenlerini ayarlayın (bkz. DEPLOYMENT.md).</p>
      </main>
    );
  }

  let data;
  try {
    data = await store.loadCampaign(campaign.campaignId);
  } catch (err) {
    // Anahtar/URL içermeyen, kısa bir teşhis satırı (ör. "events: Invalid API key", "fetch failed").
    const detail = describeStoreError(err);
    console.error("admin loadCampaign failed:", detail);
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-black text-purple">Veriler okunamadı</h1>
        <p className="mt-2">Veritabanına ulaşılamadı. Bağlantıyı ve anahtarları kontrol edip sayfayı yenileyin.</p>
        <p className="mt-3 rounded-xl bg-purple-soft p-3 font-mono text-sm" data-testid="store-error-detail">
          Ayrıntı: {detail}
        </p>
      </main>
    );
  }

  const k = computeKpis(data.events, data.sessions, campaign.timezone);
  const date = sp.d && k.dates.includes(sp.d) ? sp.d : null;
  const hours = hourlyForDate(k.hourly, date);
  const recent = [...data.events].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)).slice(0, 100);
  const q = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { k: campaign.campaignId, d: date ?? undefined, ...over };
    for (const [key, v] of Object.entries(merged)) if (v) p.set(key, v);
    return `/admin?${p.toString()}`;
  };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-purple">Özet</h1>
          <p className="text-sm text-ink/70">
            {campaign.reportTitle} · {campaign.eventLocation}
          </p>
          <p className="text-xs text-ink/60">
            Depo: {store.kind === "memory" ? "BELLEK İÇİ (geliştirme – veriler kalıcı değil)" : "Supabase"} · Kampanya: {campaign.campaignId}
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <AutoRefresh />
          <Link href={`/admin/report?k=${campaign.campaignId}`} className="inline-flex min-h-[44px] items-center rounded-full bg-gold px-5 font-extrabold text-ink" data-testid="report-link">
            Etkinlik Raporu Oluştur
          </Link>
          <Link href="/qr" className="inline-flex min-h-[44px] items-center rounded-full bg-white px-4 font-bold text-purple ring-2 ring-purple">
            QR
          </Link>
          <form method="post" action="/api/admin/logout">
            <button type="submit" className="min-h-[44px] rounded-full px-3 text-sm font-semibold underline">Çıkış</button>
          </form>
        </div>
      </header>

      {CAMPAIGNS.length > 1 && (
        <nav aria-label="Kampanya" className="flex flex-wrap gap-2">
          {CAMPAIGNS.map((c) => (
            <Link key={c.campaignId} href={q({ k: c.campaignId, d: undefined })} aria-current={c.campaignId === campaign.campaignId ? "page" : undefined} className="min-h-[44px] rounded-full bg-white px-4 py-2 text-sm font-bold ring-1 ring-purple/30 aria-[current=page]:bg-purple aria-[current=page]:text-white">
              {c.eventName} ({c.eventDateLabel})
            </Link>
          ))}
        </nav>
      )}

      <KpiCards k={k} />

      <section aria-labelledby="hourly" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-purple/10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="hourly" className="text-xl font-extrabold">Saatlere göre katılım</h2>
          {k.dates.length > 1 && (
            <div className="flex flex-wrap gap-1 text-sm">
              <Link href={q({ d: undefined })} className={`min-h-[44px] rounded-full px-3 py-2 font-semibold ${!date ? "bg-purple text-white" : "ring-1 ring-purple/30"}`}>Tüm günler</Link>
              {k.dates.map((d) => (
                <Link key={d} href={q({ d })} className={`min-h-[44px] rounded-full px-3 py-2 font-semibold ${date === d ? "bg-purple text-white" : "ring-1 ring-purple/30"}`}>{d}</Link>
              ))}
            </div>
          )}
        </div>
        <HourlyChart rows={hours} />
        <details className="mt-3">
          <summary className="min-h-[44px] cursor-pointer py-2 font-semibold">Tablo görünümü</summary>
          <HourlyTable rows={hours} />
        </details>
      </section>

      {k.phases.length > 0 && (
        <section aria-labelledby="phases" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-purple/10">
          <h2 id="phases" className="text-xl font-extrabold">Aşama süreleri</h2>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {k.phases.map((p) => (
              <li key={p.phase}>Aşama {p.phase}: <strong>{Math.round(p.avgMs / 1000)} sn</strong> ortalama ({p.count} tamamlanma)</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="events" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="events" className="text-xl font-extrabold">Son olaylar</h2>
          <a href={`/api/admin/export?k=${campaign.campaignId}&type=events`} className="inline-flex min-h-[44px] items-center text-sm font-bold text-purple underline">
            Ham olayları CSV indir
          </a>
        </div>
        <EventsTable events={recent} tz={campaign.timezone} />
      </section>

      <p className="text-xs text-ink/60">
        Not: “Benzersiz” sayılar tarayıcı bazlıdır. Aynı telefonu paylaşan kardeşler tek kişi, tarayıcı verisini silenler birden fazla kişi sayılabilir; bu nedenle sayılar yaklaşıktır.
      </p>
    </main>
  );
}
