"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clearAllDrafts } from "./client";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

function active(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

/** Menü öğeleri sunucuda kullanıcının yetkilerine göre hazırlanır; burada yalnızca gösterilir (yetki kontrolü sunucudadır). */
export function TopNav({ items, userName, roleText }: { items: NavItem[]; userName: string; roleText: string }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
        <Link href="/" className="flex min-h-11 items-center gap-2 font-bold text-ink">
          {/* eslint-disable-next-line @next/next/no-img-element -- küçük SVG simge */}
          <img src="/icon.svg" alt="" width={32} height={32} />
          <span className="leading-tight">
            <span className="block text-[15px]">Satın Alma</span>
            <span className="block text-xs font-medium text-muted">Koşuyolu Park</span>
          </span>
        </Link>
        <nav className="ml-2 hidden flex-1 gap-1 lg:flex" aria-label="Ana menü">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              aria-current={active(path, i.href) ? "page" : undefined}
              className={`whitespace-nowrap rounded-lg px-2.5 py-2 text-[15px] font-semibold ${active(path, i.href) ? "bg-brand-soft text-brand-dark" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/talepler/yeni" className="btn btn-primary btn-sm hidden sm:inline-flex">
            + Talep
          </Link>
          <Link href="/hesabim" className="btn btn-secondary btn-sm max-w-48" title={roleText}>
            <span className="truncate">{userName}</span>
          </Link>
          <form action="/api/cikis" method="post" onSubmit={() => clearAllDrafts()} className="hidden lg:block">
            <button className="btn btn-secondary btn-sm" type="submit">
              Çıkış
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

/** Telefonda alt menü; ortadaki büyük düğme hızlı talep açar. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const cell = (i: NavItem) => (
    <Link
      key={i.href}
      href={i.href}
      aria-current={active(path, i.href) ? "page" : undefined}
      className={`flex min-h-14 flex-1 flex-col items-center justify-center text-xs font-semibold ${active(path, i.href) ? "text-brand" : "text-slate-600"}`}
    >
      <span className="text-lg leading-none" aria-hidden>
        {i.icon}
      </span>
      {i.label}
    </Link>
  );
  return (
    <nav aria-label="Alt menü" className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="mx-auto flex max-w-xl items-stretch px-1">
        {items.slice(0, 2).map(cell)}
        <Link href="/talepler/yeni" className="mx-1 -mt-4 flex min-h-16 flex-1 flex-col items-center justify-center rounded-2xl bg-brand text-xs font-bold text-white shadow-lg">
          <span className="text-2xl leading-none" aria-hidden>
            +
          </span>
          Talep
        </Link>
        {items.slice(2, 3).map(cell)}
        {cell({ href: "/menu", label: "Diğer", icon: "☰" })}
      </div>
    </nav>
  );
}
