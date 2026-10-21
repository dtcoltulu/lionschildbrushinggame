import { redirect } from "next/navigation";
import { ActionPanel } from "@/components/ActionPanel";
import { SettingsTabs } from "@/components/SettingsTabs";
import { Badge, DataTable, Notice, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { ROLES } from "@/lib/labels";
import { getLoginAdmin } from "@/server/login-admin";
import { pageCtx } from "@/server/page";
import { can } from "@/server/permissions";
import { listUsers } from "@/server/services/users";
import { settingsTabs } from "@/server/settings-tabs";

export const dynamic = "force-dynamic";

const roleOptions = ROLES.items.map((r) => ({ value: r.value, label: r.label, hint: r.hint }));

export default async function UsersPage() {
  const ctx = await pageCtx(["users.manage", "lookups.manage", "audit.view", "export.operations"]);
  if (!can(ctx.actor, "users.manage")) redirect(settingsTabs(ctx.actor)[0]!.href);
  const users = await listUsers(ctx);
  const logins = getLoginAdmin();
  return (
    <>
      <PageHeader title="Ayarlar" />
      <SettingsTabs current="kullanicilar" items={settingsTabs(ctx.actor)} />
      <div className="mb-4">
        <Notice tone="blue">
          Her kişinin kendi hesabı vardır; işlemler kişiyle kaydedilir. Bir kişiye birden fazla rol verilebilir (ör. teslimat sorumlusu + finans).
          Yetkiler sunucuda uygulanır: rolü olmayan kişi ilgili ekrana da API’ye de erişemez.
          {logins.mode === "supabase-manual" && " SUPABASE_SERVICE_ROLE_KEY tanımlı değil: giriş hesabını Supabase panelinden aynı e-postayla açın; kişi ilk girişte bu kayda bağlanır."}
          {logins.mode === "dev" && " Geliştirme ortamında parola yoktur."}
        </Notice>
      </div>
      <DataTable rows={users} rowKey={(u) => u.id}
        columns={[
          { label: "Ad soyad", cell: (u) => <><b>{u.displayName}</b>{!u.active && <> <Badge tone="gray">Erişim kapalı</Badge></>}<div className="text-sm text-muted">{u.email}</div></> },
          { label: "Roller", cell: (u) => u.roles.map((r) => ROLES.label(r)).join(", ") },
          { label: "Son giriş", cell: (u) => formatDateTime(u.lastLoginAt) },
          { label: "", cell: (u) => (
            <div className="flex flex-col gap-1">
              <ActionPanel title="Düzenle" tone="secondary" method="PATCH" endpoint={`/api/kullanicilar/${u.id}`} extra={{ version: u.version }}
                fields={[
                  { name: "displayName", label: "Ad soyad", type: "text", initial: u.displayName, required: true },
                  { name: "roles", label: "Roller", type: "checkboxes", options: roleOptions, initial: u.roles },
                  { name: "active", label: "Erişim açık", type: "checkbox", initial: u.active },
                ]} />
              {logins.usesPasswords && <ActionPanel title="Geçici parola ver" tone="secondary" endpoint={`/api/kullanicilar/${u.id}/parola`} fields={[{ name: "password", label: "Yeni parola (en az 10 karakter)", type: "password", required: true }]} />}
            </div>
          ) },
        ]} />
      <div className="mt-4">
        <ActionPanel title="+ Kullanıcı ekle" endpoint="/api/kullanicilar"
          fields={[
            { name: "displayName", label: "Ad soyad", type: "text", required: true },
            { name: "email", label: "E-posta (giriş adı)", type: "email", required: true },
            { name: "roles", label: "Roller", type: "checkboxes", options: roleOptions, initial: ["asistan"] },
            ...(logins.usesPasswords ? [{ name: "password", label: "İlk parola (en az 10 karakter; kişiye yüz yüze iletin)", type: "password" as const, required: true }] : []),
          ]} />
      </div>
    </>
  );
}
