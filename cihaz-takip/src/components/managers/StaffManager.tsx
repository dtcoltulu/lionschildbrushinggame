"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { JOB_ROLES, jobRoleLabel } from "@/lib/labels";
import { matchesQuery } from "@/lib/normalize";
import type { Opt } from "@/server/page";
import type { Staff } from "@/server/services/staff";
import { callApi, type ApiError } from "../client";
import { Checkbox, ErrorBanner, Select, TextArea, TextInput } from "../form";
import { Badge } from "../ui";

interface Values {
  fullName: string;
  jobRole: string;
  locationId: string;
  workEmail: string;
  note: string;
  active: boolean;
}

const EMPTY: Values = { fullName: "", jobRole: "asistan", locationId: "", workEmail: "", note: "", active: true };

function StaffEditor({ staff, locations, onDone }: { staff: Staff | null; locations: Opt[]; onDone: (msg: string) => void }) {
  const [v, setV] = useState<Values>(
    staff ? { fullName: staff.fullName, jobRole: staff.jobRole, locationId: staff.locationId ?? "", workEmail: staff.workEmail ?? "", note: staff.note ?? "", active: staff.active } : EMPTY,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [confirmDup, setConfirmDup] = useState(false);
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((p) => ({ ...p, [k]: val }));
  const fe = err?.fieldErrors ?? {};
  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const body = { ...v, confirmDuplicate: confirmDup, version: staff?.version };
        const r = staff ? await callApi("PATCH", `/api/calisanlar/${staff.id}`, body) : await callApi("POST", "/api/calisanlar", body);
        setBusy(false);
        if (!r.ok) return setErr(r);
        setErr(null);
        onDone(staff ? `${v.fullName} güncellendi.` : `${v.fullName} eklendi.`);
        if (!staff) setV(EMPTY);
      }}
    >
      <ErrorBanner error={err} onReload={() => window.location.reload()} />
      {err?.code === "duplicate_staff" && <Checkbox label="Farklı bir kişi, yine de kaydet" checked={confirmDup} onChange={setConfirmDup} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput label="Ad soyad" required value={v.fullName} onChange={(x) => set("fullName", x)} error={fe.fullName} />
        <Select label="Görev" required value={v.jobRole} onChange={(x) => set("jobRole", x)} options={JOB_ROLES.map((r) => ({ value: r.value, label: r.label }))} error={fe.jobRole} />
        <Select label="İlgili oda / ünit" value={v.locationId} onChange={(x) => set("locationId", x)} options={locations} emptyLabel="Yok" error={fe.locationId} />
        <TextInput label="İş e-postası (gerekiyorsa)" type="email" inputMode="email" value={v.workEmail} onChange={(x) => set("workEmail", x)} error={fe.workEmail} />
        <div className="sm:col-span-2">
          <TextArea label="Not" value={v.note} onChange={(x) => set("note", x)} error={fe.note} rows={2} />
        </div>
        {staff && (
          <Checkbox label="Aktif" checked={v.active} onChange={(x) => set("active", x)} hint="Ayrılan çalışanı pasif yapın; geçmiş kayıtları korunur, yeni seçimlerde görünmez." />
        )}
      </div>
      <button className="btn btn-primary" disabled={busy}>{busy ? "Kaydediliyor…" : staff ? "Kaydet" : "Çalışanı ekle"}</button>
    </form>
  );
}

export function StaffManager({ staff, locations }: { staff: Staff[]; locations: Opt[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const list = staff.filter((s) => (showInactive || s.active) && matchesQuery(`${s.fullName} ${jobRoleLabel(s.jobRole)} ${s.locationName ?? ""}`, q));
  const done = (m: string) => {
    setMsg(m);
    setEditing(null);
    setAdding(false);
    router.refresh();
  };
  return (
    <div className="space-y-4">
      {msg && <p className="rounded-xl bg-emerald-50 px-4 py-3 font-semibold text-emerald-900" role="status">✓ {msg}</p>}
      {adding ? (
        <div className="card p-4">
          <h2 className="mb-3 text-lg font-bold">Yeni çalışan</h2>
          <StaffEditor staff={null} locations={locations} onDone={done} />
          <button type="button" className="btn btn-secondary mt-2" onClick={() => setAdding(false)}>Kapat</button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ Yeni çalışan</button>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <input className="field max-w-sm" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara: ad, görev, oda" aria-label="Çalışan ara" />
        <Checkbox label="Pasifleri de göster" checked={showInactive} onChange={setShowInactive} />
      </div>
      <ul className="space-y-2">
        {list.map((s) => (
          <li key={s.id} className="card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[17px] font-semibold">{s.fullName}</div>
                <div className="text-sm text-muted">
                  {jobRoleLabel(s.jobRole)}
                  {s.locationName ? ` · ${s.locationName}` : ""}
                  {s.workEmail ? ` · ${s.workEmail}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!s.active && <Badge tone="gray">Pasif</Badge>}
                {s.hasLogin && <Badge tone="blue">Uygulama hesabı var</Badge>}
                <Link href={`/arizalar?gorunum=tumu&kisi=${s.id}`} className="btn btn-secondary btn-sm">Kayıtları</Link>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(editing === s.id ? null : s.id)}>
                  {editing === s.id ? "Kapat" : "Düzenle"}
                </button>
              </div>
            </div>
            {editing === s.id && (
              <div className="mt-3 border-t border-slate-200 pt-3">
                <StaffEditor staff={s} locations={locations} onDone={done} />
              </div>
            )}
          </li>
        ))}
        {list.length === 0 && <li className="text-muted">Kayıt yok.</li>}
      </ul>
    </div>
  );
}
