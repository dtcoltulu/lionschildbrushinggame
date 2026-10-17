"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LIFECYCLES } from "@/lib/labels";
import type { FormLookups } from "@/server/page";
import { callApi, useDraft, type ApiError } from "../client";
import { Checkbox, Details, DraftBanner, ErrorBanner, SaveBar, Select, TextArea, TextInput } from "../form";

export interface DeviceFormValues {
  name: string;
  typeId: string;
  brand: string;
  model: string;
  serialNumber: string;
  locationId: string;
  responsibleStaffId: string;
  otherUserIds: string[];
  notes: string;
  lifecycle: string;
  inventoryCode: string;
  quantity: string;
}

export function DeviceForm({
  mode, deviceId, version: initialVersion, initial, lookups, isAdmin,
}: {
  mode: "create" | "edit";
  deviceId?: string;
  version?: number;
  initial: DeviceFormValues;
  lookups: FormLookups;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const draft = useDraft<DeviceFormValues>(mode === "create" ? "cihaz:yeni" : `cihaz:${deviceId}`, initial);
  const v = draft.value;
  const set = <K extends keyof DeviceFormValues>(k: K, val: DeviceFormValues[K]) => draft.setValue((p) => ({ ...p, [k]: val }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(initialVersion ?? 1);
  const [confirmSerial, setConfirmSerial] = useState(false);
  const [suggested, setSuggested] = useState<string | null>(null);
  const fe = err?.fieldErrors ?? {};

  useEffect(() => {
    if (mode !== "create" || !v.typeId) return;
    let alive = true;
    callApi<{ code: string | null }>("GET", `/api/cihazlar/kod-onerisi?tur=${v.typeId}`).then((r) => {
      if (alive && r.ok) setSuggested(r.data.code);
    });
    return () => {
      alive = false;
    };
  }, [mode, v.typeId]);

  async function save(overrideVersion?: number) {
    setBusy(true);
    setErr(null);
    const body = {
      ...v,
      quantity: Number(v.quantity) || 1,
      version: overrideVersion ?? version,
      confirmDuplicateSerial: confirmSerial,
    };
    const r = mode === "create"
      ? await callApi<{ ids: string[]; codes: string[] }>("POST", "/api/cihazlar", body)
      : await callApi<{ device: { id: string } }>("PATCH", `/api/cihazlar/${deviceId}`, body);
    setBusy(false);
    if (!r.ok) {
      setErr(r);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    draft.clear();
    if (mode === "create") {
      const { ids, codes } = r.data as { ids: string[]; codes: string[] };
      router.push(ids.length === 1 ? `/cihazlar/${ids[0]}?kaydedildi=yeni` : `/cihazlar?tur=${v.typeId}&eklendi=${encodeURIComponent(codes.join(", "))}`);
    } else {
      router.push(`/cihazlar/${deviceId}?kaydedildi=1`);
    }
    router.refresh();
  }

  const typeChange = (id: string) => {
    const t = lookups.types.find((x) => x.value === id);
    draft.setValue((p) => ({ ...p, typeId: id, name: p.name || (t ? t.label.replace(" (pasif)", "") : "") }));
  };
  const multi = mode === "create" && Number(v.quantity) > 1;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
    >
      <DraftBanner restored={draft.restored} onDiscard={draft.discard} />
      <ErrorBanner
        error={err}
        onReload={() => {
          draft.discard();
          router.refresh();
          setErr(null);
          window.location.reload();
        }}
        onOverwrite={() => {
          const cur = (err?.data.current as { version?: number } | undefined)?.version;
          if (cur) {
            setVersion(cur);
            void save(cur);
          }
        }}
      />
      {err?.code === "duplicate_serial" && (
        <Checkbox label="Bu farklı bir cihaz, yine de kaydet" checked={confirmSerial} onChange={setConfirmSerial} />
      )}
      <div className="card space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Cihaz türü" required value={v.typeId} onChange={typeChange} options={lookups.types} emptyLabel="Seçin…" error={fe.typeId} />
          <TextInput label="Cihaz adı" required value={v.name} onChange={(x) => set("name", x)} error={fe.name} placeholder="Örn. Aeratör, Valo ışık cihazı" />
          <TextInput label="Marka" value={v.brand} onChange={(x) => set("brand", x)} error={fe.brand} />
          <TextInput label="Model" value={v.model} onChange={(x) => set("model", x)} error={fe.model} />
          <TextInput
            label="Seri numarası"
            value={v.serialNumber}
            onChange={(x) => set("serialNumber", x)}
            error={fe.serialNumber}
            hint={multi ? "Birden fazla eklerken boş bırakın; her cihaza sonra ayrı girin." : "Bilinmiyorsa boş bırakın, sonra tamamlanabilir."}
          />
          <Select label="Oda / ünit" value={v.locationId} onChange={(x) => set("locationId", x)} options={lookups.locations} emptyLabel="Belirtilmedi" error={fe.locationId} />
          <Select label="Sorumlu çalışan" value={v.responsibleStaffId} onChange={(x) => set("responsibleStaffId", x)} options={lookups.staff} emptyLabel="Belirtilmedi" error={fe.responsibleStaffId} />
          {mode === "create" ? (
            <TextInput
              label="Adet"
              type="number"
              inputMode="numeric"
              min="1"
              max="20"
              value={v.quantity}
              onChange={(x) => set("quantity", x)}
              error={fe.quantity}
              hint="Aynı türden birden fazla cihaz varsa (ör. 3 aeratör) her biri ayrı kart ve ayrı kod alır."
            />
          ) : (
            <Select
              label="Kayıt durumu"
              value={v.lifecycle}
              onChange={(x) => set("lifecycle", x)}
              options={LIFECYCLES.filter((l) => isAdmin || l.value !== "envanterden_cikarildi" || initial.lifecycle === "envanterden_cikarildi").map((l) => ({ value: l.value, label: l.label }))}
              error={fe.lifecycle}
              hint={isAdmin ? undefined : "Envanterden çıkarma yöneticiye açıktır."}
            />
          )}
        </div>
        <Details summary="Ayrıntılar (envanter kodu, diğer kullanıcılar, notlar)" defaultOpen={mode === "edit" && (!!initial.notes || initial.otherUserIds.length > 0)}>
          <TextInput
            label="Envanter kodu"
            value={v.inventoryCode}
            onChange={(x) => set("inventoryCode", x.toUpperCase())}
            error={fe.inventoryCode}
            placeholder={mode === "create" ? (suggested ? `Otomatik: ${suggested}` : "Tür seçince otomatik verilir") : undefined}
            hint={mode === "create" ? "Boş bırakırsanız sıradaki kod otomatik verilir. Cihazda yapıştırılmış bir etiket varsa onu yazın." : isAdmin ? "Kod değişikliği işlem geçmişine yazılır." : "Envanter kodunu yalnızca yönetici değiştirebilir."}
          />
          <fieldset>
            <legend className="mb-1 text-[15px] font-semibold">Diğer kullanıcılar (biliniyorsa)</legend>
            <div className="grid max-h-64 gap-x-4 overflow-y-auto rounded-xl border border-slate-200 bg-white px-3 sm:grid-cols-2">
              {lookups.staff.map((s) => (
                <Checkbox
                  key={s.value}
                  label={s.label}
                  hint={s.group}
                  checked={v.otherUserIds.includes(s.value)}
                  onChange={(on) => set("otherUserIds", on ? [...v.otherUserIds, s.value] : v.otherUserIds.filter((x) => x !== s.value))}
                />
              ))}
              {lookups.staff.length === 0 && <p className="py-3 text-muted">Önce Çalışanlar sayfasından personel ekleyin.</p>}
            </div>
            {fe.otherUserIds && <p className="mt-1 text-sm font-semibold text-red-700">{fe.otherUserIds}</p>}
          </fieldset>
          <TextArea label="Notlar" value={v.notes} onChange={(x) => set("notes", x)} error={fe.notes} />
        </Details>
      </div>
      <SaveBar busy={busy} label={mode === "create" ? (multi ? `${v.quantity} cihazı kaydet` : "Cihazı kaydet") : "Değişiklikleri kaydet"} />
    </form>
  );
}
