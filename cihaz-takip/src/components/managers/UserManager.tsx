"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDateTime } from "@/lib/dates";
import { USER_ROLES, userRoleLabel } from "@/lib/labels";
import type { Opt } from "@/server/page";
import type { AppUser } from "@/server/services/users";
import { callApi, type ApiError } from "../client";
import { Checkbox, ErrorBanner, Select, TextInput } from "../form";
import { Badge, Notice } from "../ui";

const roles = USER_ROLES.map((r) => ({ value: r.value, label: r.label }));

type LoginMode = "dev" | "supabase" | "supabase-manual";

function NewUser({ staff, mode, onDone }: { staff: Opt[]; mode: LoginMode; onDone: (m: string) => void }) {
  const usesPasswords = mode === "supabase";
  const [v, setV] = useState({ email: "", displayName: "", role: "staff", staffId: "", password: "" });
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
        const r = await callApi<{ loginExisted: boolean }>("POST", "/api/kullanicilar", v);
        setBusy(false);
        if (!r.ok) return setErr(r);
        setErr(null);
        onDone(
          r.data.loginExisted
            ? `${v.displayName} eklendi. Bu e-posta için giriş hesabı zaten vardı; mevcut parolasıyla girebilir.`
            : usesPasswords
              ? `${v.displayName} eklendi. İlk parolayı kendisine yüz yüze iletin; girişten sonra “Hesabım”dan değiştirebilir.`
              : mode === "supabase-manual"
                ? `${v.displayName} eklendi. Şimdi Supabase panelinde (Authentication → Users → Add user, “Auto confirm” işaretli) ${v.email} için giriş hesabı açın; kişi ilk girişte bu kayda bağlanır.`
                : `${v.displayName} eklendi.`,
        );
        setV({ email: "", displayName: "", role: "staff", staffId: "", password: "" });
      }}
    >
      <ErrorBanner error={err} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput label="E-posta (giriş adı)" required type="email" inputMode="email" value={v.email} onChange={(x) => set("email", x)} error={fe.email} hint="Kişiye özel bir adres. Kişisel hesap başkasıyla paylaşılmaz." />
        <TextInput label="Görünen ad" required value={v.displayName} onChange={(x) => set("displayName", x)} error={fe.displayName} />
        <Select label="Rol" value={v.role} onChange={(x) => set("role", x)} options={roles} error={fe.role} hint="Yönetici: tüm analizler, silme/geri alma, personel ve erişim yönetimi, dışa aktarım." />
        <Select label="Bağlı personel kartı" value={v.staffId} onChange={(x) => set("staffId", x)} options={staff} emptyLabel="Bağlı değil" error={fe.staffId} hint="Bağlıysa arıza bildiriminde “fark eden” otomatik önerilir." />
        {usesPasswords && (
          <TextInput label="İlk parola" type="text" value={v.password} onChange={(x) => set("password", x)} error={fe.password} hint="En az 10 karakter. Kişiye yüz yüze iletin." autoComplete="new-password" />
        )}
      </div>
      <button className="btn btn-primary" disabled={busy}>{busy ? "Ekleniyor…" : "Kullanıcı ekle"}</button>
    </form>
  );
}

function EditUser({ user, staff, mode, onDone }: { user: AppUser; staff: Opt[]; mode: LoginMode; onDone: (m: string) => void }) {
  const usesPasswords = mode === "supabase";
  const [v, setV] = useState({ displayName: user.displayName, role: user.role as string, staffId: user.staffId ?? "", active: user.active });
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const fe = err?.fieldErrors ?? {};
  return (
    <div className="space-y-3">
      <ErrorBanner error={err} onReload={() => window.location.reload()} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput label="Görünen ad" value={v.displayName} onChange={(x) => setV((p) => ({ ...p, displayName: x }))} error={fe.displayName} />
        <Select label="Rol" value={v.role} onChange={(x) => setV((p) => ({ ...p, role: x }))} options={roles} error={fe.role} />
        <Select label="Bağlı personel kartı" value={v.staffId} onChange={(x) => setV((p) => ({ ...p, staffId: x }))} options={staff} emptyLabel="Bağlı değil" error={fe.staffId} />
        <Checkbox label="Erişim açık" checked={v.active} onChange={(x) => setV((p) => ({ ...p, active: x }))} hint="Kapatılınca kişi hemen giriş yapamaz; geçmiş kayıtları korunur." />
      </div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await callApi("PATCH", `/api/kullanicilar/${user.id}`, { ...v, version: user.version });
          setBusy(false);
          if (!r.ok) return setErr(r);
          onDone(`${v.displayName} güncellendi.`);
        }}
      >
        Kaydet
      </button>
      {usesPasswords && (
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3">
          <div className="min-w-60 flex-1">
            <TextInput label="Yeni geçici parola" value={pw} onChange={setPw} error={fe.password} autoComplete="new-password" hint="Parolasını unutan çalışan için. En az 10 karakter." />
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || pw.length === 0}
            onClick={async () => {
              setBusy(true);
              const r = await callApi("POST", `/api/kullanicilar/${user.id}/parola`, { password: pw });
              setBusy(false);
              if (!r.ok) return setErr(r);
              setPw("");
              onDone(`${user.displayName} için parola değiştirildi.`);
            }}
          >
            Parolayı değiştir
          </button>
        </div>
      )}
    </div>
  );
}

export function UserManager({ users, staff, mode, meId }: { users: AppUser[]; staff: Opt[]; mode: LoginMode; meId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const done = (m: string) => {
    setMsg(m);
    setEditing(null);
    setAdding(false);
    router.refresh();
  };
  return (
    <div className="space-y-4">
      {msg && <Notice tone="green">✓ {msg}</Notice>}
      {mode === "supabase-manual" && (
        <Notice tone="amber" title="Giriş hesapları şimdilik Supabase panelinden açılıyor">
          Kullanıcıyı burada ekleyin, sonra Supabase panelinde (Authentication → Users → Add user, “Auto confirm user” işaretli) aynı e-postayla giriş hesabı
          açın; kişi ilk girişte bu kayda otomatik bağlanır. Hesap açma ve parola sıfırlamayı buradan yapmak için Vercel’e SUPABASE_SERVICE_ROLE_KEY eklenmelidir.
          Erişim kapatma buradan da anında çalışır.
        </Notice>
      )}
      {adding ? (
        <div className="card p-4">
          <h3 className="mb-3 text-lg font-bold">Yeni kullanıcı hesabı</h3>
          <NewUser staff={staff} mode={mode} onDone={done} />
          <button type="button" className="btn btn-secondary mt-2" onClick={() => setAdding(false)}>Kapat</button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ Kullanıcı ekle</button>
      )}
      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.id} className="card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{u.displayName}{u.id === meId ? " (siz)" : ""}</div>
                <div className="text-sm text-muted">
                  {u.email}
                  {u.staffName ? ` · personel kartı: ${u.staffName}` : ""}
                  {` · son giriş: ${u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "hiç"}`}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={u.role === "admin" ? "purple" : "blue"}>{userRoleLabel(u.role)}</Badge>
                {!u.active && <Badge tone="gray">Erişim kapalı</Badge>}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(editing === u.id ? null : u.id)}>
                  {editing === u.id ? "Kapat" : "Düzenle"}
                </button>
              </div>
            </div>
            {editing === u.id && (
              <div className="mt-3 border-t border-slate-200 pt-3">
                <EditUser user={u} staff={staff} mode={mode} onDone={done} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
