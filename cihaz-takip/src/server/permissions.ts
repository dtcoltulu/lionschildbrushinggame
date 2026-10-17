import type { Actor } from "./context";
import { ForbiddenError } from "./errors";

/**
 * Yetkiler SUNUCUDA uygulanır: her servis fonksiyonu işlemden önce assertCan çağırır.
 * Arayüzde düğme gizlemek yalnızca kolaylıktır, güvenlik değildir.
 */
export type Permission =
  | "device.create"
  | "device.edit"
  | "device.retire" // envanterden çıkarma / geri alma
  | "device.recode" // envanter kodunu değiştirme
  | "fault.create"
  | "fault.edit"
  | "fault.assignResponsibility" // arızaya neden olan kişinin doğrulanmış ataması
  | "fault.requestDelete"
  | "fault.delete" // mantıksal silme
  | "fault.restore"
  | "fault.purge" // kalıcı silme
  | "vendor.create"
  | "lookups.manage"
  | "staff.manage"
  | "users.manage"
  | "analytics.view"
  | "costs.view"
  | "export"
  | "audit.view";

const STAFF_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "device.create",
  "device.edit",
  "fault.create",
  "fault.edit",
  "fault.requestDelete",
  "vendor.create",
]);

export function can(actor: Pick<Actor, "role">, perm: Permission): boolean {
  if (actor.role === "admin") return true;
  return STAFF_PERMISSIONS.has(perm);
}

const MESSAGES: Partial<Record<Permission, string>> = {
  "fault.delete": "Kayıt silme yalnızca yöneticiye açıktır. Yanlış kaydı “Silinmesini iste” ile yöneticiye bildirebilirsiniz.",
  "fault.purge": "Kalıcı silme yalnızca yöneticiye açıktır.",
  "fault.restore": "Silinen kaydı geri alma yalnızca yöneticiye açıktır.",
  "users.manage": "Kullanıcı erişimini yalnızca yönetici yönetebilir.",
  "staff.manage": "Personel kartlarını yalnızca yönetici yönetebilir.",
  "device.retire": "Cihazı envanterden çıkarma yalnızca yöneticiye açıktır.",
  "device.recode": "Envanter kodunu yalnızca yönetici değiştirebilir.",
  "fault.assignResponsibility": "Sorumluluk atamasını yalnızca yönetici yapabilir.",
};

export function assertCan(actor: Pick<Actor, "role">, perm: Permission): void {
  if (!can(actor, perm)) throw new ForbiddenError(MESSAGES[perm]);
}
