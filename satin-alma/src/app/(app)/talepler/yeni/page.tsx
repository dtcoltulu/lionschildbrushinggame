import { PageHeader } from "@/components/ui";
import { pageCtx } from "@/server/page";
import { listLookup } from "@/server/services/lookups";
import { RequestForm } from "./RequestForm";

export const dynamic = "force-dynamic";

export default async function NewRequestPage() {
  const ctx = await pageCtx("request.create");
  const locations = (await listLookup(ctx.db, "locations")).map((l) => ({ value: l.id, label: l.name }));
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Malzeme talebi" subtitle="Azalan veya biten malzeme için. Talep eden ve tarih otomatik kaydedilir." back={{ href: "/talepler", label: "Talepler" }} />
      <RequestForm locations={locations} today={ctx.today} />
    </div>
  );
}
