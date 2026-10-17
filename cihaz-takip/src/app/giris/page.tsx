import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Notice } from "@/components/ui";
import { getAuthState } from "@/server/auth";
import { getDb } from "@/server/db";
import { authMode, environmentLabel } from "@/server/env";
import { firstParam } from "@/server/page";
import { DevLogin, PasswordLogin } from "./LoginForms";

export const metadata: Metadata = { title: "Giriş" };
export const dynamic = "force-dynamic";

function safeNext(v: string | undefined) {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/giris") ? v : "/";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(firstParam(sp.next));
  const state = await getAuthState();
  if (state.kind === "ok") redirect(next);
  const mode = authMode();
  const env = environmentLabel();
  const users =
    mode === "dev"
      ? await (await getDb()).query<{ id: string; displayName: string; role: string; email: string }>(
          `select id, display_name as "displayName", role, email from app_users where active order by role, display_name`,
        )
      : [];
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- küçük SVG simge, optimizasyon gerekmez */}
        <img src="/icon.svg" alt="" width={56} height={56} className="mx-auto" />
        <h1 className="mt-3 text-2xl font-bold tracking-wide">DENTINEL</h1>
        <p className="text-muted">Cihaz, arıza ve teknik servis takibi</p>
        <p className="text-sm text-muted">Özel Koşuyolu Park Ağız ve Diş Sağlığı Polikliniği</p>
      </div>
      <div className="space-y-4">
        {firstParam(sp.hata) === "erisim" && (
          <Notice tone="red" title="Erişim yok">
            Bu hesabın uygulamaya erişimi yok veya kapatılmış. Klinik yöneticisine başvurun.
          </Notice>
        )}
        {firstParam(sp.cikis) && <Notice tone="green">Çıkış yaptınız.</Notice>}
        {env && (
          <Notice tone="red" title={`${env} ORTAMI`}>
            Parolasız deneme girişi açık. Buradaki veriler örnektir; gerçek klinik verisi girmeyin.
          </Notice>
        )}
        <div className="card p-5">{mode === "dev" ? <DevLogin users={users} next={next} /> : <PasswordLogin next={next} />}</div>
        <p className="text-center text-sm text-muted">Hesabınız yoksa klinik yöneticisinden isteyin. Kişisel hesabınızı başkasıyla paylaşmayın.</p>
      </div>
    </main>
  );
}
