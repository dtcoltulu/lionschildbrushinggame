import { SettingsTabs } from "@/components/SettingsTabs";
import { Card, Notice, PageHeader } from "@/components/ui";
import { pageCtx } from "@/server/page";
import { can } from "@/server/permissions";
import { defaultPeriod } from "@/server/services/reports";
import { EXPORTS } from "@/server/services/export";
import { settingsTabs } from "@/server/settings-tabs";

export const dynamic = "force-dynamic";

export default async function ExportPage() {
  const ctx = await pageCtx("export.operations");
  const p = defaultPeriod(ctx.today);
  const from = `${Number(ctx.today.slice(0, 4)) - 5}-01-01`;
  return (
    <>
      <PageHeader title="Ayarlar" />
      <SettingsTabs current="disa-aktar" items={settingsTabs(ctx.actor)} />
      <Card title="CSV dışa aktarım (Excel)">
        <ul className="grid gap-2 sm:grid-cols-2">
          {Object.entries(EXPORTS).filter(([, m]) => !m.finance || can(ctx.actor, "export.finance")).map(([k, m]) => (
            <li key={k}><a className="btn btn-secondary w-full justify-between" href={`/api/disa-aktar/${k}?from=${from}&to=${p.to}`}>{m.label}<span aria-hidden>⇩</span></a></li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-muted">Son 5 yıl. Dönem seçmek için Raporlar ekranını kullanın.</p>
      </Card>
      <div className="mt-4">
        <Notice tone="amber" title="Yedekleme">
          CSV dosyaları okunabilir ek arşivdir; geri yükleme için yeterli değildir. Asıl yedek veritabanı yedeğidir (pg_dump); ayrıntı README “Yedekleme ve geri yükleme” bölümünde.
        </Notice>
      </div>
    </>
  );
}
