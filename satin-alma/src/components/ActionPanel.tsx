"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { callApi, newKey, type ApiError } from "./client";
import { Checkbox, ErrorBanner, Segmented, Select, TextArea, TextInput, type Option } from "./form";

/**
 * Genel işlem formu: onay, ret, iptal, kapatma gibi işlemler aynı biçimde çalışır. Alanlar sunucu bileşeninden tanım
 * olarak verilir; gönderilen değerleri sunucu yeniden doğrular (yetki ve kurallar sunucudadır).
 */
interface Base {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  /** Yalnızca başka bir alan belirli değerlerdeyken göster */
  when?: { field: string; in: string[] };
}
export type FieldSpec =
  | (Base & { type: "text" | "textarea" | "date" | "decimal" | "int" | "email" | "password"; initial?: string; placeholder?: string })
  | (Base & { type: "select"; options: Option[]; initial?: string; emptyLabel?: string })
  | (Base & { type: "radio"; options: { value: string; label: string; hint?: string }[]; initial?: string })
  | (Base & { type: "checkbox"; initial?: boolean })
  | (Base & { type: "checkboxes"; options: { value: string; label: string; hint?: string }[]; initial?: string[] });

type Values = Record<string, string | boolean | string[]>;

export function ActionPanel(p: {
  title: string;
  endpoint: string;
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  fields?: FieldSpec[];
  extra?: Record<string, unknown>;
  submitLabel?: string;
  tone?: "primary" | "danger" | "secondary";
  open?: boolean;
  description?: ReactNode;
  /** Başarıdan sonra gidilecek adres; {alan} yanıt verisindeki alanla değiştirilir (ör. "/siparisler/{orderId}") */
  redirectTo?: string;
  successText?: string;
  idempotent?: boolean;
}) {
  const router = useRouter();
  const fields = useMemo(() => p.fields ?? [], [p.fields]);
  const initial = useMemo(() => {
    const v: Values = {};
    for (const f of fields) {
      if (f.type === "checkbox") v[f.name] = f.initial ?? false;
      else if (f.type === "checkboxes") v[f.name] = f.initial ?? [];
      else v[f.name] = f.initial ?? "";
    }
    return v;
  }, [fields]);
  const [open, setOpen] = useState(p.open ?? false);
  const [values, setValues] = useState<Values>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);
  const [key] = useState(() => newKey());
  const set = (name: string, v: string | boolean | string[]) => setValues((s) => ({ ...s, [name]: v }));
  const visible = (f: FieldSpec) => !f.when || f.when.in.includes(String(values[f.when.field] ?? ""));
  const btn = p.tone === "danger" ? "btn-danger" : p.tone === "secondary" ? "btn-secondary" : "btn-primary";

  if (!open) {
    return (
      <button type="button" className={`btn ${btn}`} onClick={() => setOpen(true)}>
        {p.title}
      </button>
    );
  }
  return (
    <form
      className="card w-full space-y-4 border-slate-300 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const body: Record<string, unknown> = { ...(p.extra ?? {}), ...(p.idempotent ? { idempotencyKey: key } : {}) };
        for (const f of fields) if (visible(f)) body[f.name] = values[f.name];
        const r = await callApi<Record<string, unknown>>(p.method ?? "POST", p.endpoint, p.method === "DELETE" && !fields.length ? undefined : body);
        setBusy(false);
        if (!r.ok) return setErr(r);
        setDone(true);
        if (p.redirectTo) {
          const data = r.data as Record<string, unknown>;
          const flat: Record<string, unknown> = { ...data, ...(Object.values(data).find((x) => x && typeof x === "object") as Record<string, unknown> | undefined) };
          router.push(p.redirectTo.replace(/\{(\w+)\}/g, (_, k: string) => String(flat[k] ?? "")));
        } else {
          setOpen(p.open ?? false);
          setValues(initial);
          router.refresh();
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-lg font-bold">{p.title}</h3>
        {!p.open && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
            Vazgeç
          </button>
        )}
      </div>
      {p.description && <div className="text-[15px] text-slate-700">{p.description}</div>}
      <ErrorBanner error={err} onReload={() => router.refresh()} />
      {fields.filter(visible).map((f) => {
        const error = err?.fieldErrors[f.name];
        switch (f.type) {
          case "textarea":
            return <TextArea key={f.name} label={f.label} hint={f.hint} required={f.required} value={String(values[f.name] ?? "")} onChange={(v) => set(f.name, v)} error={error} placeholder={f.placeholder} />;
          case "select":
            return <Select key={f.name} label={f.label} hint={f.hint} required={f.required} value={String(values[f.name] ?? "")} onChange={(v) => set(f.name, v)} options={f.options} emptyLabel={f.emptyLabel ?? "Seçin…"} error={error} />;
          case "radio":
            return <Segmented key={f.name} name={f.name} label={f.label} value={String(values[f.name] ?? "")} onChange={(v) => set(f.name, v)} options={f.options} error={error} />;
          case "checkbox":
            return <Checkbox key={f.name} label={f.label} hint={f.hint} checked={values[f.name] === true} onChange={(v) => set(f.name, v)} />;
          case "checkboxes": {
            const cur = (values[f.name] as string[]) ?? [];
            return (
              <fieldset key={f.name}>
                <legend className="mb-1 text-[15px] font-semibold">{f.label}</legend>
                {f.options.map((o) => (
                  <Checkbox key={o.value} label={o.label} hint={o.hint} checked={cur.includes(o.value)} onChange={(on) => set(f.name, on ? [...cur, o.value] : cur.filter((x) => x !== o.value))} />
                ))}
                {error && <p className="text-sm font-semibold text-red-700" role="alert">{error}</p>}
              </fieldset>
            );
          }
          default:
            return (
              <TextInput
                key={f.name}
                label={f.label}
                hint={f.hint}
                required={f.required}
                type={f.type === "decimal" || f.type === "int" ? "text" : f.type}
                inputMode={f.type === "decimal" ? "decimal" : f.type === "int" ? "numeric" : f.type === "email" ? "email" : undefined}
                value={String(values[f.name] ?? "")}
                onChange={(v) => set(f.name, v)}
                error={error}
                placeholder={f.placeholder}
                autoComplete={f.type === "password" ? "new-password" : undefined}
              />
            );
        }
      })}
      {done && p.successText && <p className="font-semibold text-emerald-800">{p.successText}</p>}
      <button type="submit" className={`btn ${btn} w-full sm:w-auto`} disabled={busy}>
        {busy ? "Kaydediliyor…" : p.submitLabel ?? p.title}
      </button>
    </form>
  );
}
