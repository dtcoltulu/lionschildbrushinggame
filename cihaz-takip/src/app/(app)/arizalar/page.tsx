import type { Metadata } from "next";
import Link from "next/link";
import { FaultRows } from "@/components/lists";
import { EmptyState, Notice, PageHeader } from "@/components/ui";
import { dateParam, firstParam, formLookups, pageCtx } from "@/server/page";
import { can } from "@/server/permissions";
import { listFaults, type FaultFilters } from "@/server/services/faults";

export const metadata: Metadata = { title: "Arıza & servis" };
export const dynamic = "force-dynamic";

const VIEWS: { value: NonNullable<FaultFilters["view"]>; label: string; admin?: boolean }[] = [
  { value: "acik", label: "Açık" },
  { value: "serviste", label: "Serviste" },
  { value: "gecikti", label: "Gecikenler" },
  { value: "kapali", label: "Kapananlar" },
  { value: "tumu", label: "Tümü" },
  { value: "silme_talebi", label: "Silme talepleri", admin: true },
  { value: "silinen", label: "Silinenler", admin: true },
];

export default async function FaultsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageCtx();
  const sp = await searchParams;
  const isAdmin = can(ctx.actor, "fault.delete");
  const requested = firstParam(sp.gorunum);
  const view = VIEWS.find((v) => v.value === requested && (!v.admin || isAdmin))?.value ?? "acik";
  const f: FaultFilters = {
    view,
    staffId: firstParam(sp.kisi),
    causeId: firstParam(sp.neden),
    from: dateParam(sp.from) ?? undefined,
    to: dateParam(sp.to) ?? undefined,
    q: firstParam(sp.q)?.slice(0, 100),
  };
  const [faults, lk] = await Promise.all([listFaults(ctx.db, ctx.today, f), formLookups(ctx.db)]);
  const keep = new URLSearchParams(Object.entries({ kisi: f.staffId, neden: f.causeId, from: f.from, to: f.to, q: f.q }).filter(([, v]) => v) as [string, string][]);
  const filtered = [...keep.keys()].length > 0;
  return (
    <>
      <PageHeader title="Arıza & servis takibi" subtitle={`${faults.length} kayıt`} actions={<Link href="/arizalar/yeni" className="btn btn-primary">+ Arıza bildir</Link>} />
      {firstParam(sp.silindi) && <div className="mb-3"><Notice tone="green">Arıza kaydı silindi. Analizlerden çıkarıldı; cihaz kartı korundu. Gerekirse buradan geri alabilirsiniz.</Notice></div>}
      {firstParam(sp.kalici) && <div className="mb-3"><Notice tone="green">Kayıt kalıcı olarak silindi.</Notice></div>}
      <nav className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label="Görünüm">
        {VIEWS.filter((v) => !v.admin || isAdmin).map((v) => {
          const params = new URLSearchParams(keep);
          if (v.value !== "acik") params.set("gorunum", v.value);
          const on = v.value === view;
          return (
            <Link key={v.value} href={`/arizalar${params.size ? `?${params}` : ""}`} aria-current={on ? "page" : undefined} className={`btn btn-sm shrink-0 ${on ? "btn-primary" : "btn-secondary"}`}>
              {v.label}
            </Link>
          );
        })}
      </nav>
      <form method="get" className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_auto_auto_auto] lg:items-end" role="search">
        {view !== "acik" && <input type="hidden" name="gorunum" value={view} />}
        <input name="q" defaultValue={f.q ?? ""} className="field" placeholder="Ara: cihaz, açıklama, servis firması" type="search" aria-label="Ara" />
        <select name="kisi" defaultValue={f.staffId ?? ""} className="field" aria-label="Kişi">
          <option value="">Tüm kişiler</option>
          {lk.staff.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select name="neden" defaultValue={f.causeId ?? ""} className="field" aria-label="Neden">
          <option value="">Tüm nedenler</option>
          {lk.causes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <label className="text-sm text-muted">Fark edilme: başlangıç<input type="date" name="from" defaultValue={f.from ?? ""} className="field mt-1" /></label>
        <label className="text-sm text-muted">Fark edilme: bitiş<input type="date" name="to" defaultValue={f.to ?? ""} className="field mt-1" /></label>
        <div className="flex gap-2">
          <button className="btn btn-primary flex-1">Süz</button>
          {filtered && <Link href={`/arizalar${view !== "acik" ? `?gorunum=${view}` : ""}`} className="btn btn-secondary">Temizle</Link>}
        </div>
      </form>
      {f.staffId && (
        <div className="mb-3">
          <Notice tone="gray">
            Seçili kişinin geçtiği kayıtlar ve rolü (fark eden, son kullanıcı, doğrulanmış sorumlu) gösterilir. Arızayı fark etmek veya cihazı son kullanmak sorumluluk anlamına gelmez.
          </Notice>
        </div>
      )}
      <div className="card px-4 py-1">
        {faults.length ? <FaultRows faults={faults} staffId={f.staffId} /> : <div className="py-4"><EmptyState>Bu görünümde kayıt yok.</EmptyState></div>}
      </div>
    </>
  );
}
