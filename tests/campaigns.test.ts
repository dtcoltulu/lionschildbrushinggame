import { describe, expect, it } from "vitest";
import { CAMPAIGNS, findCampaign, FALLBACK_CAMPAIGN_ID } from "@/config/campaigns";

describe("kampanya ayarları: yeni özellikler yalnızca deneme kampanyasında", () => {
  it("asıl kampanyada (etkinlik) soru ve klinik fırsatı kapalı; diş macunu kartı değişmez", () => {
    const main = findCampaign(FALLBACK_CAMPAIGN_ID)!;
    expect(main.campaignId).toBe("lions-118y-2026-10-11");
    expect(main.selfCheck).toBeUndefined();
    expect(main.clinicOffer).toBeUndefined();
    expect(main.rewardLine).toBe("Diş macunu hediyeni al.");
  });

  it("deneme kampanyasında soru açık ve klinik fırsatı tanımlı", () => {
    const t = findCampaign("test-deneme")!;
    expect(t.selfCheck).toBe(true);
    expect(t.clinicOffer?.title).toBe("Ücretsiz muayene fırsatı!");
    expect(t.clinicOffer?.text).toContain("Koşuyolu Park Diş Kliniği");
    expect(t.clinicOffer?.logoPath).toBe("/assets/kosuyolu-park.png");
  });

  it("klinik fırsatı metninde uydurma iletişim bilgisi yok (telefon/adres yalnızca onaylı `detail` ile eklenir)", () => {
    for (const c of CAMPAIGNS) {
      const o = c.clinicOffer;
      if (!o) continue;
      expect(`${o.title} ${o.text}`).not.toMatch(/\d{3}[ -]?\d{3}|@|www\.|http/i);
      expect(o.detail).toBeUndefined();
    }
  });
});
