import { describe, expect, it } from "vitest";
import { CAMPAIGNS, findCampaign, FALLBACK_CAMPAIGN_ID } from "@/config/campaigns";

describe("kampanya ayarları: soru iki kampanyada da açık, klinik fırsatı yalnızca deneme kampanyasında", () => {
  it("asıl kampanyada (etkinlik) soru açık; klinik fırsatı kapalı ve diş macunu kartı değişmez", () => {
    const main = findCampaign(FALLBACK_CAMPAIGN_ID)!;
    expect(main.campaignId).toBe("lions-118y-2026-10-11");
    expect(main.selfCheck).toBe(true);
    expect(main.clinicOffer).toBeUndefined();
    expect(main.rewardLine).toBe("Diş macunu hediyeni al.");
  });

  it("deneme kampanyasında soru açık ve klinik fırsatı tanımlı (web sitesi klinikten gelen adresle)", () => {
    const t = findCampaign("test-deneme")!;
    expect(t.selfCheck).toBe(true);
    expect(t.clinicOffer?.title).toBe("Ücretsiz muayene fırsatı!");
    expect(t.clinicOffer?.text).toContain("Koşuyolu Park Diş Kliniği");
    expect(t.clinicOffer?.logoPath).toBe("/assets/kosuyolu-park.png");
    expect(t.clinicOffer?.website).toBe("www.kosuyolupark.com");
  });

  it("klinik fırsatı metninde uydurma iletişim bilgisi yok (telefon/adres yalnızca onaylı `detail` ile, site yalnızca `website` ile eklenir)", () => {
    for (const c of CAMPAIGNS) {
      const o = c.clinicOffer;
      if (!o) continue;
      expect(`${o.title} ${o.text}`).not.toMatch(/\d{3}[ -]?\d{3}|@|www\.|http/i);
      expect(o.detail).toBeUndefined();
      // Site yalnızca alan adıdır (şema, yol, boşluk yok): bağlantı her zaman https://<alan adı> olarak kurulur.
      if (o.website) expect(o.website).toMatch(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/);
    }
  });
});
