import { ActionPanel } from "@/components/ActionPanel";
import { SettingsTabs } from "@/components/SettingsTabs";
import { Badge, Card, PageHeader } from "@/components/ui";
import { pageCtx } from "@/server/page";
import { LOOKUP_KINDS, LOOKUP_LABELS, listLookup } from "@/server/services/lookups";
import { settingsTabs } from "@/server/settings-tabs";

export const dynamic = "force-dynamic";

export default async function ListsPage() {
  const ctx = await pageCtx("lookups.manage");
  const lists = await Promise.all(LOOKUP_KINDS.map(async (k) => ({ kind: k, rows: await listLookup(ctx.db, k, { includeInactive: true }) })));
  return (
    <>
      <PageHeader title="Ayarlar" />
      <SettingsTabs current="listeler" items={settingsTabs(ctx.actor)} />
      <div className="grid gap-4 lg:grid-cols-2">
        {lists.map(({ kind, rows }) => (
          <Card key={kind} title={LOOKUP_LABELS[kind]}>
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2">
                  <span className="font-semibold">{r.name} {!r.active && <Badge tone="gray">Pasif</Badge>}</span>
                  <ActionPanel title="Düzenle" tone="secondary" method="PATCH" endpoint={`/api/listeler/${kind}/${r.id}`} extra={{ version: r.version }}
                    fields={[{ name: "name", label: "Ad", type: "text", initial: r.name, required: true }, { name: "sortOrder", label: "Sıra", type: "int", initial: String(r.sortOrder) }, { name: "active", label: "Aktif", type: "checkbox", initial: r.active }]} />
                </li>
              ))}
            </ul>
            <div className="mt-3"><ActionPanel title="+ Ekle" endpoint={`/api/listeler/${kind}`} fields={[{ name: "name", label: "Ad", type: "text", required: true }]} /></div>
          </Card>
        ))}
      </div>
    </>
  );
}
