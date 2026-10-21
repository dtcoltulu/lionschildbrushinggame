import type { ReactNode } from "react";
import { BottomNav, TopNav } from "@/components/Nav";
import { ROLES } from "@/lib/labels";
import { bannerText } from "@/server/demo";
import { navItems } from "@/server/nav";
import { pageCtx } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Her sayfa ayrıca kendi yetkisini kontrol eder; bu yalnızca kabuk.
  const ctx = await pageCtx();
  const banner = await bannerText(ctx.db);
  const items = navItems(ctx.actor);
  return (
    <div className="min-h-dvh">
      {banner && (
        <div className="bg-red-700 px-4 py-1.5 text-center text-sm font-bold text-white" role="note">
          {banner}
        </div>
      )}
      <TopNav items={items} userName={ctx.actor.displayName} roleText={ctx.actor.roles.map((r) => ROLES.label(r)).join(", ")} />
      <main className="pb-safe mx-auto max-w-6xl px-4 pt-5">{children}</main>
      <BottomNav items={items.filter((i) => i.href !== "/")} />
    </div>
  );
}
