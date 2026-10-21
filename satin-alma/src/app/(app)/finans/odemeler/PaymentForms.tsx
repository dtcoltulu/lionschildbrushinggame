"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { callApi, newKey, uploadFile, type ApiError } from "@/components/client";
import { ErrorBanner, Select, TextInput, type Option } from "@/components/form";
import { formatDate } from "@/lib/dates";
import { dec, decimalInput, formatMoney, parseDecimalInput } from "@/lib/decimal";
import { CURRENCIES, PAYMENT_METHODS } from "@/lib/labels";

interface OpenInvoice {
  id: string;
  kind: string;
  invoiceNo: string | null;
  invoiceDate: string;
  dueDate: string | null;
  currency: string;
  open: string;
  dueState: string;
}

const pd = (s: string) => {
  const v = parseDecimalInput(s);
  return v && v !== "invalid" ? v : "0";
};

/** Fatura başına dağıtım girişi: en eski vadeden başlayarak "Kalanı dağıt" önerisi; kullanıcı değiştirebilir. */
function Allocations({ invoices, currency, amount, value, onChange }: { invoices: OpenInvoice[]; currency: string; amount: string; value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const list = invoices.filter((i) => i.currency === currency);
  const used = Object.values(value).reduce((a, v) => a.plus(dec(pd(v))), dec(0));
  const rest = dec(pd(amount)).minus(used);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">Faturalara dağıtım</h3>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
          let left = dec(pd(amount));
          const next: Record<string, string> = {};
          for (const i of list) {
            if (left.lte(0)) break;
            const take = left.lt(dec(i.open)) ? left : dec(i.open);
            next[i.id] = decimalInput(take.toFixed(2));
            left = left.minus(take);
          }
          onChange(next);
        }}>En eski vadeden dağıt</button>
      </div>
      {list.length ? list.map((i) => (
        <div key={i.id} className="grid items-end gap-2 rounded-xl border border-slate-200 p-2 sm:grid-cols-[1fr_12rem]">
          <div className="text-[15px]">
            <b>{i.kind === "acilis" ? "Açılış borcu" : i.invoiceNo}</b> · {formatDate(i.invoiceDate)} · vade {formatDate(i.dueDate)}
            <div className={i.dueState === "gecikti" ? "font-semibold text-red-700" : "text-muted"}>Kalan {formatMoney(i.open, i.currency)}{i.dueState === "gecikti" ? " · vadesi geçti" : ""}</div>
          </div>
          <TextInput label="Dağıtılan" inputMode="decimal" value={value[i.id] ?? ""} onChange={(v) => onChange({ ...value, [i.id]: v })} />
        </div>
      )) : <p className="text-muted">Bu para biriminde açık fatura yok; ödeme avans olarak kaydedilir.</p>}
      <p className={`text-[15px] ${rest.lt(0) ? "font-semibold text-red-700" : ""}`}>
        Dağıtılan {formatMoney(used.toFixed(2), currency)} · faturaya bağlanmayan (avans) {formatMoney(rest.toFixed(2), currency)}
      </p>
    </div>
  );
}

export function PaymentForm({ suppliers, today, initialSupplier }: { suppliers: (Option & { currency: string })[]; today: string; initialSupplier: string | null }) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(initialSupplier ?? "");
  const [currency, setCurrency] = useState(suppliers.find((s) => s.value === initialSupplier)?.currency ?? "TRY");
  const [paidOn, setPaidOn] = useState(today);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("havale_eft");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [fx, setFx] = useState({ fxRate: "", fxDate: "", fxSource: "" });
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => newKey());

  useEffect(() => {
    if (!supplierId) return;
    callApi<{ items: OpenInvoice[] }>("GET", `/api/acik-faturalar/${supplierId}`).then((r) => r.ok && setInvoices(r.data.items));
  }, [supplierId]);

  const chooseSupplier = (id: string) => {
    setSupplierId(id);
    setInvoices([]);
    setAlloc({});
    setCurrency(suppliers.find((s) => s.value === id)?.currency ?? "TRY");
  };

  return (
    <form className="space-y-5" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setErr(null);
      const allocations = Object.entries(alloc).filter(([, v]) => dec(pd(v)).gt(0)).map(([invoiceId, v]) => ({ invoiceId, amount: v }));
      const r = await callApi<{ id: string }>("POST", "/api/odemeler", { supplierId, paidOn, amount, currency, method, reference, note, allocations, idempotencyKey: key, ...fx });
      if (!r.ok) {
        setBusy(false);
        return setErr(r);
      }
      if (file) await uploadFile("payment", r.data.id, file);
      router.push(`/finans/odemeler/${r.data.id}?yeni=1`);
    }}>
      <ErrorBanner error={err} />
      <div className="card grid gap-3 p-4 sm:grid-cols-3">
        <Select label="Tedarikçi" required value={supplierId} onChange={chooseSupplier} options={suppliers} emptyLabel="Seçin…" error={err?.fieldErrors.supplierId} />
        <TextInput label="Ödeme tarihi" type="date" max={today} value={paidOn} onChange={setPaidOn} error={err?.fieldErrors.paidOn} />
        <TextInput label="Tutar" required inputMode="decimal" value={amount} onChange={setAmount} error={err?.fieldErrors.amount} />
        <Select label="Para birimi" value={currency} onChange={(v) => { setCurrency(v); setAlloc({}); }} options={CURRENCIES.items.map((c) => ({ value: c.value, label: c.label }))} />
        <Select label="Yöntem" value={method} onChange={setMethod} options={PAYMENT_METHODS.items.map((m) => ({ value: m.value, label: m.label }))} />
        <TextInput label="Dekont / referans no" value={reference} onChange={setReference} />
        {currency !== "TRY" && (
          <>
            <TextInput label={`Kur (1 ${currency} = ? TL, isteğe bağlı)`} inputMode="decimal" value={fx.fxRate} onChange={(v) => setFx((s) => ({ ...s, fxRate: v }))} error={err?.fieldErrors.fxRate} />
            <TextInput label="Kur tarihi" type="date" value={fx.fxDate} onChange={(v) => setFx((s) => ({ ...s, fxDate: v }))} />
            <TextInput label="Kur kaynağı" value={fx.fxSource} onChange={(v) => setFx((s) => ({ ...s, fxSource: v }))} error={err?.fieldErrors.fxSource} />
          </>
        )}
      </div>
      {supplierId && (
        <section className="card p-4">
          <Allocations invoices={invoices} currency={currency} amount={amount} value={alloc} onChange={setAlloc} />
          {err?.fieldErrors.allocations && <p className="mt-2 font-semibold text-red-700" role="alert">{err.fieldErrors.allocations}</p>}
        </section>
      )}
      <section className="card space-y-3 p-4">
        <TextInput label="Açıklama" value={note} onChange={setNote} />
        <label className="btn btn-secondary">
          {file ? `Dekont: ${file.name}` : "Dekont fotoğrafı / PDF ekle"}
          <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </section>
      <button type="submit" className="btn btn-primary" disabled={busy || !supplierId}>{busy ? "Kaydediliyor…" : "Ödemeyi kaydet"}</button>
    </form>
  );
}

/** Avans kalan ödemeyi sonradan faturalara dağıtma. */
export function AllocateRemaining({ paymentId, supplierId, currency, unallocated }: { paymentId: string; supplierId: string; currency: string; unallocated: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [err, setErr] = useState<ApiError | null>(null);
  useEffect(() => {
    if (open) callApi<{ items: OpenInvoice[] }>("GET", `/api/acik-faturalar/${supplierId}`).then((r) => r.ok && setInvoices(r.data.items));
  }, [open, supplierId]);
  if (!open) return <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>Avansı faturalara dağıt</button>;
  return (
    <div className="card w-full space-y-3 p-4">
      <Allocations invoices={invoices} currency={currency} amount={unallocated} value={alloc} onChange={setAlloc} />
      <ErrorBanner error={err} />
      <button type="button" className="btn btn-primary" onClick={async () => {
        const allocations = Object.entries(alloc).filter(([, v]) => dec(pd(v)).gt(0)).map(([invoiceId, v]) => ({ invoiceId, amount: v }));
        const r = await callApi("POST", `/api/odemeler/${paymentId}/dagit`, { allocations });
        if (!r.ok) return setErr(r);
        setOpen(false);
        router.refresh();
      }}>Dağıtımı kaydet</button>
    </div>
  );
}
