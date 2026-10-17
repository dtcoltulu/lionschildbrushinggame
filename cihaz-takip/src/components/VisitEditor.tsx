"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { visitToForm, type VisitValues } from "@/lib/fault-form";
import { OUTCOMES } from "@/lib/labels";
import type { Opt } from "@/server/page";
import type { Visit } from "@/server/services/faults";
import { callApi, type ApiError } from "./client";
import { ErrorBanner, Select, TextArea, TextInput } from "./form";

/** Önceki bir servis gidişini düzeltme (ör. maliyeti sonradan girme). Yeni gidiş sayılmaz. */
export function VisitEditor({ faultId, version, visit, vendors, today }: { faultId: string; version: number; visit: Visit; vendors: Opt[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<VisitValues>(visitToForm(visit));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const fe = err?.fieldErrors ?? {};
  const set = <K extends keyof VisitValues>(k: K, val: VisitValues[K]) => setV((p) => ({ ...p, [k]: val }));
  if (!open) {
    return (
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        Bu gidişi düzenle
      </button>
    );
  }
  return (
    <form
      className="mt-2 space-y-3 rounded-xl border border-slate-200 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await callApi("PATCH", `/api/arizalar/${faultId}/gidis/${visit.id}`, { version, visit: { ...v, outcome: visit.returned ? v.outcome : "" } });
        setBusy(false);
        if (!r.ok) return setErr(r);
        setOpen(false);
        setErr(null);
        router.refresh();
      }}
    >
      <ErrorBanner error={err} onReload={() => window.location.reload()} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Servis firması" value={v.vendorId} onChange={(x) => set("vendorId", x)} options={vendors} emptyLabel="Bilinmiyor" error={fe["visit.vendorId"]} />
        <TextInput label="Gönderim tarihi" type="date" max={today} value={v.sentOn} onChange={(x) => set("sentOn", x)} error={fe["visit.sentOn"]} />
        <TextInput label="Beklenen dönüş" type="date" value={v.expectedReturnOn} onChange={(x) => set("expectedReturnOn", x)} error={fe["visit.expectedReturnOn"]} />
        {visit.returned && <TextInput label="Gerçek dönüş tarihi" type="date" max={today} value={v.returnedOn} onChange={(x) => set("returnedOn", x)} error={fe["visit.returnedOn"]} />}
        <TextInput label="Tamir maliyeti (TL)" inputMode="decimal" value={v.costAmount} onChange={(x) => set("costAmount", x)} error={fe["visit.costAmount"]} hint="Boş = bilinmiyor, 0 = ücretsiz" />
        <TextInput label="Masraf tarihi" type="date" max={today} value={v.costDate} onChange={(x) => set("costDate", x)} error={fe["visit.costDate"]} />
        <TextInput label="Rapor / fiş referansı" value={v.receiptRef} onChange={(x) => set("receiptRef", x)} error={fe["visit.receiptRef"]} />
        {visit.returned && (
          <Select label="Sonuç" value={v.outcome} onChange={(x) => set("outcome", x)} options={OUTCOMES.map((o) => ({ value: o.value, label: o.label }))} error={fe["visit.outcome"]} />
        )}
        <TextArea label="Yapılan işlem" value={v.workDone} onChange={(x) => set("workDone", x)} error={fe["visit.workDone"]} rows={2} />
        <TextArea label="Servis notu" value={v.serviceNote} onChange={(x) => set("serviceNote", x)} error={fe["visit.serviceNote"]} rows={2} />
      </div>
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Kaydediliyor…" : "Gidişi kaydet"}</button>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Vazgeç</button>
      </div>
    </form>
  );
}
