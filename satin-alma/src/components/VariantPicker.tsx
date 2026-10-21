"use client";

import { useEffect, useId, useState } from "react";
import { callApi } from "./client";

export interface PickedVariant {
  id: string;
  label: string;
  packText: string;
  orderUnit: string;
  baseUnit: string;
  packSize: string;
  code: string | null;
  categoryName: string;
  defaultVatRate: string;
  trackExpiry: boolean;
  trackLot: boolean;
}

/**
 * Katalogdan ürün arama ve seçme. Türkçe karakter ve büyük/küçük harf farkı önemsizdir; her kelime ad, marka, tip,
 * ölçü veya kodda geçmelidir ("nitril m", "kompozit a2").
 */
export function VariantPicker({ label = "Ürün", value, onChange, error, allowNone, noneLabel = "Katalogda yok", onNone, autoFocus }: {
  label?: string;
  value: PickedVariant | null;
  onChange: (v: PickedVariant | null) => void;
  error?: string;
  allowNone?: boolean;
  noneLabel?: string;
  onNone?: () => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickedVariant[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (value) return;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await callApi<{ items: PickedVariant[] }>("GET", `/api/katalog/ara?q=${encodeURIComponent(q)}`);
      setLoading(false);
      if (r.ok) setItems(r.data.items);
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, value]);

  if (value) {
    return (
      <div>
        <div className="mb-1.5 text-[15px] font-semibold">{label}</div>
        <div className="flex items-start justify-between gap-3 rounded-xl border-2 border-brand bg-brand-soft p-3">
          <div>
            <div className="font-semibold">{value.label}</div>
            <div className="text-sm text-slate-700">{value.packText}{value.code ? ` · Kod ${value.code}` : ""} · {value.categoryName}</div>
            {(value.trackExpiry || value.trackLot) && (
              <div className="text-sm text-slate-700">{[value.trackExpiry && "SKT takipli", value.trackLot && "Lot takipli"].filter(Boolean).join(" · ")}</div>
            )}
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange(null)}>
            Değiştir
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[15px] font-semibold">
        {label}
      </label>
      <input id={id} className="field" type="search" placeholder="Ürün adı, marka, ölçü veya kod yazın…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} aria-invalid={error ? true : undefined} />
      {error && <p className="mt-1 text-sm font-semibold text-red-700" role="alert">{error}</p>}
      <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto" aria-label="Arama sonuçları">
        {items.map((v) => (
          <li key={v.id}>
            <button type="button" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:border-brand" onClick={() => onChange(v)}>
              <span className="block font-semibold">{v.label}</span>
              <span className="block text-sm text-muted">{v.packText}{v.code ? ` · Kod ${v.code}` : ""}</span>
            </button>
          </li>
        ))}
        {!loading && q && !items.length && <li className="px-1 text-sm text-muted">Eşleşen ürün yok.</li>}
      </ul>
      {allowNone && (
        <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={onNone}>
          {noneLabel}
        </button>
      )}
    </div>
  );
}
