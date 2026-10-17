import type { Metadata } from "next";
import { UserManager } from "@/components/managers/UserManager";
import { SettingsTabs } from "@/components/SettingsTabs";
import { PageHeader } from "@/components/ui";
import { getLoginAdmin } from "@/server/login-admin";
import { formLookups, pageCtx } from "@/server/page";
import { listUsers } from "@/server/services/users";

export const metadata: Metadata = { title: "Kullanıcılar ve erişim" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const ctx = await pageCtx({ admin: true });
  const [users, lk] = await Promise.all([listUsers(ctx.db), formLookups(ctx.db)]);
  return (
    <>
      <PageHeader title="Ayarlar" subtitle="Her yetkili çalışan kendi hesabıyla girer; hesaplar paylaşılmaz. Personel kartı ile giriş hesabı ayrı kavramlardır." />
      <SettingsTabs current="/ayarlar" />
      <UserManager users={users} staff={lk.staff} mode={getLoginAdmin().mode} meId={ctx.actor.userId} />
    </>
  );
}
