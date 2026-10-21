import type { NavItem } from "@/components/Nav";
import type { Actor } from "./context";
import { can } from "./permissions";

/** Kullanıcının rollerine göre menü. Görünmeyen sayfalar sunucuda da kapalıdır. */
export function navItems(a: Actor): NavItem[] {
  const items: (NavItem & { show: boolean })[] = [
    { href: "/", label: "Ana sayfa", icon: "◧", show: true },
    { href: "/talepler", label: "Talepler", icon: "✎", show: can(a, "request.create") },
    { href: "/teslimatlar", label: "Teslimat", icon: "⇩", show: can(a, "receipt.record") && !can(a, "order.manage") },
    { href: "/siparisler", label: "Siparişler", icon: "▤", show: can(a, "order.view") },
    { href: "/sorunlar", label: "Sorunlar", icon: "⚠", show: can(a, "order.view") || can(a, "issue.report") },
    { href: "/katalog", label: "Katalog", icon: "▦", show: can(a, "catalog.view") },
    { href: "/tedarikciler", label: "Tedarikçiler", icon: "⌂", show: can(a, "supplier.view") },
    { href: "/finans", label: "Finans", icon: "₺", show: can(a, "finance.view") },
    { href: "/raporlar", label: "Raporlar", icon: "▥", show: can(a, "reports.view") },
    { href: "/ayarlar", label: "Ayarlar", icon: "⚙", show: can(a, "users.manage") || can(a, "lookups.manage") || can(a, "audit.view") },
  ];
  return items.filter((i) => i.show).map((i) => ({ href: i.href, label: i.label, icon: i.icon }));
}
