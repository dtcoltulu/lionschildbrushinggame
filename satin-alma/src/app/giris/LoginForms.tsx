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

export function DevLogin({ users, next }: { users: { id: string; displayName: string; roleText: string }[]; next: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <div className="space-y-3">
      <h2 className="font-bold">Deneme hesabı seçin</h2>
      <p className="text-sm text-muted">Geliştirme ortamında parola yoktur. Gerçek kurulumda herkes kendi e-posta ve parolasıyla girer.</p>
      {users.map((u) => (
        <button
          key={u.id}
          type="button"
          className="btn btn-secondary w-full justify-between"
          disabled={busy !== null}
          onClick={async () => {
            setBusy(u.id);
            const r = await callApi("POST", "/api/giris/gelistirici", { userId: u.id });
            if (r.ok) window.location.assign(next);
            else {
              setErr(r);
              setBusy(null);
            }
          }}
        >
          <span>{u.displayName}</span>
          <span className="truncate text-sm font-medium text-muted">{u.roleText}</span>
        </button>
      ))}
      {users.length === 0 && <p>Hiç kullanıcı yok. `npm run db:seed-demo` ile deneme hesapları ekleyin.</p>}
      <ErrorBanner error={err} />
    </div>
  );
}
