"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, newKey, uploadFile, useDraft, type ApiError } from "@/components/client";
import { DraftBanner, ErrorBanner, Segmented, Select, TextArea, TextInput, type Option } from "@/components/form";
import { VariantPicker, type PickedVariant } from "@/components/VariantPicker";
import { formatDate } from "@/lib/dates";
import { formatQty } from "@/lib/decimal";
import { UNITS } from "@/lib/labels";

interface OpenNeeds {
  requests: { id: string; requestNo: string; qty: string; unitLabel: string; progressLabel: string; requesterName: string; neededBy: string | null }[];
  orders: { orderId: string; orderNo: string; pendingQty: string; unitLabel: string; expectedOn: string | null; supplierName: string }[];
}

interface Form {
  variant: PickedVariant | null;
  temp: boolean;
  tempProductText: string;
  stockState: "azaldi" | "bitti" | "";
  qty: string;
  unitKind: "siparis" | "temel";
  unitLabel: string;
  remainingQty: string;
  urgency: "normal" | "acil" | "cok_acil";
  neededBy: string;
  locationId: string;
  note: string;
  extraNeedReason: string;
}

const EMPTY: Form = {
  variant: null, temp: false, tempProductText: "", stockState: "", qty: "", unitKind: "siparis", unitLabel: "adet", remainingQty: "",
  urgency: "normal", neededBy: "", locationId: "", note: "", extraNeedReason: "",
};

/** Asistanın telefondan hızlı talebi: ürün seç → azaldı/bitti → miktar → gönder. Diğer alanlar isteğe bağlı. */
export function RequestForm({ locations, today }: { locations: Option[]; today: string }) {
  const router = useRouter();
  const draft = useDraft<Form>("talep-yeni", EMPTY);
  const f = draft.value;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => draft.setValue((s) => ({ ...s, [k]: v }));
  const [needs, setNeeds] = useState<OpenNeeds | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [key] = useState(() => newKey());

  /** Ürün seçilince aynı ürün için açık talep/beklenen sipariş gösterilir (sunucu da kayıtta ayrıca denetler). */
  const pickVariant = async (v: PickedVariant | null) => {
    set("variant", v);
    setNeeds(null);
    if (!v) return;
    const r = await callApi<OpenNeeds>("GET", `/api/talepler/acik-ihtiyac?variantId=${v.id}`);
    if (r.ok) setNeeds(r.data);
  };

  const hasNeeds = !!needs && (needs.requests.length > 0 || needs.orders.length > 0);
  const differentUnits = f.variant && f.variant.orderUnit !== f.variant.baseUnit;

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const body = {
          variantId: f.temp ? null : f.variant?.id ?? null,
          tempProductText: f.temp ? f.tempProductText : null,
          stockState: f.stockState,
          qty: f.qty,
          unitKind: f.unitKind,
          unitLabel: f.unitLabel,
          remainingQty: f.remainingQty,
          urgency: f.urgency,
          neededBy: f.neededBy,
          locationId: f.locationId,
          note: f.note,
          extraNeedReason: f.extraNeedReason,
          idempotencyKey: key,
        };
        const r = await callApi<{ request: { id: string } }>("POST", "/api/talepler", body);
        if (!r.ok) {
          setBusy(false);
          if (r.code === "duplicate_open") setNeeds(r.data.openNeeds as OpenNeeds);
          return setErr(r);
        }
        if (photo) await uploadFile("request", r.data.request.id, photo);
        draft.clear();
        router.push(`/talepler/${r.data.request.id}?yeni=1`);
      }}
    >
      <DraftBanner restored={draft.restored} onDiscard={draft.discard} />
      <ErrorBanner error={err?.code === "duplicate_open" ? null : err} />

      {f.temp ? (
        <div className="space-y-2">
          <TextArea label="Katalogda olmayan ürün" required rows={2} value={f.tempProductText} onChange={(v) => set("tempProductText", v)} error={err?.fieldErrors.tempProductText ?? err?.fieldErrors.variantId}
            hint="Marka, ölçü, renk gibi ayırt edici bilgileri yazın. Yönetim katalogdaki bir ürünle eşleştirir veya yeni ürün açar." />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => set("temp", false)}>← Katalogdan seç</button>
        </div>
      ) : (
        <VariantPicker value={f.variant} onChange={pickVariant} error={err?.fieldErrors.variantId} allowNone noneLabel="Ürün katalogda yok" onNone={() => draft.setValue((s) => ({ ...s, temp: true, variant: null }))} />
      )}

      {hasNeeds && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
          <div className="font-bold">Bu ürün için zaten açık talep veya beklenen sipariş var</div>
          <ul className="mt-1 list-disc pl-5 text-[15px]">
            {needs!.requests.map((r) => (
              <li key={r.id}>Talep {r.requestNo}: {formatQty(r.qty)} {r.unitLabel} – {r.progressLabel} ({r.requesterName}{r.neededBy ? `, ihtiyaç ${formatDate(r.neededBy)}` : ""})</li>
            ))}
            {needs!.orders.map((o) => (
              <li key={o.orderNo}>Sipariş {o.orderNo}{o.supplierName ? ` (${o.supplierName})` : ""}: {formatQty(o.pendingQty)} {o.unitLabel} bekleniyor{o.expectedOn ? `, beklenen ${formatDate(o.expectedOn)}` : ""}</li>
            ))}
          </ul>
          <p className="mt-2 text-[15px]">Mükerrer alım olmasın: gerçekten ek ihtiyaç varsa gerekçesini yazın.</p>
          <div className="mt-2">
            <TextArea label="Ek ihtiyaç gerekçesi" rows={2} value={f.extraNeedReason} onChange={(v) => set("extraNeedReason", v)} error={err?.fieldErrors.extraNeedReason} />
          </div>
        </div>
      )}

      <Segmented name="stockState" label="Durum" value={f.stockState} onChange={(v) => set("stockState", v)} error={err?.fieldErrors.stockState}
        options={[{ value: "azaldi", label: "Azaldı" }, { value: "bitti", label: "Bitti" }]} />

      <div className="grid grid-cols-2 gap-3">
        <TextInput label="İstenen miktar" required inputMode="decimal" value={f.qty} onChange={(v) => set("qty", v)} error={err?.fieldErrors.qty} />
        {f.temp ? (
          <Select label="Birim" value={f.unitLabel} onChange={(v) => set("unitLabel", v)} options={UNITS.map((u) => ({ value: u, label: u }))} />
        ) : differentUnits ? (
          <Select label="Birim" value={f.unitKind} onChange={(v) => set("unitKind", v as Form["unitKind"])}
            options={[{ value: "siparis", label: `${f.variant!.orderUnit} (${f.variant!.packText})` }, { value: "temel", label: f.variant!.baseUnit }]} />
        ) : (
          <div>
            <div className="mb-1.5 text-[15px] font-semibold">Birim</div>
            <div className="field flex items-center bg-slate-50">{f.variant?.orderUnit ?? "—"}</div>
          </div>
        )}
      </div>

      <Segmented name="urgency" label="Aciliyet" value={f.urgency} onChange={(v) => set("urgency", v)}
        options={[{ value: "normal", label: "Normal" }, { value: "acil", label: "Acil" }, { value: "cok_acil", label: "Çok acil (bugün)" }]} />

      <details className="rounded-xl border border-slate-200 bg-slate-50/60">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 font-semibold">İsteğe bağlı: kalan miktar, tarih, oda, açıklama, fotoğraf <span aria-hidden>▾</span></summary>
        <div className="space-y-4 border-t border-slate-200 px-4 py-4">
          <TextInput label="Elde kalan miktar (yaklaşık)" inputMode="decimal" value={f.remainingQty} onChange={(v) => set("remainingQty", v)} error={err?.fieldErrors.remainingQty}
            hint="Talep edenin tahmini; stok sayımı değildir." />
          <TextInput label="İhtiyaç tarihi" type="date" min={today} value={f.neededBy} onChange={(v) => set("neededBy", v)} error={err?.fieldErrors.neededBy} />
          <Select label="Kullanılacağı oda / bölüm" value={f.locationId} onChange={(v) => set("locationId", v)} options={locations} emptyLabel="Seçilmedi" />
          <TextArea label="Açıklama" value={f.note} onChange={(v) => set("note", v)} error={err?.fieldErrors.note} hint="Hasta bilgisi yazmayın." />
          <label className="btn btn-secondary">
            {photo ? `Fotoğraf: ${photo.name}` : "Fotoğraf ekle (ambalaj, etiket)"}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </label>
        </div>
      </details>

      <button type="submit" className="btn btn-primary w-full text-lg" disabled={busy}>
        {busy ? "Gönderiliyor…" : "Talebi gönder"}
      </button>
    </form>
  );
}
