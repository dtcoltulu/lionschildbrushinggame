import Link from "next/link";

const TABS = [
  { href: "/ayarlar", label: "Kullanıcılar ve erişim" },
  { href: "/ayarlar/listeler", label: "Listeler" },
  { href: "/ayarlar/gecmis", label: "İşlem geçmişi" },
  { href: "/ayarlar/disa-aktar", label: "Dışa aktarım ve yedek" },
];

export function SettingsTabs({ current }: { current: string }) {
  return (
    <nav className="mb-5 flex gap-2 overflow-x-auto pb-1" aria-label="Ayarlar">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === current ? "page" : undefined} className={`btn btn-sm shrink-0 ${t.href === current ? "btn-primary" : "btn-secondary"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
