import type { Metadata } from "next";
import { CurrentClinicLogins } from "@/components/managers/ClinicManager";
import { UserManager } from "@/components/managers/UserManager";
import { SettingsTabs } from "@/components/SettingsTabs";
import { Card, PageHeader } from "@/components/ui";
import { getDb } from "@/server/db";
import { getLoginAdmin } from "@/server/login-admin";
import { formLookups, pageCtx } from "@/server/page";
import { getClinic } from "@/server/services/clinics";
import { listUsers } from "@/server/services/users";

export const metadata: Metadata = { title: "Giriş ve erişim" };
export const dynamic = "force-dynamic";

export default async function AccessPage() {
  const ctx = await pageCtx({ admin: true });
  const logins = getLoginAdmin();
  const [clinic, users, lk] = await Promise.all([
    getClinic(await getDb(), ctx.actor.clinicId, logins),
    listUsers(ctx.db, ctx.actor.clinicId),
    formLookups(ctx.db),
  ]);
  return (
    <>
      <PageHeader title="Ayarlar" subtitle={`${ctx.actor.clinicName}: çalışanlar kliniği seçip personel ya da yönetici şifresiyle girer.`} />
      <SettingsTabs current="/ayarlar" superAdmin={ctx.actor.superAdmin} />
      <div className="space-y-6">
        <Card title="Klinik şifreleri">{clinic && <CurrentClinicLogins clinic={clinic} mode={logins.mode} />}</Card>
        <Card title="Kişisel hesaplar (isteğe bağlı)">
          <p className="mb-3 text-sm text-muted">
            Ortak şifre yerine kendi e-posta ve parolasıyla girmesi gerekenler için. Giriş ekranında “E-posta ile giriş” kullanılır.
          </p>
          <UserManager users={users} staff={lk.staff} mode={logins.mode} meId={ctx.actor.userId} />
        </Card>
      </div>
    </>
  );
}
