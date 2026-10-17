"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clearAllDrafts } from "./client";

interface Item {
  href: string;
  label: string;
  short: string;
  icon: string;
  adminOnly?: boolean;
}

const ITEMS: Item[] = [
  { href: "/", label: "Genel bakış", short: "Genel bakış", icon: "◧" },
  { href: "/cihazlar", label: "Cihaz envanteri", short: "Cihazlar", icon: "▤" },
  { href: "/arizalar", label: "Arıza & servis", short: "Arızalar", icon: "⚠" },
  { href: "/analizler", label: "Analizler", short: "Analiz", icon: "▥", adminOnly: true },
  { href: "/calisanlar", label: "Çalışanlar", short: "Çalışanlar", icon: "☺", adminOnly: true },
  { href: "/ayarlar", label: "Ayarlar", short: "Ayarlar", icon: "⚙", adminOnly: true },
];

function active(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function TopNav({ isAdmin, userName }: { isAdmin: boolean; userName: string }) {
  const path = usePathname();
  const items = ITEMS.filter((i) => isAdmin || !i.adminOnly);
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2">
        <Link href="/" className="flex min-h-11 items-center gap-2 font-bold text-ink">
          {/* eslint-disable-next-line @next/next/no-img-element -- küçük SVG simge, optimizasyon gerekmez */}
          <img src="/icon.svg" alt="" width={32} height={32} />
          <span className="leading-tight">
            <span className="block text-[15px] tracking-wide">DENTINEL</span>
            <span className="block text-xs font-medium text-muted">Koşuyolu Park</span>
          </span>
        </Link>
        <nav className="ml-2 hidden flex-1 gap-1 lg:flex" aria-label="Ana menü">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              aria-current={active(path, i.href) ? "page" : undefined}
              title={i.label}
              className={`whitespace-nowrap rounded-lg px-2.5 py-2 text-[15px] font-semibold ${active(path, i.href) ? "bg-brand-soft text-brand-dark" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {i.short}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/arizalar/yeni" className="btn btn-primary btn-sm hidden sm:inline-flex">
            + Arıza bildir
          </Link>
          <Link href="/hesabim" className="btn btn-secondary btn-sm max-w-44" title="Hesabım">
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

/** Telefonda başparmakla ulaşılabilen alt menü; ortadaki büyük düğme arıza bildirir. */
export function BottomNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const left = ITEMS.slice(0, 2);
  const right = isAdmin ? [ITEMS[2]!, { href: "/menu", label: "Diğer", short: "Diğer", icon: "☰" }] : [ITEMS[2]!, { href: "/hesabim", label: "Hesabım", short: "Hesabım", icon: "☺" }];
  const cell = (i: Item) => (
    <Link
      key={i.href}
      href={i.href}
      aria-current={active(path, i.href) ? "page" : undefined}
      className={`flex min-h-14 flex-1 flex-col items-center justify-center text-xs font-semibold ${active(path, i.href) ? "text-brand" : "text-slate-600"}`}
    >
      <span className="text-lg leading-none" aria-hidden>
        {i.icon}
      </span>
      {i.short}
    </Link>
  );
  return (
    <nav aria-label="Alt menü" className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="mx-auto flex max-w-xl items-stretch px-1">
        {left.map(cell)}
        <Link href="/arizalar/yeni" className="mx-1 -mt-4 flex min-h-16 flex-1 flex-col items-center justify-center rounded-2xl bg-brand text-xs font-bold text-white shadow-lg">
          <span className="text-2xl leading-none" aria-hidden>
            +
          </span>
          Arıza bildir
        </Link>
        {right.map(cell)}
      </div>
    </nav>
  );
}
