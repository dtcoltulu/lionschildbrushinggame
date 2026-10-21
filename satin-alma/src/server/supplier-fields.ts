import type { FieldSpec } from "@/components/ActionPanel";
import { CURRENCIES } from "@/lib/labels";
import type { Supplier } from "./services/suppliers";

/** Tedarikçi kartı alanları (yeni kayıt ve düzenleme aynı tanımı kullanır). */
export function supplierFields(s?: Supplier): FieldSpec[] {
  return [
    { name: "name", label: "Firma / depo adı", type: "text", required: true, initial: s?.name ?? "" },
    { name: "contactName", label: "İlgili kişi", type: "text", initial: s?.contactName ?? "" },
    { name: "phone", label: "Telefon", type: "text", initial: s?.phone ?? "" },
    { name: "email", label: "E-posta", type: "email", initial: s?.email ?? "" },
    { name: "paymentTerms", label: "Ödeme koşulları", type: "text", initial: s?.paymentTerms ?? "", hint: "Örn. “Fatura tarihinden 30 gün, havale”" },
    { name: "dueDays", label: "Varsayılan vade (gün)", type: "int", initial: s?.dueDays?.toString() ?? "", hint: "Fatura girerken vade tarihi önerisi" },
    { name: "currency", label: "Çalışılan para birimi", type: "select", options: CURRENCIES.items.map((c) => ({ value: c.value, label: c.label })), initial: s?.currency ?? "TRY" },
    { name: "notes", label: "Notlar", type: "textarea", initial: s?.notes ?? "" },
    ...(s ? [{ name: "active", label: "Aktif", type: "checkbox" as const, initial: s.active }] : []),
  ];
}
