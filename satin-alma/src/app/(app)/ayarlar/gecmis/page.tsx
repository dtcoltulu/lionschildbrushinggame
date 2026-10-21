import { History } from "@/components/History";
import { SettingsTabs } from "@/components/SettingsTabs";
import { Card, PageHeader, Tabs } from "@/components/ui";
import { AUDIT_COLS, type AuditRow } from "@/server/audit";
import { firstParam, pageCtx, type SearchParams } from "@/server/page";
import { can } from "@/server/permissions";
import { settingsTabs } from "@/server/settings-tabs";

export const dynamic = "force-dynamic";

const ENTITIES: [string, string][] = [["", "Tümü"], ["request", "Talepler"], ["order", "Siparişler"], ["receipt", "Teslimatlar"], ["issue", "Sorunlar"], ["variant", "Katalog"], ["supplier", "Tedarikçiler"], ["invoice", "Faturalar"], ["payment", "Ödemeler"], ["adjustment", "Düzeltmeler"], ["user", "Kullanıcılar"]];

/** İşlem geçmişi: finansal satırlar yalnızca finans rolüne gösterilir. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx("audit.view");
  const sp = await searchParams;
  const entity = ENTITIES.find(([k]) => k === firstParam(sp.tur))?.[0] ?? "";
  const params: unknown[] = [];
  const where: string[] = [];
  if (!can(ctx.actor, "finance.view")) where.push(`visibility = 'genel'`);
  if (!can(ctx.actor, "users.manage")) where.push(`entity <> 'user'`);
  if (entity) {
    params.push(entity);
    where.push(`entity = $${params.length}`);
  }
  const rows = await ctx.db.query<AuditRow>(`select ${AUDIT_COLS} from audit_log ${where.length ? `where ${where.join(" and ")}` : ""} order by at desc, id desc limit 500`, params);
  return (
    <>
      <PageHeader title="Ayarlar" />
      <SettingsTabs current="gecmis" items={settingsTabs(ctx.actor)} />
      <Tabs current={entity || "hepsi"} items={ENTITIES.filter(([k]) => can(ctx.actor, "finance.view") || !["invoice", "payment", "adjustment"].includes(k)).map(([k, l]) => ({ key: k || "hepsi", label: l, href: `/ayarlar/gecmis${k ? `?tur=${k}` : ""}` }))} />
      <Card title="Son 500 işlem"><History rows={rows} /></Card>
    </>
  );
}
