import type { Metadata } from "next";
import Link from "next/link";
import { History } from "@/components/History";
import { SettingsTabs } from "@/components/SettingsTabs";
import { Card, PageHeader } from "@/components/ui";
import { recentAudit } from "@/server/audit";
import { firstParam, pageCtx } from "@/server/page";

export const metadata: Metadata = { title: "İşlem geçmişi" };
export const dynamic = "force-dynamic";

const ENTITIES = [
  { value: "", label: "Tümü" },
  { value: "fault", label: "Arızalar" },
  { value: "device", label: "Cihazlar" },
  { value: "staff", label: "Personel" },
  { value: "user", label: "Kullanıcılar" },
];

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageCtx({ admin: true });
  const entity = firstParam((await searchParams).tur) ?? "";
  const rows = await recentAudit(ctx.db, { entity: ENTITIES.some((e) => e.value === entity) && entity ? entity : undefined, limit: 300 });
  return (
    <>
      <PageHeader title="Ayarlar" />
      <SettingsTabs current="/ayarlar/gecmis" superAdmin={ctx.actor.superAdmin} />
      <nav className="mb-3 flex flex-wrap gap-2">
        {ENTITIES.map((e) => (
          <Link key={e.value} href={e.value ? `/ayarlar/gecmis?tur=${e.value}` : "/ayarlar/gecmis"} className={`btn btn-sm ${e.value === entity ? "btn-primary" : "btn-secondary"}`}>{e.label}</Link>
        ))}
      </nav>
      <Card title="Son 300 işlem">
        <History rows={rows} />
      </Card>
    </>
  );
}
