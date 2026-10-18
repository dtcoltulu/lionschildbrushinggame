import type { Metadata } from "next";
import { PasswordChange } from "@/components/PasswordChange";
import { Card, Info, PageHeader } from "@/components/ui";
import { userRoleLabel } from "@/lib/labels";
import { authMode } from "@/server/env";
import { pageCtx } from "@/server/page";
import { getUser } from "@/server/services/users";

export const metadata: Metadata = { title: "Hesabım" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const ctx = await pageCtx();
  const u = await getUser(ctx.db, ctx.actor.userId);
  return (
    <>
      <PageHeader title="Hesabım" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Bilgiler">
          <dl>
            <Info label="Ad">{ctx.actor.displayName}</Info>
            <Info label="Klinik">{ctx.actor.clinicName}</Info>
            {!ctx.actor.shared && <Info label="E-posta (giriş adı)">{ctx.actor.email}</Info>}
            <Info label="Rol">{ctx.actor.superAdmin ? "Genel yönetici (tüm klinikler)" : userRoleLabel(ctx.actor.role)}</Info>
            <Info label="Bağlı personel kartı" missing="Bağlı değil">{u?.staffName}</Info>
          </dl>
          <form action="/api/cikis" method="post" className="mt-4">
            <button className="btn btn-secondary w-full">Çıkış yap</button>
          </form>
        </Card>
        {authMode() === "supabase" && !ctx.actor.shared && (
          <Card title="Parolayı değiştir">
            <PasswordChange />
          </Card>
        )}
        {ctx.actor.shared && (
          <Card title="Klinik şifresi">
            <p className="text-muted">
              Bu, kliniğin ortak girişidir. Şifreyi kliniğin yöneticisi Ayarlar → Giriş ve erişim bölümünden değiştirir; değişince eski oturumlar kapanır.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
