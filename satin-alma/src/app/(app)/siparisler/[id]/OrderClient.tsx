"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, type ApiError } from "@/components/client";
import { ErrorBanner, TextInput } from "@/components/form";
import { VariantPicker, type PickedVariant } from "@/components/VariantPicker";
import { decimalInput, documentTotals, formatMoney, parseDecimalInput } from "@/lib/decimal";

/** Kalem ekleme (taslak veya — gerekçeyle — verilmiş sipariş). */
export function AddLine({ orderId, placed, currency }: { orderId: string; placed: boolean; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<PickedVariant | null>(null);
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [vat, setVat] = useState("");
  const [disc, setDisc] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>+ Kalem ekle</button>;
  const pq = parseDecimalInput(qty, 3);
  const pp = parseDecimalInput(price, 4);
  const t = pq && pq !== "invalid" && pp && pp !== "invalid" ? documentTotals([{ qty: pq, unitPrice: pp, discountPct: parseDecimalInput(disc) || 0, vatRate: parseDecimalInput(vat) || 0 }]) : null;
  return (
    <div className="card w-full space-y-3 p-4">
      <h3 className="text-lg font-bold">Kalem ekle</h3>
      <VariantPicker value={v} onChange={(x) => {
        setV(x);
        if (x) setVat(decimalInput(x.defaultVatRate));
      }} error={err?.fieldErrors.variantId} />
      {v && (
        <div className="grid gap-3 sm:grid-cols-4">
          <TextInput label={`Miktar (${v.orderUnit})`} inputMode="decimal" value={qty} onChange={setQty} error={err?.fieldErrors.qty} hint={v.packText} />
          <TextInput label={`Birim fiyat (${v.orderUnit}, KDV hariç)`} inputMode="decimal" value={price} onChange={setPrice} error={err?.fieldErrors.unitPrice} />
          <TextInput label="KDV %" inputMode="decimal" value={vat} onChange={setVat} error={err?.fieldErrors.vatRate} />
          <TextInput label="İskonto %" inputMode="decimal" value={disc} onChange={setDisc} error={err?.fieldErrors.discountPct} />
        </div>
      )}
      {t && <p>Kalem: {formatMoney(t.net, currency)} + KDV {formatMoney(t.vat, currency)} = <b>{formatMoney(t.total, currency)}</b></p>}
      {placed && <TextInput label="Değişiklik gerekçesi (sipariş verildi)" value={reason} onChange={setReason} error={err?.fieldErrors.changeReason} />}
      <ErrorBanner error={err} onReload={() => router.refresh()} />
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary" disabled={!v || busy} onClick={async () => {
          setBusy(true);
          const r = await callApi("POST", `/api/siparisler/${orderId}/kalemler`, { variantId: v!.id, qty, unitPrice: price, vatRate: vat, discountPct: disc, changeReason: reason });
          setBusy(false);
          if (!r.ok) return setErr(r);
          setOpen(false);
          setV(null);
          setQty("");
          setPrice("");
          setErr(null);
          router.refresh();
        }}>{busy ? "Ekleniyor…" : "Ekle"}</button>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Vazgeç</button>
      </div>
    </div>
  );
}

/** Tedarikçiye gönderilecek sipariş metni: kopyalanır; uygulama mesajı kendisi göndermez. */
export function OrderText({ orderId, canPrice }: { orderId: string; canPrice: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [withPrices, setWithPrices] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = async (prices: boolean) => {
    const r = await callApi<{ text: string }>("GET", `/api/siparisler/${orderId}/metin?fiyat=${prices ? 1 : 0}`);
    if (r.ok) setText(r.data.text);
  };
  if (text === null) return <button type="button" className="btn btn-secondary" onClick={() => load(false)}>Sipariş metnini göster</button>;
  return (
    <div className="card w-full space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">Kopyalanabilir sipariş metni</h3>
        {canPrice && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={withPrices} onChange={(e) => { setWithPrices(e.target.checked); load(e.target.checked); }} /> Fiyatları ekle
          </label>
        )}
      </div>
      <textarea className="field font-mono text-sm" rows={Math.min(16, text.split("\n").length + 1)} readOnly value={text} aria-label="Sipariş metni" />
      <button type="button" className="btn btn-primary" onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}>{copied ? "✓ Kopyalandı" : "Metni kopyala"}</button>
      <p className="text-sm text-muted">WhatsApp veya e-postaya yapıştırıp gönderin; sonra “Sipariş verildi” ile kanalı kaydedin.</p>
    </div>
  );
}

export function StartReceipt({ orderId, draftId }: { orderId: string; draftId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <div>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={async () => {
        if (draftId) return router.push(`/teslimatlar/${draftId}`);
        setBusy(true);
        const r = await callApi<{ id: string }>("POST", `/api/siparisler/${orderId}/teslimat`);
        setBusy(false);
        if (!r.ok) return setErr(r);
        router.push(`/teslimatlar/${r.data.id}`);
      }}>{draftId ? "Teslimat kontrolüne devam et" : "Ürün geldi – teslimatı kontrol et"}</button>
      <ErrorBanner error={err} />
    </div>
  );
}
