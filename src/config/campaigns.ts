/**
 * Etkinlik / kampanya konfigürasyonu.
 * Yeni bir etkinlik için buraya yeni bir kayıt ekleyip yeniden yayınlayın (redeploy).
 * `campaignId` analytics kayıtlarında kullanılır; yayına çıktıktan sonra DEĞİŞTİRMEYİN.
 */
export interface CampaignConfig {
  campaignId: string;
  eventName: string;
  eventDate: string; // ISO (YYYY-MM-DD)
  eventDateLabel: string;
  eventLocation: string;
  organization: string;
  district: string;
  committee: string;
  reportTitle: string;
  reportSubtitle: string;
  timezone: string;
  rewardLine: string;
  /** Arayüzde küçük gösterilen (hafif) logo. */
  logoPath: string;
  /** QR kodun ortasında kullanılan yüksek çözünürlüklü logo (yoksa logoPath). */
  qrLogoPath?: string;
  /**
   * Her aşama BİTTİKTEN sonra (sahne tamamen temizken, son aşama hariç) "Sence yeterli ve etkin temizlendi mi?" sorusunu açar.
   * Cevaplar (Evet/Hayır) anonim olarak sayılır ve panelde raporlanır. Varsayılan: kapalı.
   */
  selfCheck?: boolean;
  /**
   * Doluysa ödül ekranında "standdaki görevliye göster / diş macunu" kartı yerine bu klinik fırsatı gösterilir
   * (etkinlik bittiği, diş macunu kalmadığı durumlar için).
   */
  clinicOffer?: ClinicOffer;
  active: boolean;
}

export interface ClinicOffer {
  /** Fırsatın başlığı, ör. "Ücretsiz muayene fırsatı!" */
  title: string;
  /** Çocuğa/ebeveyne açıklama cümlesi. Yalnızca doğrulanmış bilgiyi yazın (adres/telefon/koşul uydurmayın). */
  text: string;
  /** İsteğe bağlı ek satır (ör. randevu bilgisi). Boşsa gösterilmez. */
  detail?: string;
  /**
   * İsteğe bağlı klinik web sitesi, yalnızca alan adı olarak ("www.ornek.com"; başına https:// ve yol eklemeyin).
   * Kartın en altında dokunulabilir bağlantı olarak gösterilir (yeni sekmede açılır). Yalnızca klinikten alınan adresi yazın.
   */
  website?: string;
  /** İsteğe bağlı klinik logosu (public altında). */
  logoPath?: string;
  /** Logo için erişilebilir ad. */
  logoAlt?: string;
}

export const CAMPAIGNS: readonly CampaignConfig[] = [
  {
    campaignId: "lions-118y-2026-10-11",
    eventName: "Dünya Lions Hizmet Günü",
    eventDate: "2026-10-11",
    eventDateLabel: "11 Ekim 2026",
    eventLocation: "Özgürlük Parkı, Kadıköy / İstanbul",
    organization: "118-Y Lions",
    district: "118-Y Lions Bölgesi",
    committee: "Ağız ve Diş Sağlığı Komitesi",
    reportTitle: "11 Ekim Dünya Lions Hizmet Günü",
    reportSubtitle:
      "118-Y Sağlık Hedef Liderliği · Ağız ve Diş Sağlığı Komitesi · Dijital Ağız ve Diş Sağlığı Farkındalık Etkinliği",
    timezone: "Europe/Istanbul",
    rewardLine: "Diş macunu hediyeni al.",
    logoPath: "/assets/lions-logo.png",
    qrLogoPath: "/assets/lions-logo-hd.png",
    active: true,
  },
  {
    // Deneme/prova kampanyası: etkinlik öncesi testler ve simülasyon için. Gerçek istatistikleri kirletmez.
    // Kullanım: https://alanadi.org/oyun?k=test-deneme
    campaignId: "test-deneme",
    eventName: "Deneme (Test)",
    eventDate: "2026-10-01",
    eventDateLabel: "prova",
    eventLocation: "Deneme amaçlı",
    organization: "118-Y Lions",
    district: "118-Y Lions Bölgesi",
    committee: "Ağız ve Diş Sağlığı Komitesi",
    reportTitle: "DENEME – Dünya Lions Hizmet Günü",
    reportSubtitle: "Test verisi – gerçek rapor değildir",
    timezone: "Europe/Istanbul",
    rewardLine: "Diş macunu hediyeni al.",
    logoPath: "/assets/lions-logo.png",
    qrLogoPath: "/assets/lions-logo-hd.png",
    // Yeni özellikler önce yalnızca deneme kampanyasında denenir; asıl kampanya değişmez.
    selfCheck: true,
    clinicOffer: {
      title: "Ücretsiz muayene fırsatı!",
      text: "Koşuyolu Park Diş Kliniği'nde dişlerini ücretsiz muayene ettirebilirsin.",
      website: "www.kosuyolupark.com",
      logoPath: "/assets/kosuyolu-park.png",
      logoAlt: "Koşuyolu Park Diş Kliniği",
    },
    active: true,
  },
];

export const FALLBACK_CAMPAIGN_ID = CAMPAIGNS[0]!.campaignId;

export function getDefaultCampaignId(): string {
  const fromEnv = process.env.NEXT_PUBLIC_DEFAULT_CAMPAIGN;
  return fromEnv && findCampaign(fromEnv) ? fromEnv : FALLBACK_CAMPAIGN_ID;
}

export function findCampaign(id: string | null | undefined): CampaignConfig | undefined {
  if (!id) return undefined;
  return CAMPAIGNS.find((c) => c.campaignId === id);
}

export function resolveCampaign(id?: string | null): CampaignConfig {
  return findCampaign(id) ?? findCampaign(getDefaultCampaignId()) ?? CAMPAIGNS[0]!;
}

export function isKnownCampaign(id: string): boolean {
  return CAMPAIGNS.some((c) => c.campaignId === id);
}
