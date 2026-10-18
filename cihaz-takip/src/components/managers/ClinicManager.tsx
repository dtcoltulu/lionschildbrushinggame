"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDateTime } from "@/lib/dates";
import type { Clinic, LoginStatus } from "@/server/services/clinics";
import { callApi, clearAllDrafts, type ApiError } from "../client";
import { Checkbox, ErrorBanner, TextInput } from "../form";
import { Badge, Notice } from "../ui";

type LoginMode = "dev" | "supabase" | "supabase-manual";

const KINDS = [
  { value: "staff", label: "Personel şifresi", hint: "Arıza bildirme, cihazlar, servis takibi." },
  { value: "admin", label: "Yönetici şifresi", hint: "Ayrıca analizler, maliyetler, silme/geri alma, ayarlar." },
] as const;

export function ModeNotice({ mode }: { mode: LoginMode }) {
  if (mode === "dev") {
    return <Notice tone="amber">Geliştirme ortamı: şifre yoktur, giriş ekranında klinik seçilip deneme hesabı seçilir.</Notice>;
  }
  if (mode === "supabase-manual") {
    return (
      <Notice tone="amber" title="Şifreler henüz belirlenemiyor">
        Klinik şifrelerini buradan belirlemek için sunucuya bir kez Supabase gizli anahtarı eklenmelidir (Vercel → proje → Settings → Environment
        Variables → <code>SUPABASE_SERVICE_ROLE_KEY</code>, yalnızca Production). Anahtar tarayıcıya hiç gönderilmez.
      </Notice>
    );
  }
  return null;
}

function Status({ s }: { s: LoginStatus }) {
  return s.ready ? (
    <span className="text-sm text-muted">
      <Badge tone="green">Belirlendi</Badge> {s.changedAt && <>· {formatDateTime(s.changedAt)}</>}
    </span>
  ) : (
    <Badge tone="amber">Belirlenmedi</Badge>
  );
}

/** Kliniğin iki ortak girişi: durum ve şifre değiştirme. */
export function ClinicLogins({ clinic, mode, onDone }: { clinic: Clinic; mode: LoginMode; onDone: (m: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <ul className="space-y-3">
      {KINDS.map((k) => (
        <li key={k.value} className="rounded-xl border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold">{k.label}</div>
              <div className="text-sm text-muted">{k.hint}</div>
            </div>
            <div className="flex items-center gap-2">
              <Status s={k.value === "staff" ? clinic.staffLogin : clinic.adminLogin} />
              {mode === "supabase" && open !== k.value && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setOpen(k.value);
                    setPw("");
                    setErr(null);
                  }}
                >
                  {(k.value === "staff" ? clinic.staffLogin : clinic.adminLogin).ready ? "Değiştir" : "Belirle"}
                </button>
              )}
            </div>
          </div>
          {open === k.value && (
            <form
              className="mt-3 space-y-2"
              noValidate
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const r = await callApi("POST", `/api/klinikler/${clinic.id}/sifre`, { kind: k.value, password: pw });
                setBusy(false);
                if (!r.ok) return setErr(r);
                setOpen(null);
                setPw("");
                onDone(`${clinic.name}: ${k.label.toLocaleLowerCase("tr")} kaydedildi. Bu şifreyle açık olan eski oturumlar kapandı.`);
              }}
            >
              <ErrorBanner error={err?.fieldErrors.password ? null : err} />
              <TextInput
                label={`Yeni ${k.label.toLocaleLowerCase("tr")}`}
                value={pw}
                onChange={setPw}
                error={err?.fieldErrors.password}
                autoComplete="new-password"
                hint="En az 10 karakter. Personel ve yönetici şifresi farklı olmalı. Yalnızca o kliniğin çalışanlarına söyleyin."
              />
              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={busy || !pw}>
                  {busy ? "Kaydediliyor…" : "Kaydet"}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setOpen(null)}>
                  Vazgeç
                </button>
              </div>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Ayarlar → Giriş ve erişim: bulunulan kliniğin şifreleri. */
export function CurrentClinicLogins({ clinic, mode }: { clinic: Clinic; mode: LoginMode }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {msg && <Notice tone="green">✓ {msg}</Notice>}
      <ModeNotice mode={mode} />
      <ClinicLogins
        clinic={clinic}
        mode={mode}
        onDone={(m) => {
          setMsg(m);
          router.refresh();
        }}
      />
    </div>
  );
}

function NewClinic({ mode, onDone }: { mode: LoginMode; onDone: (m: string) => void }) {
  const usesPasswords = mode === "supabase";
  const [v, setV] = useState({ name: "", staffPassword: "", adminPassword: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const fe = err?.fieldErrors ?? {};
  const set = (k: keyof typeof v, x: string) => setV((p) => ({ ...p, [k]: x }));
  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await callApi("POST", "/api/klinikler", usesPasswords ? v : { name: v.name });
        setBusy(false);
        if (!r.ok) return setErr(r);
        setErr(null);
        onDone(
          usesPasswords
            ? `${v.name} açıldı. Çalışanlar giriş ekranında kliniği seçip şifreyle girer.`
            : `${v.name} açıldı.${mode === "supabase-manual" ? " Şifreleri, gizli anahtar eklendikten sonra belirleyin." : ""}`,
        );
        setV({ name: "", staffPassword: "", adminPassword: "" });
      }}
    >
      <ErrorBanner error={Object.keys(fe).length ? null : err} />
      <TextInput label="Klinik adı" required value={v.name} onChange={(x) => set("name", x)} error={fe.name} hint="Giriş ekranında bu adla görünür." />
      {usesPasswords && (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Personel şifresi" value={v.staffPassword} onChange={(x) => set("staffPassword", x)} error={fe.staffPassword} autoComplete="new-password" hint="En az 10 karakter." />
          <TextInput label="Yönetici şifresi" value={v.adminPassword} onChange={(x) => set("adminPassword", x)} error={fe.adminPassword} autoComplete="new-password" hint="Personel şifresinden farklı olmalı." />
        </div>
      )}
      <p className="text-sm text-muted">Yeni klinik, başlangıç listeleriyle (odalar, cihaz türleri, arıza nedenleri) açılır. Cihaz ve çalışan bilgisi boş başlar.</p>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Açılıyor…" : "Klinik aç"}
      </button>
    </form>
  );
}

function EditClinic({ clinic, onDone }: { clinic: Clinic; onDone: (m: string) => void }) {
  const [v, setV] = useState({ name: clinic.name, active: clinic.active });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <div className="space-y-3">
      <ErrorBanner error={err?.fieldErrors.name ? null : err} onReload={() => window.location.reload()} />
      <TextInput label="Klinik adı" value={v.name} onChange={(x) => setV((p) => ({ ...p, name: x }))} error={err?.fieldErrors.name} />
      <Checkbox
        label="Erişim açık"
        checked={v.active}
        onChange={(x) => setV((p) => ({ ...p, active: x }))}
        hint="Kapatılınca klinik giriş ekranında görünmez ve klinik şifreleriyle girilemez. Kayıtlar silinmez."
      />
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await callApi("PATCH", `/api/klinikler/${clinic.id}`, { ...v, version: clinic.version });
          setBusy(false);
          if (!r.ok) return setErr(r);
          onDone(`${v.name} güncellendi.`);
        }}
      >
        Kaydet
      </button>
    </div>
  );
}

/** Ayarlar → Klinikler (yalnızca genel yönetici). */
export function ClinicManager({ clinics, mode, currentId }: { clinics: Clinic[]; mode: LoginMode; currentId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const done = (m: string) => {
    setMsg(m);
    setAdding(false);
    setEditing(null);
    router.refresh();
  };
  return (
    <div className="space-y-4">
      {msg && <Notice tone="green">✓ {msg}</Notice>}
      <ModeNotice mode={mode} />
      {adding ? (
        <div className="card p-4">
          <h3 className="mb-3 text-lg font-bold">Yeni klinik</h3>
          <NewClinic mode={mode} onDone={done} />
          <button type="button" className="btn btn-secondary mt-2" onClick={() => setAdding(false)}>
            Kapat
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          + Klinik ekle
        </button>
      )}
      <ul className="space-y-3">
        {clinics.map((c) => (
          <li key={c.id} className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-lg font-bold">
                  {c.name} {c.id === currentId && <Badge tone="green">Şu an bu klinikte</Badge>} {!c.active && <Badge tone="red">Erişimi kapalı</Badge>}
                </div>
                <div className="text-sm text-muted">Açılış: {formatDateTime(c.createdAt)}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {c.id !== currentId && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={switching !== null}
                    onClick={async () => {
                      setSwitching(c.id);
                      const r = await callApi("POST", "/api/klinik-sec", { clinicId: c.id });
                      if (!r.ok) return setSwitching(null);
                      clearAllDrafts();
                      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- klinik değişince sayfa kabuğu da (menü, klinik adı) baştan yüklenmeli
                      window.location.assign("/");
                    }}
                  >
                    Bu kliniğe geç
                  </button>
                )}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(editing === c.id ? null : c.id)}>
                  {editing === c.id ? "Kapat" : "Düzenle"}
                </button>
              </div>
            </div>
            {editing === c.id && <EditClinic clinic={c} onDone={done} />}
            <ClinicLogins clinic={c} mode={mode} onDone={done} />
          </li>
        ))}
      </ul>
    </div>
  );
}
