import Link from "next/link";
import { FaultRows } from "@/components/lists";
import { Card, EmptyState, Notice, PageHeader, StatTile } from "@/components/ui";
import { monthLabel } from "@/lib/dates";
import { formatTL } from "@/lib/money";
import { firstParam, pageCtx } from "@/server/page";
import { can } from "@/server/permissions";
import { overview } from "@/server/services/analytics";
import { listFaults } from "@/server/services/faults";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageCtx();
  const sp = await searchParams;
  const [o, open] = await Promise.all([overview(ctx.db, ctx.today), listFaults(ctx.db, ctx.today, { view: "acik" })]);
  const overdue = open.filter((f) => f.display.key === "gecikti");
  const showCost = can(ctx.actor, "costs.view");
  const b = o.unusableBreakdown;
  const breakdown = [
    b.arizali && `${b.arizali} arızalı`,
    b.serviste && `${b.serviste} serviste`,
    b.sorun && `${b.sorun} tamirden geldi, sorun sürüyor/denenmedi`,
    b.kullanimDisi && `${b.kullanimDisi} kullanım dışı`,
  ].filter(Boolean).join(" · ");
  return (
    <>
      <PageHeader
        title="Genel bakış"
        subtitle={`Merhaba ${ctx.actor.displayName}`}
        actions={
          <>
            <Link href="/arizalar/yeni" className="btn btn-primary">+ Arıza bildir</Link>
            <Link href="/cihazlar/yeni" className="btn btn-secondary">+ Cihaz ekle</Link>
          </>
        }
      />
      {firstParam(sp.yetki) === "yok" && (
        <div className="mb-4">
          <Notice tone="amber">Bu sayfa yalnızca yöneticiye açıktır.</Notice>
        </div>
      )}
      <div className={`grid grid-cols-2 gap-3 ${showCost ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        <StatTile label="Toplam cihaz" value={o.totalDevices} hint="Envanterdeki (çıkarılanlar hariç)" href="/cihazlar" />
        <StatTile label="Kullanım dışı (şu an)" value={o.unusable} hint={breakdown || "Hepsi kullanılabilir"} href="/cihazlar?durum=kullanilamaz" tone={o.unusable ? "red" : undefined} />
        <StatTile label="Servisteki cihazlar" value={o.inService} href="/arizalar?gorunum=serviste" tone={o.inService ? "amber" : undefined} />
        <StatTile label="Geciken servisler" value={o.overdue} hint="Beklenen dönüş tarihi geçmiş" href="/arizalar?gorunum=gecikti" tone={o.overdue ? "orange" : undefined} />
        {showCost && <StatTile label={`Bu ayın tamir maliyeti`} value={formatTL(o.thisMonthCost)} hint={monthLabel(ctx.today.slice(0, 7))} href="/analizler#maliyet" />}
      </div>
      {can(ctx.actor, "fault.delete") && o.deletionRequests > 0 && (
        <div className="mt-4">
          <Notice tone="amber" title={`${o.deletionRequests} kayıt için silme talebi var`}>
            <Link href="/arizalar?gorunum=silme_talebi" className="font-semibold underline">Talepleri incele</Link>
          </Notice>
        </div>
      )}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title={`Açık arızalar (${open.length})`} actions={<Link href="/arizalar" className="text-[15px] font-semibold text-brand hover:underline">Tümü →</Link>}>
          {open.length ? <FaultRows faults={open.slice(0, 8)} compact /> : <EmptyState>Açık arıza yok.</EmptyState>}
        </Card>
        <Card title={`Geciken servisler (${overdue.length})`} actions={<Link href="/arizalar?gorunum=gecikti" className="text-[15px] font-semibold text-brand hover:underline">Tümü →</Link>}>
          {overdue.length ? <FaultRows faults={overdue} compact /> : <EmptyState>Beklenen dönüş tarihi geçmiş servis yok.</EmptyState>}
        </Card>
      </div>
    </>
  );
}
