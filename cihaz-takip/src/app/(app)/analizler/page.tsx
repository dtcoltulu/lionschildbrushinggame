import type { Metadata } from "next";
import Link from "next/link";
import { BarList, MonthBars } from "@/components/charts";
import { Card, DownloadLink, EmptyState, Notice, PageHeader, StatTile } from "@/components/ui";
import { addMonths, formatDate, MONTHS_TR, monthLabel } from "@/lib/dates";
import { formatTL } from "@/lib/money";
import { dateParam, firstParam, pageCtx } from "@/server/page";
import { causeStats, costReport, deviceRepairStats, type Period } from "@/server/services/analytics";

export const metadata: Metadata = { title: "Analizler" };
export const dynamic = "force-dynamic";

function presets(today: string): { key: string; label: string; p: Period }[] {
  const m = today.slice(0, 7);
  return [
    { key: "bu-ay", label: "Bu ay", p: { from: `${m}-01`, to: today } },
    { key: "3-ay", label: "Son 3 ay", p: { from: `${addMonths(m, -2)}-01`, to: today } },
    { key: "12-ay", label: "Son 12 ay", p: { from: `${addMonths(m, -11)}-01`, to: today } },
    { key: "bu-yil", label: "Bu yıl", p: { from: `${today.slice(0, 4)}-01-01`, to: today } },
    { key: "tumu", label: "Tüm zamanlar", p: { from: null, to: null } },
  ];
}

const shortMonth = (k: string) => `${MONTHS_TR[Number(k.slice(5, 7)) - 1]!.slice(0, 3)} ${k.slice(2, 4)}`;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageCtx({ admin: true });
  const sp = await searchParams;
  const all = presets(ctx.today);
  const custom = dateParam(sp.from) || dateParam(sp.to);
  const chosen = custom ? null : all.find((x) => x.key === firstParam(sp.donem)) ?? all[2]!;
  const period: Period = custom ? { from: dateParam(sp.from), to: dateParam(sp.to) } : chosen!.p;
  const periodLabel = chosen ? chosen.label : `${period.from ? formatDate(period.from) : "başlangıç"} – ${period.to ? formatDate(period.to) : "bugün"}`;

  const [repair, cost, causes] = await Promise.all([
    deviceRepairStats(ctx.db, period),
    costReport(ctx.db, period, ctx.today),
    causeStats(ctx.db, period),
  ]);
  const qs = new URLSearchParams(Object.entries({ from: period.from, to: period.to }).filter(([, v]) => v) as [string, string][]);
  const allTime = !period.from && !period.to;

  return (
    <>
      <PageHeader title="Analizler" subtitle={`Dönem: ${periodLabel}`} />
      <div className="card mb-5 space-y-3 p-3">
        <nav className="flex flex-wrap gap-2" aria-label="Dönem">
          {all.map((x) => (
            <Link key={x.key} href={`/analizler?donem=${x.key}`} className={`btn btn-sm ${chosen?.key === x.key ? "btn-primary" : "btn-secondary"}`}>{x.label}</Link>
          ))}
        </nav>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Başlangıç<input type="date" name="from" defaultValue={custom ? (period.from ?? "") : ""} className="field mt-1" /></label>
          <label className="text-sm">Bitiş<input type="date" name="to" defaultValue={custom ? (period.to ?? "") : ""} className="field mt-1" /></label>
          <button className="btn btn-secondary">Seçili dönemi göster</button>
        </form>
        <p className="text-sm text-muted">
          Silinen arızalar ve geri alınan servis gönderimleri hiçbir sayıya girmez. Arızalar fark edildiği tarihe, servis gidişleri gönderim tarihine
          (girilmemişse kaydın açıldığı güne), maliyetler masraf tarihine göre döneme yazılır.
        </p>
      </div>

      <Card title="1. En sık tamire giden cihazlar" className="mb-5" actions={<DownloadLink href={"/api/disa-aktar/servis-gidisleri"}>Excel (servis gidişleri)</DownloadLink>}>
        <p className="mb-3 text-[15px] text-muted">
          Fiziksel cihaz bazında. <b>Tamire gidiş</b> = servise gönderim sayısı (aynı kaydı düzenlemek yeni gidiş sayılmaz). <b>Arıza bildirimi</b> servise
          gitmemiş arızaları da kapsar.
          {repair.tripsWithoutSentOn > 0 && ` ${repair.tripsWithoutSentOn} gidişin gönderim tarihi girilmemiş (kayıt gününe göre sayıldı).`}
        </p>
        {repair.rows.length === 0 ? (
          <EmptyState>Bu dönemde arıza veya servis kaydı yok.</EmptyState>
        ) : (
          <>
            <div className="mb-4">
              <BarList
                ariaLabel="Cihaz başına tamire gidiş sayısı"
                rows={repair.rows.filter((r) => r.tripCount > 0).slice(0, 10).map((r) => ({ key: r.deviceId, label: `${r.inventoryCode} ${r.name}`, value: r.tripCount, title: `${r.inventoryCode} ${r.name}: ${r.tripCount} tamire gidiş` }))}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-left text-[15px]">
                <thead className="border-b border-slate-200 text-sm text-muted">
                  <tr>
                    <th className="py-2 pr-2">#</th><th className="py-2 pr-2">Kod</th><th className="py-2 pr-2">Cihaz</th><th className="py-2 pr-2">Marka / model</th>
                    <th className="py-2 pr-2">Sorumlu</th><th className="py-2 pr-2 text-right">Tamire gidiş</th><th className="py-2 pr-2 text-right">Arıza bildirimi</th><th className="py-2 text-right">Tamir maliyeti</th>
                  </tr>
                </thead>
                <tbody>
                  {repair.rows.map((r, i) => (
                    <tr key={r.deviceId} className="border-b border-slate-100">
                      <td className="py-2 pr-2 text-muted">{i + 1}</td>
                      <td className="py-2 pr-2 font-mono font-bold"><Link className="text-brand hover:underline" href={`/cihazlar/${r.deviceId}`}>{r.inventoryCode}</Link></td>
                      <td className="py-2 pr-2">{r.name}{r.lifecycle === "envanterden_cikarildi" && <span className="text-sm text-muted"> (çıkarıldı)</span>}</td>
                      <td className="py-2 pr-2">{[r.brand, r.model].filter(Boolean).join(" ") || "—"}</td>
                      <td className="py-2 pr-2">{r.responsibleName ?? "—"}</td>
                      <td className="py-2 pr-2 text-right font-bold tabular-nums">{r.tripCount}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{r.faultCount}</td>
                      <td className="py-2 text-right tabular-nums">
                        {r.costCount ? formatTL(r.totalCost) : <span className="text-slate-400" title="Bu dönemde tutarı girilmiş kayıt yok">—</span>}
                        {!allTime && r.undatedCost > 0 && <div className="text-xs text-amber-800">+ {formatTL(r.undatedCost)} tarihi eksik</div>}
                        {r.unknownCostTrips > 0 && <div className="text-xs text-amber-800">{r.unknownCostTrips} gidişin tutarı eksik</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card title="2. Tamir maliyeti (TL)" className="mb-5" actions={<DownloadLink href={`/api/disa-aktar/aylik-maliyet?${qs}`}>Excel (aylık)</DownloadLink>}>
        <div id="maliyet" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={`Bu ay (${monthLabel(cost.thisMonth)})`} value={formatTL(cost.thisMonthTotal)} />
          <StatTile label="Seçili dönem toplamı" value={formatTL(cost.periodTotal)} hint={`${cost.periodCount} kayıt${cost.periodFreeCount ? `, ${cost.periodFreeCount} ücretsiz` : ""}`} />
          <StatTile label="Tarihi eksik tutar" value={formatTL(cost.undatedTotal)} hint={`${cost.undated.length} kayıt · hiçbir aya yazılmadı`} tone={cost.undated.length ? "amber" : undefined} />
          <StatTile label="Tutarı girilmemiş dönüş" value={cost.unknownAmount.length} hint="Ücretsiz sayılmaz" tone={cost.unknownAmount.length ? "amber" : undefined} />
        </div>
        <h3 className="mb-2 font-bold">Ay ay tamir maliyeti (masraf tarihine göre)</h3>
        <MonthBars ariaLabel="Aylık tamir maliyeti" format={(n) => formatTL(n).replace(",00", "")} rows={cost.months.map((m) => ({ key: m.month, label: monthLabel(m.month), short: shortMonth(m.month), value: m.total }))} />
        <details className="mt-3">
          <summary className="cursor-pointer font-semibold text-brand">Tablo olarak göster</summary>
          <table className="mt-2 w-full text-left text-[15px]">
            <thead className="text-sm text-muted"><tr><th className="py-1">Ay</th><th className="py-1 text-right">Toplam</th><th className="py-1 text-right">Kayıt</th><th className="py-1 text-right">Ücretsiz</th></tr></thead>
            <tbody>
              {cost.months.map((m) => (
                <tr key={m.month} className="border-t border-slate-100"><td className="py-1">{monthLabel(m.month)}</td><td className="py-1 text-right tabular-nums">{formatTL(m.total)}</td><td className="py-1 text-right">{m.count}</td><td className="py-1 text-right">{m.freeCount}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 font-bold">Cihaz bazında maliyet (seçili dönem)</h3>
            {cost.byDevice.length ? (
              <BarList ariaLabel="Cihaz bazında tamir maliyeti" format={(n) => formatTL(n)} rows={cost.byDevice.slice(0, 15).map((d) => ({ key: d.deviceId, label: `${d.deviceCode} ${d.deviceName}`, value: d.total }))} />
            ) : (
              <p className="text-muted">Bu dönemde tarihli maliyet yok.</p>
            )}
          </div>
          <div className="space-y-3">
            <h3 className="font-bold">Eksik bilgili kayıtlar</h3>
            {cost.undated.length === 0 && cost.unknownAmount.length === 0 && <p className="text-muted">Eksik maliyet bilgisi yok.</p>}
            {cost.undated.length > 0 && (
              <Notice tone="amber" title={`Masraf tarihi eksik (${cost.undated.length}) – hiçbir aya yazılmadı`}>
                <ul className="mt-1 space-y-1">
                  {cost.undated.map((u) => (
                    <li key={u.visitId}><Link className="underline" href={`/arizalar/${u.faultId}`}>{u.deviceCode} {u.deviceName}</Link>: {formatTL(u.amount)}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {cost.unknownAmount.length > 0 && (
              <Notice tone="amber" title={`Tutarı girilmemiş tamir dönüşü (${cost.unknownAmount.length})`}>
                <ul className="mt-1 space-y-1">
                  {cost.unknownAmount.map((u) => (
                    <li key={u.visitId}><Link className="underline" href={`/arizalar/${u.faultId}`}>{u.deviceCode} {u.deviceName}</Link>{u.vendorName ? ` · ${u.vendorName}` : ""}</li>
                  ))}
                </ul>
              </Notice>
            )}
          </div>
        </div>
      </Card>

      <Card title="3. En sık arıza nedenleri" actions={<DownloadLink href={"/api/disa-aktar/arizalar"}>Excel (arızalar)</DownloadLink>}>
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Arıza bildirimi" value={causes.total} />
          <StatTile label="Nedeni belirlenmemiş" value={causes.undetermined} tone={causes.undetermined ? "amber" : undefined} />
          <StatTile label="Doğrulanmış neden" value={causes.verified} hint="Servis veya klinik kontrolüyle" />
          <StatTile label="Ön değerlendirme" value={causes.preliminary} hint="Henüz doğrulanmamış" />
        </div>
        {causes.rows.length === 0 ? (
          <EmptyState>Bu dönemde arıza kaydı yok.</EmptyState>
        ) : (
          <>
            <BarList ariaLabel="Nedene göre arıza sayısı" rows={causes.rows.map((c) => ({ key: c.causeId, label: c.causeName, value: c.total }))} />
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-[15px]">
                <thead className="border-b border-slate-200 text-sm text-muted">
                  <tr><th className="py-2 pr-2">Neden</th><th className="py-2 pr-2 text-right">Toplam</th><th className="py-2 pr-2 text-right">Ön değerlendirme</th><th className="py-2 pr-2 text-right">Servis doğruladı</th><th className="py-2 text-right">Klinik doğruladı</th></tr>
                </thead>
                <tbody>
                  {causes.rows.map((c) => (
                    <tr key={c.causeId} className="border-b border-slate-100">
                      <td className="py-2 pr-2"><Link className="hover:underline" href={`/arizalar?gorunum=tumu&neden=${c.causeId}${period.from ? `&from=${period.from}` : ""}${period.to ? `&to=${period.to}` : ""}`}>{c.causeName}</Link></td>
                      <td className="py-2 pr-2 text-right font-bold tabular-nums">{c.total}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{c.preliminary}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{c.verifiedByService}</td>
                      <td className="py-2 text-right tabular-nums">{c.verifiedByClinic}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="mt-3 text-sm text-muted">
          Kişi bazlı kayıtlar Arıza &amp; servis listesinde kişi seçilerek incelenebilir. Arızayı fark eden ya da son kullanan kişi üzerinden
          “kim daha çok cihaz bozuyor” sıralaması bilinçli olarak üretilmez.
        </p>
      </Card>
    </>
  );
}
