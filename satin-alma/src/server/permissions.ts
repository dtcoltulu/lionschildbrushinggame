import type { Role } from "@/lib/labels";
import type { Actor } from "./context";
import { ForbiddenError } from "./errors";

/**
 * Yetkiler SUNUCUDA uygulanır: her servis fonksiyonu işlemden önce assertCan çağırır.
 * Arayüzde menü/düğme gizlemek yalnızca kolaylıktır, güvenlik değildir.
 * Bir kullanıcının birden fazla rolü olabilir; yetkiler rollerin birleşimidir.
 */
export type Permission =
  | "request.create"
  | "request.viewAll" // asistan yalnızca kendi taleplerini görür
  | "request.decide" // onay, ret, katalog eşleştirme, siparişe bağlama
  | "catalog.view"
  | "catalog.manage"
  | "lookups.manage" // oda/bölüm ve kategori listeleri
  | "supplier.view"
  | "supplier.manage"
  | "price.view" // fiyat geçmişi, teklif, sipariş tutarları
  | "quote.manage"
  | "order.view" // tüm siparişler (teslimat sorumlusu yalnızca atandığı siparişleri görür)
  | "order.manage"
  | "receipt.record" // teslimat sorumlusu: yalnızca atandığı siparişler (servis ayrıca kontrol eder)
  | "receipt.cancel"
  | "issue.report"
  | "issue.resolve"
  | "finance.view" // fatura, borç, ödeme, vade
  | "finance.manage"
  | "adjustment.approve"
  | "reports.view" // harcama ve tedarikçi raporları
  | "export.operations"
  | "export.finance"
  | "users.manage"
  | "audit.view";

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  asistan: ["request.create", "catalog.view"],
  teslimat: ["request.create", "catalog.view", "receipt.record", "issue.report"],
  satinalma: [
    "request.create", "request.viewAll", "request.decide", "catalog.view", "catalog.manage", "lookups.manage", "supplier.view",
    "supplier.manage", "price.view", "quote.manage", "order.view", "order.manage", "receipt.record", "receipt.cancel", "issue.report",
    "issue.resolve", "export.operations", "audit.view",
  ],
  finans: [
    "request.create", "catalog.view", "supplier.view", "supplier.manage", "price.view", "order.view", "finance.view", "finance.manage",
    "adjustment.approve", "reports.view", "export.operations", "export.finance", "users.manage", "audit.view",
  ],
};

export function can(actor: Pick<Actor, "roles">, perm: Permission): boolean {
  return actor.roles.some((r) => ROLE_PERMISSIONS[r]?.includes(perm));
}

export const hasRole = (actor: Pick<Actor, "roles">, role: Role) => actor.roles.includes(role);

const MESSAGES: Partial<Record<Permission, string>> = {
  "finance.view": "Fatura, borç ve ödeme bilgileri yalnızca finans / klinik yöneticisi rolüne açıktır.",
  "finance.manage": "Fatura ve ödeme kaydı yalnızca finans / klinik yöneticisi rolüne açıktır.",
  "reports.view": "Harcama raporları yalnızca finans / klinik yöneticisi rolüne açıktır.",
  "export.finance": "Finansal dışa aktarım yalnızca finans / klinik yöneticisi rolüne açıktır.",
  "adjustment.approve": "Finansal düzeltmeyi yalnızca finans / klinik yöneticisi onaylayabilir.",
  "request.decide": "Talepleri yalnızca yönetim / satın alma değerlendirebilir.",
  "order.manage": "Sipariş işlemleri yalnızca yönetim / satın alma rolüne açıktır.",
  "issue.resolve": "Teslimat sorunlarını yalnızca yönetim / satın alma çözebilir.",
  "users.manage": "Kullanıcıları yalnızca finans / klinik yöneticisi yönetebilir.",
  "price.view": "Fiyat bilgileri bu rol için kapalıdır.",
  "receipt.record": "Teslimat kontrolü için teslimat sorumlusu veya satın alma rolü gerekir.",
};

export function assertCan(actor: Pick<Actor, "roles">, perm: Permission): void {
  if (!can(actor, perm)) throw new ForbiddenError(MESSAGES[perm] ?? "Bu işlem için yetkiniz yok.");
}
