/** Arayüzde görünen tüm sabit Türkçe etiketler tek yerde. */

export const JOB_ROLES = [
  { value: "dis_hekimi", label: "Diş hekimi" },
  { value: "uzman_dis_hekimi", label: "Uzman diş hekimi" },
  { value: "klinik_muduru", label: "Klinik müdürü" },
  { value: "asistan", label: "Asistan" },
  { value: "sekreter", label: "Sekreter / hasta danışmanı" },
  { value: "muhasebe", label: "Muhasebe" },
  { value: "destek", label: "Destek / temizlik personeli" },
  { value: "diger", label: "Diğer" },
] as const;
export type JobRole = (typeof JOB_ROLES)[number]["value"];
export const JOB_ROLE_VALUES = JOB_ROLES.map((r) => r.value) as JobRole[];
export function jobRoleLabel(v: string): string {
  return JOB_ROLES.find((r) => r.value === v)?.label ?? v;
}

export const LIFECYCLES = [
  { value: "aktif", label: "Aktif" },
  { value: "kullanim_disi", label: "Kullanım dışı" },
  { value: "envanterden_cikarildi", label: "Envanterden çıkarıldı" },
] as const;
export type Lifecycle = (typeof LIFECYCLES)[number]["value"];
export const LIFECYCLE_VALUES = LIFECYCLES.map((r) => r.value) as Lifecycle[];
export function lifecycleLabel(v: string): string {
  return LIFECYCLES.find((r) => r.value === v)?.label ?? v;
}

export const FAULT_STATUSES = [
  { value: "arizali", label: "Arızalı" },
  { value: "serviste", label: "Serviste" },
  { value: "tamirden_geldi", label: "Tamirden geldi" },
  { value: "cozuldu", label: "Servise gitmeden çözüldü" },
] as const;
export type FaultStatus = (typeof FAULT_STATUSES)[number]["value"];
export const FAULT_STATUS_VALUES = FAULT_STATUSES.map((r) => r.value) as FaultStatus[];
export function faultStatusLabel(v: string): string {
  return FAULT_STATUSES.find((r) => r.value === v)?.label ?? v;
}

export const OUTCOMES = [
  { value: "kullanima_hazir", label: "Kullanıma hazır" },
  { value: "sorun_devam", label: "Sorun devam ediyor" },
  { value: "denenmedi", label: "Henüz denenmedi" },
] as const;
export type Outcome = (typeof OUTCOMES)[number]["value"];
export const OUTCOME_VALUES = OUTCOMES.map((r) => r.value) as Outcome[];
export function outcomeLabel(v: string | null | undefined): string {
  return OUTCOMES.find((r) => r.value === v)?.label ?? "—";
}

export const VERIFICATIONS = [
  { value: "on_degerlendirme", label: "Ön değerlendirme" },
  { value: "servis_dogruladi", label: "Servis tarafından doğrulandı" },
  { value: "klinik_dogruladi", label: "Klinik kontrolüyle doğrulandı" },
] as const;
export type Verification = (typeof VERIFICATIONS)[number]["value"];
export const VERIFICATION_VALUES = VERIFICATIONS.map((r) => r.value) as Verification[];
export function verificationLabel(v: string): string {
  return VERIFICATIONS.find((r) => r.value === v)?.label ?? v;
}

export const USER_ROLES = [
  { value: "admin", label: "Yönetici" },
  { value: "staff", label: "Personel" },
] as const;
export type UserRole = (typeof USER_ROLES)[number]["value"];
export function userRoleLabel(v: string): string {
  return USER_ROLES.find((r) => r.value === v)?.label ?? v;
}

/** Cihazın şu anki kullanılabilirliği (yaşam döngüsü + açık arıza durumundan türetilir). */
export type Availability =
  | "kullanilabilir"
  | "arizali"
  | "serviste"
  | "gecikti"
  | "sorun_devam"
  | "denenmedi"
  | "kullanim_disi"
  | "cikarildi";

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  kullanilabilir: "Kullanılabilir",
  arizali: "Arızalı",
  serviste: "Serviste",
  gecikti: "Serviste – gecikti",
  sorun_devam: "Tamirden geldi – sorun devam ediyor",
  denenmedi: "Tamirden geldi – henüz denenmedi",
  kullanim_disi: "Kullanım dışı",
  cikarildi: "Envanterden çıkarıldı",
};

export type Tone = "green" | "red" | "amber" | "orange" | "purple" | "gray" | "blue";

export const AVAILABILITY_TONES: Record<Availability, Tone> = {
  kullanilabilir: "green",
  arizali: "red",
  serviste: "amber",
  gecikti: "orange",
  sorun_devam: "purple",
  denenmedi: "purple",
  kullanim_disi: "gray",
  cikarildi: "gray",
};
