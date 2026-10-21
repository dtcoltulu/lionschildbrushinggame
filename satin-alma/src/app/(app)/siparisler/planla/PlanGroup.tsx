"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { callApi, type ApiError } from "@/components/client";
import { Checkbox, ErrorBanner, Select, TextInput } from "@/components/form";
import { formatDate } from "@/lib/dates";
import { dec, decimalInput, documentTotals, formatMoney, formatPrice, formatQty, parseDecimalInput } from "@/lib/decimal";

export interface PlanRequest {
  id: string;
  requestNo: string;
  requesterName: string;
  qty: string;
  unitLabel: string;
  urgency: string;
  neededBy: string | null;
  freeBase: string;
  status: string;
}

export interface PlanPrice {
  source: string;
  date: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  perOrderUnitExcl: string;
  perBaseUnitExcl: string;
  perOrderUnitIncl: string;
  unitPrice: string;
}

/**
 * Bir ürün için bekleyen talepler → tek sipariş kalemi. Talepler birleştirilebilir, bir talep kısmen bu tedarikçiye bağlanıp
 * kalanı başka tedarikçiye bölünebilir. Tedarikçi ve fiyatı kullanıcı seçer; sistem en ucuzu otomatik seçmez.
 */
export function PlanGroup(p: {
  variantId: string;
  label: string;
  packText: string;
  orderUnit: string;
  baseUnit: string;
  packSize: string;
  defaultVatRate: string;
  requests: PlanRequest[];
  suppliers: { value: string; label: string; currency: string }[];
  preferred: string[];
  prices: PlanPrice[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, string>>(() => Object.fromEntries(p.requests.map((r) => [r.id, decimalInput(r.freeBase)])));
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(p.requests.map((r) => [r.id, true])));
  const [supplierId, setSupplierId] = useState(p.preferred[0] ?? "");
  const lastFrom = (sid: string) => p.prices.find((x) => x.supplierId === sid && x.source !== "teklif") ?? p.prices.find((x) => x.supplierId === sid);
  const [price, setPrice] = useState(() => (supplierId && lastFrom(supplierId) ? decimalInput(lastFrom(supplierId)!.unitPrice) : ""));
  const [vatRate, setVatRate] = useState(decimalInput(p.defaultVatRate));
  const [discountPct, setDiscountPct] = useState("");
  const totalBase = useMemo(
    () => p.requests.filter((r) => on[r.id]).reduce((a, r) => a.plus(dec(parseDecimalInput(picked[r.id] ?? "", 3) === "invalid" ? 0 : parseDecimalInput(picked[r.id] ?? "", 3) ?? 0)), dec(0)),
    [p.requests, on, picked],
  );
  const suggested = totalBase.div(dec(p.packSize)).ceil();
  const [qty, setQty] = useState(() => decimalInput(suggested.toFixed()));
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const pq = parseDecimalInput(qty, 3);
  const pp = parseDecimalInput(price, 4);
  const preview = pq && pq !== "invalid" && pp && pp !== "invalid" ? documentTotals([{ qty: pq, unitPrice: pp, discountPct: parseDecimalInput(discountPct) || 0, vatRate: parseDecimalInput(vatRate) || 0 }]) : null;
  const currency = p.suppliers.find((s) => s.value === supplierId)?.currency ?? "TRY";
  const rank = (id: string) => (p.preferred.includes(id) ? p.preferred.indexOf(id) : 99);
  const supplierOptions = [...p.suppliers].sort((a, b) => rank(a.value) - rank(b.value)).map((s) => ({
    ...s, label: p.preferred.includes(s.value) ? `${s.label} (tercih ${p.preferred.indexOf(s.value) + 1})` : s.label,
  }));

  return (
    <section className="card p-4" id={`v-${p.variantId}`}>
      <h2 className="text-lg font-bold">{p.label}</h2>
      <p className="text-sm text-muted">{p.packText}</p>

      <fieldset className="mt-3">
        <legend className="text-[15px] font-semibold">Talepler (bu siparişte karşılanacak miktar, {p.baseUnit})</legend>
        <ul className="mt-1 divide-y divide-slate-100">
          {p.requests.map((r) => (
            <li key={r.id} className="grid items-center gap-2 py-2 sm:grid-cols-[1fr_10rem]">
              <Checkbox
                checked={!!on[r.id]}
                onChange={(v) => setOn((s) => ({ ...s, [r.id]: v }))}
                label={<><Link className="underline" href={`/talepler/${r.id}`}>{r.requestNo}</Link> · {r.requesterName} · {formatQty(r.qty)} {r.unitLabel}</>}
                hint={[r.urgency !== "normal" && (r.urgency === "acil" ? "ACİL" : "ÇOK ACİL"), r.neededBy && `ihtiyaç ${formatDate(r.neededBy)}`, r.status === "beklemede" && "değerlendirme bekliyor (eklenince onaylanır)"].filter(Boolean).join(" · ") || undefined}
              />
              <input className="field" inputMode="decimal" aria-label={`${r.requestNo} karşılanacak miktar`} value={picked[r.id] ?? ""} disabled={!on[r.id]} onChange={(e) => setPicked((s) => ({ ...s, [r.id]: e.target.value }))} />
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">Toplam: {formatQty(totalBase)} {p.baseUnit}{p.orderUnit !== p.baseUnit ? ` ≈ ${formatQty(suggested)} ${p.orderUnit}` : ""}. Bir talebin bir kısmını burada bırakıp kalanını başka tedarikçiye ekleyebilirsiniz.</p>
      </fieldset>

      {p.prices.length > 0 && (
        <details className="mt-3 rounded-xl border border-slate-200">
          <summary className="cursor-pointer px-3 py-2 font-semibold">Fiyat geçmişi ve teklifler (aynı temelde: KDV hariç, iskonto düşülmüş)</summary>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-slate-50 text-muted"><tr><th className="px-2 py-1 text-left">Kaynak</th><th className="px-2 py-1 text-left">Tarih</th><th className="px-2 py-1 text-left">Tedarikçi</th><th className="px-2 py-1 text-right">{p.orderUnit} başına</th><th className="px-2 py-1 text-right">{p.baseUnit} başına</th></tr></thead>
              <tbody>
                {p.prices.slice(0, 10).map((x, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-2 py-1">{x.source === "fatura" ? "Fatura" : x.source === "siparis" ? "Sipariş" : "Teklif"}</td>
                    <td className="px-2 py-1">{formatDate(x.date)}</td>
                    <td className="px-2 py-1">{x.supplierName}</td>
                    <td className="px-2 py-1 text-right">{formatPrice(x.perOrderUnitExcl, x.currency)}</td>
                    <td className="px-2 py-1 text-right">{formatPrice(x.perBaseUnitExcl, x.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="sm:col-span-2">
          <Select label="Tedarikçi" required value={supplierId} emptyLabel="Seçin…" options={supplierOptions} error={err?.fieldErrors.supplierId}
            onChange={(v) => {
              setSupplierId(v);
              const last = lastFrom(v);
              if (last) setPrice(decimalInput(last.unitPrice));
            }} />
        </div>
        <TextInput label={`Miktar (${p.orderUnit})`} required inputMode="decimal" value={qty} onChange={setQty} error={err?.fieldErrors.qty}
          hint={qty !== decimalInput(suggested.toFixed()) ? <button type="button" className="underline" onClick={() => setQty(decimalInput(suggested.toFixed()))}>Seçilen taleplere göre: {formatQty(suggested)}</button> : undefined} />
        <TextInput label={`Birim fiyat (${p.orderUnit}, KDV hariç)`} required inputMode="decimal" value={price} onChange={setPrice} error={err?.fieldErrors.unitPrice} />
        <TextInput label="KDV %" inputMode="decimal" value={vatRate} onChange={setVatRate} error={err?.fieldErrors.vatRate} />
        <TextInput label="İskonto %" inputMode="decimal" value={discountPct} onChange={setDiscountPct} error={err?.fieldErrors.discountPct} />
      </div>
      {preview && <p className="mt-2 text-[15px]">Kalem: {formatMoney(preview.net, currency)} + KDV {formatMoney(preview.vat, currency)} = <b>{formatMoney(preview.total, currency)}</b></p>}
      <div className="mt-3"><ErrorBanner error={err} onReload={() => router.refresh()} /></div>
      {done ? (
        <p className="mt-3 font-semibold text-emerald-800">✓ Sipariş taslağına eklendi. <Link className="underline" href={`/siparisler/${done}`}>Siparişi aç →</Link></p>
      ) : (
        <button type="button" className="btn btn-primary mt-3" disabled={busy || !supplierId}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            const allocations = p.requests.filter((r) => on[r.id] && picked[r.id]).map((r) => ({ requestId: r.id, qtyBase: picked[r.id] }));
            const r = await callApi<{ orderId: string }>("POST", "/api/siparisler/planla", { supplierId, variantId: p.variantId, qty, unitPrice: price, vatRate, discountPct, allocations });
            setBusy(false);
            if (!r.ok) return setErr(r);
            // Sayfa yenilenmez: aksi hâlde tamamen bağlanan talepler listeden kalkar ve bu bağlantı kaybolur.
            setDone(r.data.orderId);
          }}>
          {busy ? "Ekleniyor…" : "Sipariş taslağına ekle"}
        </button>
      )}
    </section>
  );
}
