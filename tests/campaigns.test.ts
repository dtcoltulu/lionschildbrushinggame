import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAMPAIGNS, findCampaign, FALLBACK_CAMPAIGN_ID } from "@/config/campaigns";

describe("kampanya ayarları: soru ve klinik fırsatı iki kampanyada da açık", () => {
  it("asıl kampanyada (etkinlik) soru ve klinik fırsatı açık; diş macunu satırı yedek olarak durur", () => {
    const main = findCampaign(FALLBACK_CAMPAIGN_ID)!;
    expect(main.campaignId).toBe("lions-118y-2026-10-11");
    expect(main.selfCheck).toBe(true);
    expect(main.clinicOffer?.title).toBe("Ücretsiz muayene fırsatı!");
    expect(main.clinicOffer?.text).toContain("Koşuyolu Park Diş Kliniği");
    expect(main.clinicOffer?.website).toBe("www.kosuyolupark.com");
    // Klinik fırsatı kaldırılırsa ödül ekranı diş macunu kartına döner: satır duruyor
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

  it("iki kampanya aynı klinik fırsatını kullanır (tek tanım: biri değişince diğeri sapmaz)", () => {
    expect(findCampaign("test-deneme")!.clinicOffer).toBe(findCampaign(FALLBACK_CAMPAIGN_ID)!.clinicOffer);
  });

  it("klinik fırsatının logo dosyası public altında gerçekten var (kırık resim olmaz)", () => {
    for (const c of CAMPAIGNS) {
      const logo = c.clinicOffer?.logoPath;
      if (logo) expect(existsSync(join(process.cwd(), "public", logo)), `${c.campaignId}: ${logo}`).toBe(true);
    }
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
