import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/ui";
import { CLINIC_COOKIE, getAuthState } from "@/server/auth";
import { getDb } from "@/server/db";
import { authMode, environmentLabel } from "@/server/env";
import { firstParam } from "@/server/page";
import { loginClinics } from "@/server/services/clinics";
import { ClinicLogin, DevLogin, PasswordLogin } from "./LoginForms";

export const metadata: Metadata = { title: "Giriş" };
export const dynamic = "force-dynamic";

function safeNext(v: string | undefined) {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/giris") ? v : "/";
}

type DevUser = { id: string; displayName: string; role: string; email: string };

/**
 * Giriş: önce klinik seçilir (cihazda hatırlanır), sonra kliniğin personel ya da yönetici şifresi yazılır.
 * Genel yönetici (ve varsa kişisel hesaplar) "E-posta ile giriş" ile girer.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(firstParam(sp.next));
  const state = await getAuthState();
  if (state.kind === "ok") redirect(next);
  if (state.kind === "choose_clinic") redirect(`/klinik-sec?${new URLSearchParams({ next })}`);
  const mode = authMode();
  const env = environmentLabel();
  const db = await getDb();
  const clinics = await loginClinics(db);
  const byEmail = firstParam(sp.genel) === "1";
  const wanted = firstParam(sp.klinik) ?? (firstParam(sp.sec) ? undefined : (await cookies()).get(CLINIC_COOKIE)?.value);
  const clinic = byEmail ? undefined : clinics.find((c) => c.id === wanted);
  const link = (extra: Record<string, string>) => `/giris?${new URLSearchParams({ ...extra, ...(next !== "/" ? { next } : {}) })}`;

  let devUsers: DevUser[] = [];
  if (mode === "dev" && (byEmail || clinic)) {
    devUsers = byEmail
      ? await db.query<DevUser>(
          `select id, display_name as "displayName", role, email from app_users where active and not shared order by clinic_id nulls first, role, display_name`,
        )
      : await db.query<DevUser>(
          `select id, display_name as "displayName", role, email from app_users where active and clinic_id = $1 order by shared desc, role, display_name`,
          [clinic!.id],
        );
  }

  const hata = firstParam(sp.hata);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- küçük SVG simge, optimizasyon gerekmez */}
        <img src="/icon.svg" alt="" width={56} height={56} className="mx-auto" />
        <h1 className="mt-3 text-2xl font-bold tracking-wide">DENTINEL</h1>
        <p className="text-muted">Cihaz, arıza ve teknik servis takibi</p>
      </div>
      <div className="space-y-4">
        {hata === "erisim" && (
          <Notice tone="red" title="Erişim yok">
            Bu hesabın uygulamaya erişimi yok veya kapatılmış. Klinik yöneticisine başvurun.
          </Notice>
        )}
        {hata === "klinik" && (
          <Notice tone="red" title="Kliniğin erişimi kapalı">
            Bu kliniğin erişimi kapatılmış. Genel yöneticiye başvurun.
          </Notice>
        )}
        {firstParam(sp.cikis) && <Notice tone="green">Çıkış yaptınız.</Notice>}
        {env && (
          <Notice tone="red" title={`${env} ORTAMI`}>
            Şifresiz deneme girişi açık. Buradaki veriler örnektir; gerçek klinik verisi girmeyin.
          </Notice>
        )}
        <div className="card space-y-4 p-5">
          {byEmail ? (
            <>
              <h2 className="text-lg font-bold">E-posta ile giriş</h2>
              <p className="text-sm text-muted">Genel yönetici ve kişisel hesabı olanlar için.</p>
              {mode === "dev" ? <DevLogin users={devUsers} next={next} /> : <PasswordLogin next={next} />}
            </>
          ) : clinic ? (
            <>
              <div>
                <p className="text-sm font-semibold text-muted">Klinik</p>
                <h2 className="text-xl font-bold">{clinic.name}</h2>
              </div>
              {mode === "dev" ? <DevLogin users={devUsers} next={next} clinicId={clinic.id} /> : <ClinicLogin clinicId={clinic.id} next={next} />}
              <Link href={link({ sec: "1" })} className="btn btn-secondary btn-sm w-full">
                Başka klinik seç
              </Link>
            </>
          ) : (
            <>
              <h2 className="text-lg font-bold">Kliniğinizi seçin</h2>
              {clinics.length ? (
                <ul className="space-y-2">
                  {clinics.map((c) => (
                    <li key={c.id}>
                      <Link href={link({ klinik: c.id })} className="btn btn-secondary w-full justify-between">
                        <span>{c.name}</span>
                        <span aria-hidden>›</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">Henüz klinik yok. Genel yönetici e-posta ile girip klinik ekler.</p>
              )}
            </>
          )}
        </div>
        <p className="text-center text-sm">
          {byEmail ? (
            <Link href={link({ sec: "1" })} className="font-semibold text-brand-dark underline">
              ← Klinik şifresiyle giriş
            </Link>
          ) : (
            <Link href={link({ genel: "1" })} className="font-semibold text-brand-dark underline">
              Genel yönetici / e-posta ile giriş
            </Link>
          )}
        </p>
        <p className="text-center text-sm text-muted">Klinik şifrelerini yalnızca o kliniğin çalışanlarıyla paylaşın.</p>
      </div>
    </main>
  );
}
