import { daysBetween } from "./dates";
import type { Availability, FaultStatus, Lifecycle, Outcome } from "./labels";

/** Açık arızanın cihaz kartına yansıyan özeti. */
export interface OpenFaultSummary {
  id: string;
  status: FaultStatus;
  expectedReturnOn: string | null;
  outcome: Outcome | null;
}

/**
 * Cihazın şu an kullanılabilir olup olmadığı. "Tamirden geldi" tek başına kullanılabilir demek
 * DEĞİLDİR: yalnızca sonuç "Kullanıma hazır" seçilince arıza kapanır ve cihaz kullanılabilir olur.
 */
export function deviceAvailability(lifecycle: Lifecycle, open: OpenFaultSummary | null, today: string): Availability {
  if (lifecycle === "envanterden_cikarildi") return "cikarildi";
  if (open) {
    if (open.status === "serviste") return isOverdue(open.expectedReturnOn, today) ? "gecikti" : "serviste";
    if (open.status === "tamirden_geldi") return open.outcome === "denenmedi" ? "denenmedi" : "sorun_devam";
    return "arizali";
  }
  if (lifecycle === "kullanim_disi") return "kullanim_disi";
  return "kullanilabilir";
}

/** Beklenen dönüş tarihi geçti mi? (Kaydı engellemez; yalnızca "Gecikti" gösterilir.) */
export function isOverdue(expectedReturnOn: string | null, today: string): boolean {
  return !!expectedReturnOn && expectedReturnOn < today;
}

export function overdueDays(expectedReturnOn: string | null, today: string): number {
  return expectedReturnOn && expectedReturnOn < today ? daysBetween(expectedReturnOn, today) : 0;
}

/**
 * Servis süresi (gün). Gönderim veya dönüş tarihi bilinmiyorsa tarih uydurulmaz:
 * hesap yapılamadığı açıkça bildirilir.
 */
export function serviceDuration(v: {
  sentOn: string | null;
  returned: boolean;
  returnedOn: string | null;
}, today: string): { days: number | null; note: string } {
  if (!v.sentOn) return { days: null, note: "Süre hesaplanamadı: gönderim tarihi girilmemiş" };
  if (!v.returned) return { days: daysBetween(v.sentOn, today), note: "Hâlâ serviste (bugüne kadar)" };
  if (!v.returnedOn) return { days: null, note: "Süre hesaplanamadı: gerçek dönüş tarihi girilmemiş" };
  return { days: daysBetween(v.sentOn, v.returnedOn), note: "" };
}

export type FaultDisplay = "arizali" | "serviste" | "gecikti" | "hazir" | "sorun_devam" | "denenmedi" | "cozuldu";

/** Arıza kaydının listede görünen durumu (gecikme ve dönüş sonucu dahil). */
export function faultDisplay(
  status: string,
  current: { outcome: string | null; expectedReturnOn: string | null } | null,
  today: string,
): { key: FaultDisplay; label: string; tone: "red" | "amber" | "orange" | "green" | "purple" | "gray" } {
  switch (status) {
    case "serviste":
      return isOverdue(current?.expectedReturnOn ?? null, today)
        ? { key: "gecikti", label: `Serviste – gecikti (${overdueDays(current?.expectedReturnOn ?? null, today)} gün)`, tone: "orange" }
        : { key: "serviste", label: "Serviste", tone: "amber" };
    case "tamirden_geldi":
      if (current?.outcome === "kullanima_hazir") return { key: "hazir", label: "Tamirden geldi – kullanıma hazır", tone: "green" };
      if (current?.outcome === "denenmedi") return { key: "denenmedi", label: "Tamirden geldi – henüz denenmedi", tone: "purple" };
      return { key: "sorun_devam", label: "Tamirden geldi – sorun devam ediyor", tone: "purple" };
    case "cozuldu":
      return { key: "cozuldu", label: "Servise gitmeden çözüldü", tone: "gray" };
    default:
      return { key: "arizali", label: "Arızalı", tone: "red" };
  }
}
