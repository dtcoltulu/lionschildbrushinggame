"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, type ApiError } from "../client";
import { Checkbox, ErrorBanner, TextInput } from "../form";
import { Badge } from "../ui";

export interface LookupItem {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
  version: number;
  codePrefix?: string;
  codeDigits?: number;
  frequent?: boolean;
  systemKey?: string | null;
  phone?: string | null;
  note?: string | null;
}

type Kind = "locations" | "device_types" | "fault_causes" | "service_vendors";

function Editor({ kind, item, onDone }: { kind: Kind; item: LookupItem | null; onDone: (m: string) => void }) {
  const [v, setV] = useState({
    name: item?.name ?? "", sortOrder: String(item?.sortOrder ?? 100), active: item?.active ?? true,
    codePrefix: item?.codePrefix ?? "", codeDigits: String(item?.codeDigits ?? 3), frequent: item?.frequent ?? false,
    phone: item?.phone ?? "", note: item?.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const fe = err?.fieldErrors ?? {};
  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const body = { ...v, sortOrder: Number(v.sortOrder), codeDigits: Number(v.codeDigits), version: item?.version };
        const r = item ? await callApi("PATCH", `/api/listeler/${kind}/${item.id}`, body) : await callApi("POST", `/api/listeler/${kind}`, body);
        setBusy(false);
        if (!r.ok) return setErr(r);
        onDone(item ? `${v.name} güncellendi.` : `${v.name} eklendi.`);
      }}
    >
      <ErrorBanner error={err} onReload={() => window.location.reload()} />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextInput label="Ad" required value={v.name} onChange={(x) => setV((p) => ({ ...p, name: x }))} error={fe.name} />
        <TextInput label="Sıra" inputMode="numeric" value={v.sortOrder} onChange={(x) => setV((p) => ({ ...p, sortOrder: x }))} error={fe.sortOrder} hint="Küçük sayı üstte" />
        {kind === "device_types" && (
          <>
            <TextInput label="Kod öneki" value={v.codePrefix} onChange={(x) => setV((p) => ({ ...p, codePrefix: x.toUpperCase() }))} error={fe.codePrefix} hint="Örn. AER → AER-001. Değiştirmek mevcut kodları değiştirmez." />
            <TextInput label="Numara hanesi" inputMode="numeric" value={v.codeDigits} onChange={(x) => setV((p) => ({ ...p, codeDigits: x }))} error={fe.codeDigits} hint="3 → 001, 2 → 01" />
            <Checkbox label="Sık kullanılan / sık tamire giden" checked={v.frequent} onChange={(x) => setV((p) => ({ ...p, frequent: x }))} />
          </>
        )}
        {kind === "service_vendors" && (
          <>
            <TextInput label="Telefon" type="tel" inputMode="tel" value={v.phone} onChange={(x) => setV((p) => ({ ...p, phone: x }))} error={fe.phone} />
            <TextInput label="Not" value={v.note} onChange={(x) => setV((p) => ({ ...p, note: x }))} error={fe.note} />
          </>
        )}
        {item && !item.systemKey && <Checkbox label="Aktif (listelerde görünür)" checked={v.active} onChange={(x) => setV((p) => ({ ...p, active: x }))} />}
      </div>
      <button className="btn btn-primary" disabled={busy}>{busy ? "Kaydediliyor…" : item ? "Kaydet" : "Ekle"}</button>
    </form>
  );
}

export function LookupManager({ kind, title, items, help }: { kind: Kind; title: string; items: LookupItem[]; help?: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const done = (m: string) => {
    setMsg(m);
    setEditing(null);
    router.refresh();
  };
  return (
    <section className="card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(editing === "new" ? null : "new")}>{editing === "new" ? "Kapat" : "+ Ekle"}</button>
      </div>
      {help && <p className="mb-2 text-sm text-muted">{help}</p>}
      {msg && <p className="mb-2 font-semibold text-emerald-800" role="status">✓ {msg}</p>}
      {editing === "new" && <div className="mb-3 rounded-xl border border-slate-200 p-3"><Editor kind={kind} item={null} onDone={done} /></div>}
      <ul className="divide-y divide-slate-100">
        {items.map((i) => (
          <li key={i.id} className="py-2">
            <div className="flex items-center justify-between gap-2">
              <span className={i.active ? "" : "text-muted line-through"}>
                {i.name}
                {i.codePrefix && <span className="ml-2 font-mono text-sm text-muted">{i.codePrefix}-{"0".repeat((i.codeDigits ?? 3) - 1)}1</span>}
                {i.frequent && <span className="ml-2"><Badge tone="blue">sık</Badge></span>}
                {i.systemKey && <span className="ml-2 text-xs text-muted">(sistem)</span>}
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(editing === i.id ? null : i.id)}>{editing === i.id ? "Kapat" : "Düzenle"}</button>
            </div>
            {editing === i.id && <div className="mt-2 rounded-xl border border-slate-200 p-3"><Editor kind={kind} item={i} onDone={done} /></div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
