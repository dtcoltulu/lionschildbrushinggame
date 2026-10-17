import type { ReactNode } from "react";
import { BottomNav, TopNav } from "@/components/Nav";
import { requirePageActor } from "@/server/auth";
import { environmentLabel } from "@/server/env";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Her sayfa ayrıca kendi yetkisini kontrol eder; bu yalnızca kabuk için.
  const actor = await requirePageActor();
  const env = environmentLabel();
  return (
    <div className="min-h-dvh">
      {env && (
        <div className="bg-red-700 px-4 py-1.5 text-center text-sm font-bold text-white" role="note">
          {env} ORTAMI – örnek/deneme verileri. Gerçek klinik verisi girmeyin.
        </div>
      )}
      <TopNav isAdmin={actor.role === "admin"} userName={actor.displayName} />
      <main className="pb-safe mx-auto max-w-6xl px-4 pt-5">{children}</main>
      <BottomNav isAdmin={actor.role === "admin"} />
    </div>
  );
}
