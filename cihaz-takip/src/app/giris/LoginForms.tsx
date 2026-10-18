"use client";

import { useState } from "react";
import { callApi, type ApiError } from "@/components/client";
import { ErrorBanner, TextInput } from "@/components/form";

export function PasswordLogin({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const r = await callApi("POST", "/api/giris", { email, password });
        if (r.ok) window.location.assign(next);
        else {
          setErr(r);
          setBusy(false);
        }
      }}
    >
      <TextInput label="E-posta" type="email" inputMode="email" autoComplete="username" value={email} onChange={setEmail} error={err?.fieldErrors.email} />
      <TextInput label="Parola" type="password" autoComplete="current-password" value={password} onChange={setPassword} error={err?.fieldErrors.password} />
      {err && !Object.keys(err.fieldErrors).length && <ErrorBanner error={err} />}
      <button className="btn btn-primary w-full" disabled={busy}>
        {busy ? "Giriş yapılıyor…" : "Giriş yap"}
      </button>
    </form>
  );
}

const KINDS = [
  { value: "staff", label: "Personel" },
  { value: "admin", label: "Yönetici" },
] as const;

/** Klinik şifresiyle giriş: personel ya da yönetici şifresi. */
export function ClinicLogin({ clinicId, next }: { clinicId: string; next: string }) {
  const [kind, setKind] = useState<"staff" | "admin">("staff");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const r = await callApi("POST", "/api/giris/klinik", { clinicId, kind, password });
        if (r.ok) window.location.assign(next);
        else {
          setErr(r);
          setBusy(false);
        }
      }}
    >
      <div role="radiogroup" aria-label="Giriş türü" className="grid grid-cols-2 gap-2">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            role="radio"
            aria-checked={kind === k.value}
            className={`btn ${kind === k.value ? "btn-primary" : "btn-secondary"}`}
            onClick={() => {
              setKind(k.value);
              setErr(null);
            }}
          >
            {k.label}
          </button>
        ))}
      </div>
      <TextInput
        label={kind === "admin" ? "Yönetici şifresi" : "Klinik şifresi"}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        error={err?.fieldErrors.password}
        hint={kind === "admin" ? "Analizler, silme ve ayarlar için yönetici şifresi." : "Arıza bildirmek ve cihazlara bakmak için kliniğin şifresi."}
      />
      {err && !Object.keys(err.fieldErrors).length && <ErrorBanner error={err} />}
      <button className="btn btn-primary w-full" disabled={busy}>
        {busy ? "Giriş yapılıyor…" : "Giriş yap"}
      </button>
    </form>
  );
}

export function DevLogin({ users, next, clinicId }: { users: { id: string; displayName: string; role: string; email: string }[]; next: string; clinicId?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <div className="space-y-3">
      <h3 className="font-bold">Deneme hesabı seçin</h3>
      <p className="text-sm text-muted">Geliştirme ortamında şifre yoktur. Gerçek kurulumda klinik seçilir ve personel ya da yönetici şifresi yazılır.</p>
      {users.map((u) => (
        <button
          key={u.id}
          type="button"
          className="btn btn-secondary w-full justify-between"
          disabled={busy !== null}
          onClick={async () => {
            setBusy(u.id);
            const r = await callApi("POST", "/api/giris/gelistirici", { userId: u.id, clinicId });
            if (r.ok) window.location.assign(next);
            else {
              setErr(r);
              setBusy(null);
            }
          }}
        >
          <span>{u.displayName}</span>
          <span className="text-sm font-medium text-muted">{u.role === "admin" ? "Yönetici" : "Personel"}</span>
        </button>
      ))}
      {users.length === 0 && <p>Hiç kullanıcı yok. `npm run db:seed-demo` ile deneme hesapları ekleyin.</p>}
      <ErrorBanner error={err} />
    </div>
  );
}
