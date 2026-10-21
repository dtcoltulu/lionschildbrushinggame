import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { navItems } from "@/server/nav";
import { pageCtx } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function MenuPage() {
  const ctx = await pageCtx();
  return (
    <>
      <PageHeader title="Menü" />
      <ul className="grid gap-2 sm:grid-cols-2">
        {navItems(ctx.actor).map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="card flex min-h-14 items-center gap-3 px-4 font-semibold">
              <span aria-hidden className="text-xl">{i.icon}</span>
              {i.label}
            </Link>
          </li>
        ))}
        <li>
          <Link href="/hesabim" className="card flex min-h-14 items-center gap-3 px-4 font-semibold">
            <span aria-hidden className="text-xl">☺</span>
            Hesabım
          </Link>
        </li>
      </ul>
      <form action="/api/cikis" method="post" className="mt-6">
        <button className="btn btn-secondary w-full" type="submit">Çıkış yap</button>
      </form>
    </>
  );
}
