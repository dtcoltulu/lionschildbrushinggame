"use client";

import { useState } from "react";
import { callApi, type ApiError } from "./client";
import { ErrorBanner, TextInput } from "./form";

export function PasswordChange() {
  const [password, setPassword] = useState("");
  const [passwordAgain, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [ok, setOk] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setOk(false);
        const r = await callApi("POST", "/api/hesabim/parola", { password, passwordAgain });
        setBusy(false);
        if (!r.ok) return setErr(r);
        setErr(null);
        setOk(true);
        setPassword("");
        setAgain("");
      }}
    >
      {ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 font-semibold text-emerald-900" role="status">✓ Parolanız değiştirildi.</p>}
      <ErrorBanner error={err} />
      <TextInput label="Yeni parola" type="password" autoComplete="new-password" value={password} onChange={setPassword} error={err?.fieldErrors.password} hint="En az 10 karakter." />
      <TextInput label="Yeni parola (tekrar)" type="password" autoComplete="new-password" value={passwordAgain} onChange={setAgain} error={err?.fieldErrors.passwordAgain} />
      <button className="btn btn-primary" disabled={busy}>{busy ? "Değiştiriliyor…" : "Parolayı değiştir"}</button>
    </form>
  );
}
