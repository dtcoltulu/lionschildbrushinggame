import { redirect } from "next/navigation";
import { adminConfigured } from "@/lib/auth";
import { isAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  bad: "Parola hatalı.",
  locked: "Çok fazla hatalı deneme. Birkaç dakika sonra tekrar deneyin.",
  config: "Yönetici girişi yapılandırılmamış (ADMIN_PASSWORD ve ADMIN_SESSION_SECRET gerekli).",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  if (await isAdmin()) redirect("/admin");
  const next = sp.next === "/qr" || sp.next?.startsWith("/admin") ? sp.next : "/admin";
  const error = sp.error ? (ERRORS[sp.error] ?? "Giriş yapılamadı.") : null;
  const configured = adminConfigured();

  return (
    <main className="screen mx-auto flex max-w-sm flex-col justify-center gap-4 px-5">
      <h1 className="text-3xl font-black text-purple">Yönetici Girişi</h1>
      <p className="text-sm text-ink/70">118-Y Lions · Diş Sağlığı Oyunu</p>
      {(error || !configured) && (
        <p role="alert" className="rounded-xl bg-coral/15 p-3 text-sm font-semibold text-ink ring-1 ring-coral">
          ⚠️ {error ?? ERRORS.config}
        </p>
      )}
      <form method="post" action="/api/admin/login" className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <label className="flex flex-col gap-1 text-sm font-bold">
          Parola
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="min-h-[52px] rounded-xl border-2 border-purple/40 bg-white px-3 text-lg"
          />
        </label>
        <button type="submit" className="btn-big btn-gold text-xl">
          Giriş yap
        </button>
      </form>
    </main>
  );
}
