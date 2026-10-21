"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { callApi, newKey, uploadFile, type ApiError } from "@/components/client";
import { Checkbox, ErrorBanner, Select, TextInput, type Option } from "@/components/form";
import { addDays, formatDate } from "@/lib/dates";
import { dec, decimalInput, documentTotals, formatMoney, formatPrice, formatQty, parseDecimalInput } from "@/lib/decimal";
import { CURRENCIES } from "@/lib/labels";

interface Invoiceable {
  orderLineId: string;
  orderId: string;
  orderNo: string;
  lineNo: number;
  currency: string;
  label: string;
  qty: string;
  canceledQty: string;
  unitLabel: string;
  unitPrice: string;
  discountPct: string;
  vatRate: string;
  accepted: string;
  invoiced: string;
  uninvoicedAccepted: string;
}

interface Row {
  orderLineId: string | null;
  description: string;
  on: boolean;
  qty: string;
  unitPrice: string;
  discountPct: string;
  vatRate: string;
  ref?: Invoiceable;
}

const pd = (s: string, scale = 2) => {
  const v = parseDecimalInput(s, scale);
  return v && v !== "invalid" ? v : "0";
};

/** Fatura girişi: kalemler sipariş kalemlerine bağlanır; sipariş fiyatı ve kabul edilen miktar öneri olarak gelir, faturadaki değer yazılır. */
export function InvoiceForm({ suppliers, today, initialSupplier }: { suppliers: (Option & { currency: string; dueDays: number | null })[]; today: string; initialSupplier: string | null }) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(initialSupplier ?? "");
  const supplier = suppliers.find((s) => s.value === supplierId);
  const dueFor = (date: string, s = supplier) => (s?.dueDays != null && date ? addDays(date, s.dueDays) : "");
  const [currency, setCurrency] = useState(supplier?.currency ?? "TRY");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(() => dueFor(today));
  const [shippingAmount, setShipping] = useState("");
  const [shippingVatRate, setShippingVat] = useState("20");
  const [declaredTotal, setDeclared] = useState("");
  const [fx, setFx] = useState({ fxRate: "", fxDate: "", fxSource: "" });
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [receipts, setReceipts] = useState<{ id: string; receiptNo: string; receivedOn: string; orderNo: string; invoiced: boolean }[]>([]);
  const [receiptIds, setReceiptIds] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => newKey());

  useEffect(() => {
    if (!supplierId) return;
    callApi<{ lines: Invoiceable[]; receipts: typeof receipts }>("GET", `/api/faturalar/kalemler/${supplierId}`).then((r) => {
      if (!r.ok) return setErr(r);
      setReceipts(r.data.receipts);
      setRows(r.data.lines.map((l) => {
        const open = dec(l.uninvoicedAccepted).gt(0);
        return { orderLineId: l.orderLineId, description: "", on: open, qty: decimalInput(open ? l.uninvoicedAccepted : "0"), unitPrice: decimalInput(l.unitPrice), discountPct: decimalInput(l.discountPct), vatRate: decimalInput(l.vatRate), ref: l };
      }));
    });
  }, [supplierId]);

  const chooseSupplier = (id: string) => {
    const s = suppliers.find((x) => x.value === id);
    setSupplierId(id);
    setRows([]);
    setCurrency(s?.currency ?? "TRY");
    setDueDate(dueFor(invoiceDate, s));
  };

  const active = rows.filter((r) => r.on && (r.ref ? r.ref.currency === currency : true));
  const totals = documentTotals(active.map((r) => ({ qty: pd(r.qty, 3), unitPrice: pd(r.unitPrice, 4), discountPct: pd(r.discountPct), vatRate: pd(r.vatRate) })), { amount: pd(shippingAmount), vatRate: pd(shippingVatRate) });
  const upd = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const declaredDiff = declaredTotal && parseDecimalInput(declaredTotal) !== "invalid" && parseDecimalInput(declaredTotal) ? dec(pd(declaredTotal)).minus(dec(totals.total)) : null;

  return (
    <form className="space-y-5" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setErr(null);
      const r = await callApi<{ id: string }>("POST", "/api/faturalar", {
        supplierId, invoiceNo, invoiceDate, dueDate, currency, shippingAmount, shippingVatRate, declaredTotal, note, receiptIds, idempotencyKey: key, ...fx,
        lines: active.map((x) => ({ orderLineId: x.orderLineId, description: x.description, qty: x.qty, unitPrice: x.unitPrice, discountPct: x.discountPct, vatRate: x.vatRate })),
      });
      if (!r.ok) {
        setBusy(false);
        return setErr(r);
      }
      if (file) await uploadFile("invoice", r.data.id, file);
      router.push(`/finans/faturalar/${r.data.id}?yeni=1`);
    }}>
      {err?.code === "duplicate_invoice" ? (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-900">
          <div className="font-bold">Bu fatura zaten kayıtlı – ikinci kez borç yazılmadı.</div>
          <p className="mt-1">{err.error}</p>
          {typeof err.data.existingId === "string" && <Link className="btn btn-secondary btn-sm mt-2" href={`/finans/faturalar/${err.data.existingId}`}>Kayıtlı faturayı aç</Link>}
        </div>
      ) : <ErrorBanner error={err} />}
      <div className="card grid gap-3 p-4 sm:grid-cols-3">
        <Select label="Tedarikçi" required value={supplierId} onChange={chooseSupplier} options={suppliers} emptyLabel="Seçin…" error={err?.fieldErrors.supplierId} />
        <TextInput label="Fatura numarası" required value={invoiceNo} onChange={setInvoiceNo} error={err?.fieldErrors.invoiceNo} />
        <TextInput label="Fatura tarihi" type="date" max={today} value={invoiceDate} onChange={(d) => { setInvoiceDate(d); setDueDate(dueFor(d)); }} error={err?.fieldErrors.invoiceDate} />
        <TextInput label="Vade tarihi" type="date" value={dueDate} onChange={setDueDate} error={err?.fieldErrors.dueDate} hint={supplier?.dueDays != null ? `Tedarikçi vadesi ${supplier.dueDays} gün` : undefined} />
        <Select label="Para birimi" value={currency} onChange={setCurrency} options={CURRENCIES.items.map((c) => ({ value: c.value, label: c.label }))} />
        <TextInput label="Faturada yazan genel toplam (kontrol için)" inputMode="decimal" value={declaredTotal} onChange={setDeclared} error={err?.fieldErrors.declaredTotal} />
        {currency !== "TRY" && (
          <>
            <TextInput label={`Kur (1 ${currency} = ? TL, isteğe bağlı)`} inputMode="decimal" value={fx.fxRate} onChange={(v) => setFx((s) => ({ ...s, fxRate: v }))} error={err?.fieldErrors.fxRate} />
            <TextInput label="Kur tarihi" type="date" value={fx.fxDate} onChange={(v) => setFx((s) => ({ ...s, fxDate: v }))} />
            <TextInput label="Kur kaynağı" value={fx.fxSource} onChange={(v) => setFx((s) => ({ ...s, fxSource: v }))} error={err?.fieldErrors.fxSource} placeholder="TCMB döviz satış" />
          </>
        )}
      </div>

      <section className="card p-4">
        <h2 className="text-lg font-bold">Fatura kalemleri</h2>
        <p className="text-sm text-muted">Faturalanacak sipariş kalemlerini işaretleyin ve faturadaki miktar/fiyatı yazın (KDV hariç birim fiyat). Sipariş fiyatı ve kabul edilen teslimat yanda görünür; fark varsa kayıtta uyarı oluşur.</p>
        {!supplierId && <p className="mt-2 text-muted">Önce tedarikçiyi seçin.</p>}
        <ul className="mt-3 space-y-3">
          {rows.map((r, i) => {
            if (r.ref && r.ref.currency !== currency) return null;
            const ref = r.ref;
            const priceDiff = ref && r.on && (!dec(pd(r.unitPrice, 4)).eq(dec(ref.unitPrice)) || !dec(pd(r.discountPct)).eq(dec(ref.discountPct)));
            const qtyOver = ref && r.on && dec(pd(r.qty, 3)).plus(dec(ref.invoiced)).gt(dec(ref.accepted));
            return (
              <li key={i} className={`rounded-xl border p-3 ${r.on ? "border-brand bg-brand-soft/40" : "border-slate-200"}`}>
                {ref ? (
                  <Checkbox checked={r.on} onChange={(v) => upd(i, { on: v })}
                    label={<>{ref.orderNo} · {ref.lineNo}. {ref.label}</>}
                    hint={`Sipariş ${formatQty(dec(ref.qty).minus(dec(ref.canceledQty)))} ${ref.unitLabel} × ${formatPrice(ref.unitPrice, ref.currency)} · kabul edilen ${formatQty(ref.accepted)} · daha önce faturalanan ${formatQty(ref.invoiced)}`} />
                ) : (
                  <TextInput label="Sipariş dışı kalem açıklaması (kargo, hizmet, katalog dışı ürün)" value={r.description} onChange={(v) => upd(i, { description: v })} error={err?.fieldErrors[`lines.${i}.description`]} />
                )}
                {r.on && (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <TextInput label={`Miktar${ref ? ` (${ref.unitLabel})` : ""}`} inputMode="decimal" value={r.qty} onChange={(v) => upd(i, { qty: v })} />
                    <TextInput label="Birim fiyat (KDV hariç)" inputMode="decimal" value={r.unitPrice} onChange={(v) => upd(i, { unitPrice: v })} />
                    <TextInput label="İskonto %" inputMode="decimal" value={r.discountPct} onChange={(v) => upd(i, { discountPct: v })} />
                    <TextInput label="KDV %" inputMode="decimal" value={r.vatRate} onChange={(v) => upd(i, { vatRate: v })} />
                  </div>
                )}
                {priceDiff && <p className="mt-1 text-sm font-semibold text-orange-800">Fiyat siparişten farklı ({formatPrice(ref!.unitPrice, ref!.currency)}) → kayıtta fark uyarısı oluşacak.</p>}
                {qtyOver && <p className="mt-1 text-sm font-semibold text-orange-800">Kabul edilen teslimattan fazla faturalanıyor → fark uyarısı oluşacak.</p>}
              </li>
            );
          })}
        </ul>
        {supplierId && <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => setRows((all) => [...all, { orderLineId: null, description: "", on: true, qty: "1", unitPrice: "", discountPct: "", vatRate: "20" }])}>+ Sipariş dışı kalem</button>}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <TextInput label="Kargo (KDV hariç)" inputMode="decimal" value={shippingAmount} onChange={setShipping} />
          <TextInput label="Kargo KDV %" inputMode="decimal" value={shippingVatRate} onChange={setShippingVat} />
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-[15px]">
          KDV hariç {formatMoney(totals.net, currency)} · KDV {formatMoney(totals.vat, currency)} · <b>KDV dahil {formatMoney(totals.total, currency)}</b>
          {declaredDiff && !declaredDiff.isZero() && <div className="font-semibold text-orange-800">Faturada yazan toplamla fark: {formatMoney(declaredDiff.toFixed(2), currency)} (kalem/kuruş farkını kontrol edin).</div>}
        </div>
      </section>

      {receipts.length > 0 && (
        <section className="card p-4">
          <h2 className="text-lg font-bold">İlgili teslimatlar (isteğe bağlı)</h2>
          {receipts.map((rc) => (
            <Checkbox key={rc.id} label={`${rc.receiptNo} · ${formatDate(rc.receivedOn)} · sipariş ${rc.orderNo}${rc.invoiced ? " (başka faturaya bağlı)" : ""}`} checked={receiptIds.includes(rc.id)}
              onChange={(on) => setReceiptIds((s) => (on ? [...s, rc.id] : s.filter((x) => x !== rc.id)))} />
          ))}
        </section>
      )}

      <section className="card space-y-3 p-4">
        <TextInput label="Not" value={note} onChange={setNote} />
        <label className="btn btn-secondary">
          {file ? `Fatura dosyası: ${file.name}` : "Fatura fotoğrafı / PDF ekle"}
          <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </section>
      <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={busy || !supplierId}>{busy ? "Kaydediliyor…" : "Faturayı kaydet"}</button>
    </form>
  );
}
