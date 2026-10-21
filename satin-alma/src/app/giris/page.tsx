import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Notice } from "@/components/ui";
import { ROLES, type Role } from "@/lib/labels";
import { getAuthState } from "@/server/auth";
import { getDb } from "@/server/db";
import { bannerText } from "@/server/demo";
import { authMode } from "@/server/env";
import { firstParam, type SearchParams } from "@/server/page";
import { DevLogin, PasswordLogin } from "./LoginForms";

export const metadata: Metadata = { title: "Giriş" };
export const dynamic = "force-dynamic";

function safeNext(v: string | undefined) {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/giris") ? v : "/";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const next = safeNext(firstParam(sp.next));
  const state = await getAuthState();
  if (state.kind === "ok") redirect(next);
  const mode = authMode();
  const db = await getDb();
  const banner = await bannerText(db);
  const devUsers =
    mode === "dev"
      ? (await db.query<{ id: string; displayName: string; roles: Role[] }>(`select id, display_name as "displayName", roles from app_users where active order by display_name`)).map((u) => ({
          id: u.id, displayName: u.displayName, roleText: u.roles.map((r) => ROLES.label(r)).join(", "),
        }))
      : [];
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- küçük SVG simge */}
        <img src="/icon.svg" alt="" width={56} height={56} className="mx-auto" />
        <h1 className="mt-3 text-2xl font-bold">Satın Alma</h1>
        <p className="text-muted">Özel Koşuyolu Park Ağız ve Diş Sağlığı Polikliniği</p>
        <p className="text-sm text-muted">Sarf malzemesi talep, sipariş, teslimat ve tedarikçi takibi</p>
      </div>
      <div className="space-y-4">
        {firstParam(sp.hata) === "erisim" && (
          <Notice tone="red" title="Erişim yok">Bu hesabın uygulamaya erişimi yok veya kapatılmış. Klinik yöneticisine başvurun.</Notice>
        )}
        {firstParam(sp.cikis) && <Notice tone="green">Çıkış yaptınız.</Notice>}
        {banner && <Notice tone="red" title="Deneme ortamı">{banner}</Notice>}
        <div className="card p-5">{mode === "dev" ? <DevLogin users={devUsers} next={next} /> : <PasswordLogin next={next} />}</div>
        <p className="text-center text-sm text-muted">Bu uygulama operasyonel takip aracıdır; resmî muhasebe veya e-fatura sistemi değildir.</p>
      </div>
    </main>
  );
}
