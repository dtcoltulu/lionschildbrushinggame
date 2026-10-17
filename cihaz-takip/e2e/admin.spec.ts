import { expect, test } from "@playwright/test";
import { login, uniq } from "./helpers";

/** Kabul 11 (deneme arızası silinir, cihaz korunur, analizden çıkar), 12 (pasif personel), dışa aktarım. */
test.use({ viewport: { width: 1280, height: 900 } });

test("yönetici: deneme arızasını onayla siler, geri alır; analiz ve cihaz kartı doğru", async ({ page }) => {
  await login(page, "Demo Yönetici");
  await page.goto("/cihazlar/yeni");
  await page.getByLabel("Cihaz türü").selectOption({ label: "Anguldruva" });
  await page.getByRole("button", { name: "Cihazı kaydet" }).click();
  await expect(page.getByText(/Cihaz kaydedildi: ANG-\d+/)).toBeVisible();
  const code = (await page.locator("h1 .font-mono").textContent())!.trim();
  await page.getByRole("link", { name: "+ Arıza bildir" }).last().click();
  await page.getByLabel("Ne oldu?").fill("DENEME kaydı – silinecek");
  await page.getByRole("button", { name: "Arızayı kaydet" }).click();
  await expect(page.getByText("Arıza kaydedildi ✓")).toBeVisible();
  const faultUrl = page.url();

  await page.goto("/analizler?donem=tumu");
  await expect(page.locator("table").first()).toContainText(code);

  await page.goto(faultUrl);
  await page.getByRole("button", { name: "Arıza kaydını sil" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(code);
  await expect(dialog).toContainText("DENEME kaydı – silinecek");
  await dialog.getByLabel("Silme nedeni (isteğe bağlı)").fill("Deneme amaçlı");
  await dialog.getByRole("button", { name: "Evet, sil" }).click();
  await expect(page.getByText("Arıza kaydı silindi.")).toBeVisible();
  await expect(page.getByText("DENEME kaydı – silinecek")).toBeVisible(); // silinenler listesinde

  await page.goto("/analizler?donem=tumu");
  await expect(page.getByText(code)).toHaveCount(0);
  await page.goto("/cihazlar");
  await page.getByRole("link", { name: code }).click();
  await expect(page.getByText("Kullanılabilir").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "+ Arıza bildir" }).last()).toBeVisible(); // silinen açık arıza yeni kaydı engellemez

  // Geçmişte iz kalır, geri alınabilir
  await page.goto(faultUrl);
  await expect(page.getByText(/arıza kaydı silindi – Deneme amaçlı/)).toBeVisible();
  await page.getByRole("button", { name: "Silmeyi geri al" }).click();
  await expect(page.getByText("Arıza kaydını sil")).toBeVisible();
});

test("yönetici: çalışan ekler, cihaz sorumlusu yapar, pasifleştirir; geçmiş korunur", async ({ page }) => {
  await login(page, "Demo Yönetici");
  const name = uniq("Dt. Pasif Test");
  await page.goto("/calisanlar");
  await page.getByRole("button", { name: "+ Yeni çalışan" }).click();
  await page.getByLabel("Ad soyad").fill(name);
  await page.getByLabel("Görev").selectOption({ label: "Diş hekimi" });
  await page.getByLabel("Ünit 1", { exact: true }).check();
  await page.getByLabel("Ünit 2", { exact: true }).check();
  await page.getByRole("button", { name: "Çalışanı ekle" }).click();
  await expect(page.getByText(`${name} eklendi.`)).toBeVisible();
  await expect(page.locator("li", { hasText: name }).getByText("Diş hekimi · Ünit 1, Ünit 2")).toBeVisible();

  // Aynı kişi farklı yazımla eklenemez
  await page.getByRole("button", { name: "+ Yeni çalışan" }).click();
  await page.getByLabel("Ad soyad").fill(name.toUpperCase().replace("İ", "I"));
  await page.getByRole("button", { name: "Çalışanı ekle" }).click();
  await expect(page.getByText(/Bu isimde bir çalışan zaten kayıtlı/).first()).toBeVisible();
  await page.getByRole("button", { name: "Kapat" }).first().click();

  await page.goto("/cihazlar/yeni");
  await page.getByLabel("Cihaz türü").selectOption({ label: "Işık cihazı" });
  await page.getByLabel("Sorumlu çalışan").selectOption({ label: name });
  await page.getByRole("button", { name: "Cihazı kaydet" }).click();
  await expect(page.getByText(/Cihaz kaydedildi/)).toBeVisible();
  const deviceUrl = page.url();

  await page.goto("/calisanlar");
  const card = page.locator("li", { hasText: name });
  await card.getByRole("button", { name: "Düzenle" }).click();
  await card.getByLabel("Aktif").uncheck();
  await card.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText(`${name} güncellendi.`)).toBeVisible();

  await page.goto(deviceUrl);
  await expect(page.getByText(`${name} (pasif)`)).toBeVisible();
  await page.goto("/cihazlar/yeni");
  await expect(page.getByLabel("Sorumlu çalışan").locator("option", { hasText: name })).toHaveCount(0);
});

test("yönetici: Excel dışa aktarımı Türkçe karakterlerle iner", async ({ page }) => {
  await login(page, "Demo Yönetici");
  const r = await page.request.get("/api/disa-aktar/cihazlar");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("text/csv");
  const text = await r.text();
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain("Envanter kodu;Cihaz adı;Tür;Marka;Model;Seri numarası");
});
