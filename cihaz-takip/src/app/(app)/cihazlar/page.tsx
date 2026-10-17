import type { Metadata } from "next";
import Link from "next/link";
import { DeviceRows } from "@/components/lists";
import { EmptyState, Notice, PageHeader } from "@/components/ui";
import { firstParam, formLookups, pageCtx } from "@/server/page";
import { DEVICE_STATUS_FILTERS, listDevices } from "@/server/services/devices";

export const metadata: Metadata = { title: "Cihaz envanteri" };
export const dynamic = "force-dynamic";

export default async function DevicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageCtx();
  const sp = await searchParams;
  const f = {
    q: firstParam(sp.q)?.slice(0, 100),
    typeId: firstParam(sp.tur),
    locationId: firstParam(sp.konum),
    durum: firstParam(sp.durum),
    staffId: firstParam(sp.kisi),
  };
  const [devices, lk] = await Promise.all([listDevices(ctx.db, ctx.today, f), formLookups(ctx.db)]);
  const filtered = Object.values(f).some(Boolean);
  return (
    <>
      <PageHeader
        title="Cihaz envanteri"
        subtitle={`${devices.length} cihaz${filtered ? " (filtreli)" : ""}`}
        actions={<Link href="/cihazlar/yeni" className="btn btn-primary">+ Cihaz ekle</Link>}
      />
      {firstParam(sp.eklendi) && (
        <div className="mb-4">
          <Notice tone="green" title="Cihazlar kaydedildi ✓">Her biri ayrı kart: {firstParam(sp.eklendi)}. Seri numaralarını kartlara tek tek girebilirsiniz.</Notice>
        </div>
      )}
      <form method="get" className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]" role="search">
        <label className="sm:col-span-2 lg:col-span-1">
          <span className="sr-only">Ara</span>
          <input name="q" defaultValue={f.q ?? ""} className="field" placeholder="Ara: ad, kod, marka, model, seri no, kişi, konum" type="search" />
        </label>
        <select name="tur" defaultValue={f.typeId ?? ""} className="field" aria-label="Tür">
          <option value="">Tüm türler</option>
          {lk.types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select name="konum" defaultValue={f.locationId ?? ""} className="field" aria-label="Oda / ünit">
          <option value="">Tüm konumlar</option>
          {lk.locations.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select name="kisi" defaultValue={f.staffId ?? ""} className="field" aria-label="Kişi">
          <option value="">Tüm kişiler</option>
          {lk.staff.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select name="durum" defaultValue={f.durum ?? ""} className="field" aria-label="Durum">
          {DEVICE_STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <div className="flex gap-2">
          <button className="btn btn-primary flex-1">Ara</button>
          {filtered && <Link href="/cihazlar" className="btn btn-secondary">Temizle</Link>}
        </div>
      </form>
      {devices.length ? (
        <DeviceRows devices={devices} />
      ) : (
        <EmptyState action={<Link href="/cihazlar/yeni" className="btn btn-primary">+ Cihaz ekle</Link>}>
          {filtered ? "Aramanıza uyan cihaz yok." : "Henüz cihaz kaydı yok."}
        </EmptyState>
      )}
    </>
  );
}
