import { Card, DataTable, FilterBar, Notice, PageHeader, Tabs } from "@/components/ui";
import { formatDate, monthLabel } from "@/lib/dates";
import { formatMoney, formatPrice, formatQty } from "@/lib/decimal";
import { dateParam, firstParam, pageCtx, type SearchParams } from "@/server/page";
import { defaultPeriod, monthlyReport, spendReport, type SpendGroup } from "@/server/services/reports";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx("reports.view");
  const sp = await searchParams;
  const d = defaultPeriod(ctx.today);
  const from = dateParam(sp.from) ?? d.from;
  const to = dateParam(sp.to) ?? d.to;
  const group = (["urun", "kategori", "tedarikci"] as const).find((g) => g === firstParam(sp.grup)) ?? "urun";
  const vat = firstParam(sp.kdv) === "dahil" ? "dahil" : "haric";
  const p = from <= to ? { from, to } : d;
  const [months, spend] = await Promise.all([monthlyReport(ctx, p), spendReport(ctx, p, group as SpendGroup)]);
  const q = (extra: Record<string, string>) => `/raporlar?${new URLSearchParams({ from: p.from, to: p.to, grup: group, kdv: vat, ...extra })}`;
  const csv = (kind: string) => `/api/disa-aktar/${kind}?${new URLSearchParams({ from: p.from, to: p.to })}`;
  const vatLabel = vat === "dahil" ? "KDV dahil" : "KDV hariç";
  const amt = (a: { net: string; total: string }) => (vat === "dahil" ? a.total : a.net);
  return (
    <>
      <PageHeader title="Raporlar" subtitle={`${formatDate(p.from)} – ${formatDate(p.to)}`} />
      <FilterBar action="/raporlar" from={p.from} to={p.to} hidden={{ grup: group, kdv: vat }} />
      <Tabs current={vat} items={[{ key: "haric", label: "KDV hariç görünüm", href: q({ kdv: "haric" }) }, { key: "dahil", label: "KDV dahil görünüm", href: q({ kdv: "dahil" }) }]} />

      <Card title="Aylık: sipariş, satın alma ve nakit çıkışı (ayrı rakamlar)" actions={<a className="btn btn-secondary btn-sm" href={csv("aylik")}>CSV</a>}>
        <Notice tone="gray">
          <b>1) Verilen sipariş</b>: siparişin verildiği güne göre (borç değildir). <b>2) Net satın alma</b>: fatura tarihine göre faturalar ± onaylı düzeltmeler.{" "}
          <b>3) Nakit çıkışı</b>: ödeme tarihine göre (ödeme tutarında KDV ayrımı yoktur). Para birimleri ayrı satırdadır.
        </Notice>
        <div className="mt-3">
          <DataTable rows={months} rowKey={(m) => `${m.month}-${m.currency}`}
            columns={[
              { label: "Ay", cell: (m) => <b>{monthLabel(m.month)}</b> },
              { label: "Para birimi", cell: (m) => m.currency },
              { label: `1) Verilen sipariş (${vatLabel})`, align: "right", cell: (m) => <>{formatMoney(amt(m.ordered), m.currency)}<div className="text-sm text-muted">{m.orderCount} sipariş</div></> },
              { label: `Faturalar (${vatLabel})`, align: "right", cell: (m) => <>{formatMoney(amt(m.invoiced), m.currency)}<div className="text-sm text-muted">{m.invoiceCount} fatura</div></> },
              { label: `Düzeltmeler (${vatLabel})`, align: "right", cell: (m) => formatMoney(amt(m.adjustments), m.currency) },
              { label: `2) Net satın alma (${vatLabel})`, align: "right", cell: (m) => <><b>{formatMoney(amt(m.netPurchase), m.currency)}</b>{m.currency !== "TRY" && <div className="text-sm text-muted">TL karşılığı (kuru olan): {m.tlPurchase ? formatMoney(m.tlPurchase) : "—"}{m.tlPurchaseMissing ? ` · ${m.tlPurchaseMissing} faturada kur yok` : ""}</div>}</> },
              { label: "3) Nakit çıkışı", align: "right", cell: (m) => <><b>{formatMoney(m.paid, m.currency)}</b><div className="text-sm text-muted">{m.paymentCount} ödeme{m.currency !== "TRY" && m.tlPaid ? ` · TL ${formatMoney(m.tlPaid)}` : ""}{m.tlPaidMissing ? ` · ${m.tlPaidMissing} ödemede kur yok` : ""}</div></> },
            ]} />
        </div>
      </Card>

      <Card title={`Satın alma (fatura kalemlerinden, ${vatLabel})`} className="mt-4" actions={<a className="btn btn-secondary btn-sm" href={csv(`harcama-${group}`)}>CSV</a>}>
        <Tabs current={group} items={[{ key: "urun", label: "Ürün bazında", href: q({ grup: "urun" }) }, { key: "kategori", label: "Kategori bazında", href: q({ grup: "kategori" }) }, { key: "tedarikci", label: "Tedarikçi bazında", href: q({ grup: "tedarikci" }) }]} />
        <p className="mb-3 text-sm text-muted">Yalnızca fatura kalemleri sayılır (fatura tarihi). Ödemeler ve iade/fiyat farkı düzeltmeleri ürünlere dağıtılmaz. “Satın alınan miktar” tüketim değildir; talepte bildirilen kalan miktar stok sayımı değildir.</p>
        <DataTable rows={spend} rowKey={(r) => `${r.key}-${r.currency}`} empty="Bu dönemde fatura kalemi yok."
          columns={[
            { label: group === "urun" ? "Ürün" : group === "kategori" ? "Kategori" : "Tedarikçi", cell: (r) => r.label },
            { label: "Para birimi", cell: (r) => r.currency },
            ...(group === "urun" ? [
              { label: "Satın alınan miktar", align: "right" as const, cell: (r: (typeof spend)[number]) => `${formatQty(r.qty)} ${r.unitLabel ?? ""}` },
              { label: "Net birim fiyat: ilk → son (KDV hariç)", align: "right" as const, cell: (r: (typeof spend)[number]) => <>{formatPrice(r.firstUnitNet, r.currency)} → {formatPrice(r.lastUnitNet, r.currency)}{r.changePct && <div className={`text-sm font-semibold ${r.changePct.startsWith("-") ? "text-emerald-700" : r.changePct === "0.0" ? "text-muted" : "text-red-700"}`}>{r.changePct.startsWith("-") ? "" : "+"}{r.changePct.replace(".", ",")}%</div>}</> },
              { label: "Ortalama (KDV hariç)", align: "right" as const, cell: (r: (typeof spend)[number]) => formatPrice(r.avgUnitNet, r.currency) },
            ] : [{ label: "Kalem", align: "right" as const, cell: (r: (typeof spend)[number]) => r.lineCount }]),
            { label: `Tutar (${vatLabel})`, align: "right", cell: (r) => <b>{formatMoney(vat === "dahil" ? r.total : r.net, r.currency)}</b> },
            { label: "KDV", align: "right", cell: (r) => formatMoney(r.vat, r.currency) },
          ]} />
      </Card>
      <Card title="Diğer dışa aktarımlar" className="mt-4">
        <div className="flex flex-wrap gap-2">
          {[["faturalar", "Faturalar"], ["odemeler", "Ödemeler"], ["duzeltmeler", "Düzeltmeler"], ["bakiyeler", "Tedarikçi bakiyeleri"], ["siparis-kalemleri", "Sipariş kalemleri"], ["talepler", "Talepler"], ["sorunlar", "Teslimat sorunları"]].map(([k, l]) => (
            <a key={k} className="btn btn-secondary btn-sm" href={csv(k!)}>{l} (CSV)</a>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted">CSV dosyaları Türkçe Excel’de doğrudan açılır (UTF-8, noktalı virgül). Bu uygulama operasyonel takip aracıdır; resmî muhasebe veya e-fatura kaydı değildir.</p>
      </Card>
    </>
  );
}
