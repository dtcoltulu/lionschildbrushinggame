import type { Actor } from "./context";
import { can } from "./permissions";

export function settingsTabs(a: Actor) {
  return [
    ...(can(a, "users.manage") ? [{ key: "kullanicilar", label: "Kullanıcılar ve roller", href: "/ayarlar" }] : []),
    ...(can(a, "lookups.manage") ? [{ key: "listeler", label: "Oda / bölüm ve kategoriler", href: "/ayarlar/listeler" }] : []),
    ...(can(a, "audit.view") ? [{ key: "gecmis", label: "İşlem geçmişi", href: "/ayarlar/gecmis" }] : []),
    ...(can(a, "export.operations") ? [{ key: "disa-aktar", label: "Dışa aktarım ve yedek", href: "/ayarlar/disa-aktar" }] : []),
  ];
}
