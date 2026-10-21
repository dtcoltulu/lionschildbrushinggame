"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, type ApiError } from "@/components/client";
import { Checkbox, ErrorBanner, Select, TextInput, type Option } from "@/components/form";
import { formatQty, parseDecimalInput } from "@/lib/decimal";
import { UNITS } from "@/lib/labels";
import type { VariantValues } from "@/lib/variant-form";

/**
 * Ürün varyantı formu. Farklı marka, ölçü, tip veya paket içeriği AYRI varyanttır. Aynı ürün adı yazılırsa (Türkçe karakter ve
 * büyük/küçük harf farkı olmadan) mevcut ürünün altına eklenir; benzer ad varsa onay istenir.
 */
export function VariantForm(p: {
  mode: "create" | "edit" | "match";
  initial: VariantValues;
  categories: Option[];
  suppliers: Option[];
  variantId?: string;
  version?: number;
  match?: { requestId: string; version: number; unitLabel: string };
}) {
  const router = useRouter();
  const [v, setV] = useState<VariantValues>(p.initial);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [unitKind, setUnitKind] = useState("siparis");
  const set = <K extends keyof VariantValues>(k: K, x: VariantValues[K]) => setV((s) => ({ ...s, [k]: x }));
  const units = UNITS.map((u) => ({ value: u, label: u }));
  const pack = parseDecimalInput(v.packSize, 3);

  const submit = async (confirmSimilar = false) => {
    setBusy(true);
    setErr(null);
    const body = {
      ...v,
      packSize: v.orderUnit === v.baseUnit ? "1" : v.packSize,
      minShelfLifeDays: v.trackExpiry ? v.minShelfLifeDays : "",
      suppliers: v.suppliers.map((supplierId, i) => ({ supplierId, preference: i + 1 })),
      confirmSimilar,
      ...(p.mode === "edit" ? { version: p.version } : {}),
    };
    const r =
      p.mode === "edit"
        ? await callApi<{ variant: { id: string } }>("PATCH", `/api/katalog/${p.variantId}`, body)
        : p.mode === "match"
          ? await callApi<{ request: { id: string } }>("POST", `/api/talepler/${p.match!.requestId}/eslestir`, { version: p.match!.version, unitKind, newVariant: body })
          : await callApi<{ variant: { id: string } }>("POST", "/api/katalog", body);
    setBusy(false);
    if (!r.ok) return setErr(r);
    if (p.mode === "match") router.push(`/talepler/${p.match!.requestId}`);
    else if (p.mode === "create") router.push(`/katalog/${(r.data as { variant: { id: string } }).variant.id}?yeni=1`);
    else router.refresh();
  };

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
      {err?.code === "similar_product" ? (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
          <div className="font-bold">Benzer adlı ürün var</div>
          <p className="mt-1">{err.error}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(err.data.similar as { id: string; name: string }[]).map((s) => (
              <button key={s.id} type="button" className="btn btn-secondary btn-sm" onClick={() => { set("productName", s.name); setErr(null); }}>“{s.name}” adını kullan</button>
            ))}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => submit(true)}>Yine de yeni ürün olarak ekle</button>
          </div>
        </div>
      ) : err?.code === "duplicate_variant" ? (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
          <div className="font-bold">Bu varyant katalogda zaten var</div>
          <p className="mt-1">{err.error}</p>
          {typeof err.data.existingId === "string" && <Link className="btn btn-secondary btn-sm mt-2" href={`/katalog/${err.data.existingId}`}>Mevcut kaydı aç</Link>}
        </div>
      ) : (
        <ErrorBanner error={err} onReload={() => router.refresh()} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput label="Ürün adı (genel)" required value={v.productName} onChange={(x) => set("productName", x)} error={err?.fieldErrors.productName}
          hint="Örn. “Nitril muayene eldiveni”. Marka ve ölçüyü aşağıya yazın." placeholder="Nitril muayene eldiveni" />
        <Select label="Kategori" required value={v.categoryId} onChange={(x) => set("categoryId", x)} options={p.categories} emptyLabel="Seçin…" error={err?.fieldErrors.categoryId} />
        <TextInput label="Marka" value={v.brand} onChange={(x) => set("brand", x)} error={err?.fieldErrors.brand} />
        <TextInput label="Tip / model / seri" value={v.model} onChange={(x) => set("model", x)} error={err?.fieldErrors.model} />
        <TextInput label="Ölçü, boyut, renk…" value={v.attributes} onChange={(x) => set("attributes", x)} error={err?.fieldErrors.attributes} hint="Örn. “M beden”, “A2 · 4 g”, “25 mm No 15”" />
        <TextInput label="Ürün kodu / barkod" value={v.code} onChange={(x) => set("code", x)} error={err?.fieldErrors.code} />
      </div>
      <fieldset className="rounded-xl border border-slate-200 p-4">
        <legend className="px-1 font-semibold">Birim ve paket içeriği</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Sipariş birimi" value={v.orderUnit} onChange={(x) => set("orderUnit", x)} options={units} error={err?.fieldErrors.orderUnit} />
          <Select label="Temel birim" value={v.baseUnit} onChange={(x) => set("baseUnit", x)} options={units} error={err?.fieldErrors.baseUnit} />
          {v.orderUnit !== v.baseUnit && (
            <TextInput label={`1 ${v.orderUnit} kaç ${v.baseUnit}?`} required inputMode="decimal" value={v.packSize} onChange={(x) => set("packSize", x)} error={err?.fieldErrors.packSize} />
          )}
        </div>
        <p className="mt-2 text-sm text-muted">
          {v.orderUnit === v.baseUnit ? `Sipariş ve sayım birimi aynı: ${v.orderUnit}.` : pack && pack !== "invalid" ? `1 ${v.orderUnit} = ${formatQty(pack)} ${v.baseUnit}. Kutu fiyatı ile adet fiyatı bu dönüşümle karşılaştırılır.` : "Paket içeriğini yazın."}
        </p>
        <div className="mt-3 max-w-40">
          <TextInput label="Varsayılan KDV %" inputMode="decimal" value={v.defaultVatRate} onChange={(x) => set("defaultVatRate", x)} error={err?.fieldErrors.defaultVatRate} />
        </div>
      </fieldset>
      <fieldset className="rounded-xl border border-slate-200 p-4">
        <legend className="px-1 font-semibold">Teslimat kontrolü</legend>
        <Checkbox label="Son kullanma tarihi takibi gerekli" checked={v.trackExpiry} onChange={(x) => set("trackExpiry", x)} hint="Teslim alırken SKT girilmeden kabul edilemez; geçmiş tarihli ürün hiç kabul edilmez." />
        {v.trackExpiry && (
          <div className="max-w-xs">
            <TextInput label="En az kalan raf ömrü (gün)" inputMode="numeric" value={v.minShelfLifeDays} onChange={(x) => set("minShelfLifeDays", x)} error={err?.fieldErrors.minShelfLifeDays} hint="Altındaki ürün yönetim incelemesine düşer. Boş = sınır yok." />
          </div>
        )}
        <Checkbox label="Lot / parti numarası takibi gerekli" checked={v.trackLot} onChange={(x) => set("trackLot", x)} hint="Lot numarası olmayan ürün doğrudan kabul edilemez." />
      </fieldset>
      <fieldset className="rounded-xl border border-slate-200 p-4">
        <legend className="px-1 font-semibold">Tercih edilen tedarikçiler (sırayla)</legend>
        {p.suppliers.length ? p.suppliers.map((s) => {
          const idx = v.suppliers.indexOf(s.value);
          return (
            <Checkbox key={s.value} label={`${s.label}${idx >= 0 ? ` (${idx + 1}. tercih)` : ""}`} checked={idx >= 0}
              onChange={(on) => set("suppliers", on ? [...v.suppliers, s.value] : v.suppliers.filter((x) => x !== s.value))} />
          );
        }) : <p className="text-sm text-muted">Henüz tedarikçi yok.</p>}
      </fieldset>
      {p.mode === "edit" && <Checkbox label="Aktif (yeni taleplerde seçilebilir)" checked={v.active} onChange={(x) => set("active", x)} />}
      {p.mode === "match" && (
        <Select label={`Talepteki “${p.match!.unitLabel}” birimi`} value={unitKind} onChange={setUnitKind}
          options={[{ value: "siparis", label: `Sipariş birimi (${v.orderUnit})` }, ...(v.orderUnit !== v.baseUnit ? [{ value: "temel", label: `Temel birim (${v.baseUnit})` }] : [])]} />
      )}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Kaydediliyor…" : p.mode === "edit" ? "Değişiklikleri kaydet" : p.mode === "match" ? "Ürünü aç ve talebi eşleştir" : "Kataloğa ekle"}
      </button>
    </form>
  );
}

