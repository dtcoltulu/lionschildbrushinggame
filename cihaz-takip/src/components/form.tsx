"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, type ReactNode } from "react";
import type { ApiError } from "./client";

export function FieldShell({ label, hint, error, children, htmlFor, required }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-[15px] font-semibold text-ink">
        {label}
        {required && <span className="ml-1 text-red-700" aria-hidden>*</span>}
        {required && <span className="sr-only"> (zorunlu)</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-sm text-muted">{hint}</p>}
      {error && (
        <p className="mt-1 text-sm font-semibold text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  type?: string;
  placeholder?: string;
  name?: string;
  inputMode?: "text" | "decimal" | "numeric" | "email" | "tel";
  autoComplete?: string;
  max?: string;
  min?: string;
};

export function TextInput(p: InputProps) {
  const id = useId();
  return (
    <FieldShell label={p.label} hint={p.hint} error={p.error} htmlFor={id} required={p.required}>
      <input
        id={id}
        name={p.name}
        className="field"
        type={p.type ?? "text"}
        value={p.value}
        placeholder={p.placeholder}
        inputMode={p.inputMode}
        autoComplete={p.autoComplete ?? "off"}
        max={p.max}
        min={p.min}
        aria-invalid={p.error ? true : undefined}
        onChange={(e) => p.onChange(e.target.value)}
      />
    </FieldShell>
  );
}

export function TextArea(p: Omit<InputProps, "type" | "inputMode"> & { rows?: number }) {
  const id = useId();
  return (
    <FieldShell label={p.label} hint={p.hint} error={p.error} htmlFor={id} required={p.required}>
      <textarea
        id={id}
        name={p.name}
        className="field"
        rows={p.rows ?? 3}
        value={p.value}
        placeholder={p.placeholder}
        aria-invalid={p.error ? true : undefined}
        onChange={(e) => p.onChange(e.target.value)}
      />
    </FieldShell>
  );
}

export interface Option {
  value: string;
  label: string;
  group?: string;
}

/** Kişi, konum, tür gibi seçimler her zaman kayıtlı listeden yapılır (serbest metin yok). */
export function Select(p: { label: ReactNode; value: string; onChange: (v: string) => void; options: Option[]; error?: string; hint?: ReactNode; required?: boolean; emptyLabel?: string; name?: string }) {
  const id = useId();
  const groups = [...new Set(p.options.map((o) => o.group ?? ""))];
  return (
    <FieldShell label={p.label} hint={p.hint} error={p.error} htmlFor={id} required={p.required}>
      <select id={id} name={p.name} className="field" value={p.value} aria-invalid={p.error ? true : undefined} onChange={(e) => p.onChange(e.target.value)}>
        {p.emptyLabel !== undefined && <option value="">{p.emptyLabel}</option>}
        {groups.length > 1
          ? groups.map((g) => (
              <optgroup key={g} label={g || "Diğer"}>
                {p.options.filter((o) => (o.group ?? "") === g).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))
          : p.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
      </select>
    </FieldShell>
  );
}

/** Büyük, dokunması kolay seçenek düğmeleri (durum, sonuç vb.). */
export function Segmented<T extends string>(p: { label: ReactNode; value: T | ""; onChange: (v: T) => void; options: { value: T; label: string; hint?: string }[]; error?: string; name: string }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-[15px] font-semibold text-ink">{p.label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {p.options.map((o) => {
          const on = p.value === o.value;
          return (
            <label
              key={o.value}
              className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${on ? "border-brand bg-brand-soft ring-2 ring-brand" : "border-slate-300 bg-white hover:bg-slate-50"}`}
            >
              <input type="radio" name={p.name} value={o.value} checked={on} onChange={() => p.onChange(o.value)} className="h-5 w-5 accent-[var(--color-brand)]" />
              <span>
                <span className="block font-semibold">{o.label}</span>
                {o.hint && <span className="block text-sm text-muted">{o.hint}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {p.error && (
        <p className="mt-1 text-sm font-semibold text-red-700" role="alert">
          {p.error}
        </p>
      )}
    </fieldset>
  );
}

export function Checkbox({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-start gap-3 py-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-[var(--color-brand)]" />
      <span>
        <span className="block text-[16px] font-medium">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** İsteğe bağlı ayrıntılar: günlük formu kalabalıklaştırmaz. */
export function Details({ summary, children, defaultOpen }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-slate-50/60" open={defaultOpen}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 font-semibold text-ink">
        <span>{summary}</span>
        <span className="text-muted transition group-open:rotate-180" aria-hidden>
          ▾
        </span>
      </summary>
      <div className="space-y-4 border-t border-slate-200 px-4 py-4">{children}</div>
    </details>
  );
}

/** API hatasını kullanıcıya anlatır: alan hataları, oturum kapanması, eşzamanlı değişiklik. */
export function ErrorBanner({ error, onOverwrite, onReload }: { error: ApiError | null; onOverwrite?: () => void; onReload?: () => void }) {
  const path = usePathname();
  if (!error) return null;
  const fieldCount = Object.keys(error.fieldErrors).length;
  if (error.status === 401) {
    return (
      <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
        <div className="font-bold">Oturumunuz kapanmış.</div>
        <div className="mt-1">Girdiğiniz bilgiler bu cihazda saklandı. Tekrar giriş yaptığınızda form dolu olarak açılacak.</div>
        <Link href={`/giris?next=${encodeURIComponent(typeof window === "undefined" ? path : window.location.pathname + window.location.search)}`} className="btn btn-primary mt-3">
          Tekrar giriş yap
        </Link>
      </div>
    );
  }
  if (error.code === "version_conflict") {
    return (
      <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
        <div className="font-bold">Kayıt başka biri tarafından değiştirildi.</div>
        <div className="mt-1">{error.error}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {onReload && (
            <button type="button" className="btn btn-secondary" onClick={onReload}>
              Güncel hâli yükle (değişikliklerimi bırak)
            </button>
          )}
          {onOverwrite && (
            <button type="button" className="btn btn-secondary" onClick={onOverwrite}>
              Güncel hâlin üzerine benim değişikliklerimi kaydet
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-900">
      <div className="font-bold">{fieldCount ? `Kaydedilmedi: ${fieldCount} alanda düzeltme gerekiyor.` : "Kaydedilmedi."}</div>
      <div className="mt-1">{error.error}</div>
      {fieldCount > 0 && (
        <ul className="mt-2 list-disc pl-5 text-[15px]">
          {Object.entries(error.fieldErrors).map(([k, v]) => (
            <li key={k}>{v}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DraftBanner({ restored, onDiscard }: { restored: boolean; onDiscard: () => void }) {
  if (!restored) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sky-950">
      <span>Bu formda kaydedilmemiş bilgileriniz vardı; geri yüklendi.</span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onDiscard}>
        Taslağı at
      </button>
    </div>
  );
}

export function SaveBar({ busy, label = "Kaydet", extra }: { busy: boolean; label?: string; extra?: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-xl lg:border">
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary min-w-40 flex-1 sm:flex-none" disabled={busy}>
          {busy ? "Kaydediliyor…" : label}
        </button>
        {extra}
      </div>
    </div>
  );
}
