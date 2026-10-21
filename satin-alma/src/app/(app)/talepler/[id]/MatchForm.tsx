"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, type ApiError } from "@/components/client";
import { ErrorBanner, Select } from "@/components/form";
import { VariantPicker, type PickedVariant } from "@/components/VariantPicker";

/** Katalog dışı talebi mevcut ürünle eşleştirme ya da talepteki tanımdan yeni ürün açma. */
export function MatchForm({ requestId, version, unitLabel }: { requestId: string; version: number; unitLabel: string }) {
  const router = useRouter();
  const [v, setV] = useState<PickedVariant | null>(null);
  const [unitKind, setUnitKind] = useState("siparis");
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <VariantPicker label="Katalogdaki karşılığı" value={v} onChange={(x) => {
        setV(x);
        if (x) setUnitKind(x.baseUnit === unitLabel && x.orderUnit !== unitLabel ? "temel" : "siparis");
      }} />
      {v && (
        <Select label={`Talepteki “${unitLabel}” birimi neye karşılık geliyor?`} value={unitKind} onChange={setUnitKind}
          options={[{ value: "siparis", label: `Sipariş birimi: ${v.orderUnit} (${v.packText})` }, ...(v.orderUnit !== v.baseUnit ? [{ value: "temel", label: `Temel birim: ${v.baseUnit}` }] : [])]} />
      )}
      <ErrorBanner error={err} onReload={() => router.refresh()} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={!v || busy} onClick={async () => {
          setBusy(true);
          const r = await callApi("POST", `/api/talepler/${requestId}/eslestir`, { version, variantId: v!.id, unitKind });
          setBusy(false);
          if (!r.ok) return setErr(r);
          router.refresh();
        }}>
          Bu ürünle eşleştir
        </button>
        <Link className="btn btn-secondary" href={`/katalog/yeni?talep=${requestId}`}>Katalogda yok: yeni ürün olarak aç</Link>
      </div>
    </div>
  );
}
