import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthState } from "@/server/auth";
import { getDb } from "@/server/db";
import { firstParam } from "@/server/page";
import { allClinicChoices } from "@/server/services/clinics";
import { ClinicPicker } from "./ClinicPicker";

export const metadata: Metadata = { title: "Klinik seç" };
export const dynamic = "force-dynamic";

function safeNext(v: string | undefined) {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/giris") && !v.startsWith("/klinik-sec") ? v : "/";
}

/** Genel yöneticinin çalışacağı kliniği seçtiği (ve değiştirdiği) ekran. */
export default async function ChooseClinicPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(firstParam(sp.next));
  const state = await getAuthState();
  if (state.kind === "anonymous" || state.kind === "no_access") redirect(`/giris?${new URLSearchParams({ next })}`);
  if (state.kind === "ok" && !state.actor.superAdmin) redirect(next);
  const clinics = await allClinicChoices(await getDb());
  const name = state.kind === "ok" ? state.actor.displayName : state.displayName;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- küçük SVG simge, optimizasyon gerekmez */}
        <img src="/icon.svg" alt="" width={56} height={56} className="mx-auto" />
        <h1 className="mt-3 text-2xl font-bold tracking-wide">DENTINEL</h1>
        <p className="text-muted">Merhaba {name}</p>
      </div>
      <div className="card space-y-4 p-5">
        <h2 className="text-lg font-bold">Hangi klinikte çalışacaksınız?</h2>
        {clinics.length ? (
          <ClinicPicker clinics={clinics} currentId={state.kind === "ok" ? state.actor.clinicId : null} next={next} />
        ) : (
          <p className="text-muted">Henüz klinik yok.</p>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {state.kind === "ok" && (
          <Link href="/ayarlar/klinikler" className="btn btn-secondary w-full">
            Klinikleri yönet
          </Link>
        )}
        <form action="/api/cikis" method="post">
          <button className="btn btn-secondary w-full">Çıkış yap</button>
        </form>
      </div>
    </main>
  );
}
