import { PasswordChange } from "@/components/PasswordChange";
import { Card, Info, PageHeader } from "@/components/ui";
import { ROLES } from "@/lib/labels";
import { authMode } from "@/server/env";
import { pageCtx } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const ctx = await pageCtx();
  return (
    <>
      <PageHeader title="Hesabım" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Bilgiler">
          <dl>
            <Info label="Ad soyad">{ctx.actor.displayName}</Info>
            <Info label="E-posta">{ctx.actor.email}</Info>
            <Info label="Roller">{ctx.actor.roles.map((r) => ROLES.label(r)).join(", ")}</Info>
            <Info label="Klinik">{ctx.actor.clinicName}</Info>
          </dl>
        </Card>
        <Card title="Parola">{authMode() === "supabase" ? <PasswordChange /> : <p className="text-muted">Geliştirme ortamında parola kullanılmaz.</p>}</Card>
      </div>
      <form action="/api/cikis" method="post" className="mt-6 lg:hidden">
        <button className="btn btn-secondary w-full" type="submit">Çıkış yap</button>
      </form>
    </>
  );
}
