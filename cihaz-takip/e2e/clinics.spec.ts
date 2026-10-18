import { expect, test } from "@playwright/test";
import { login, newSession, uniq } from "./helpers";

/** Birden fazla klinik: giriş ekranında klinik seçimi, kliniklerin verisinin ayrılığı, klinik yönetimi. */
test("klinik seçilerek girilir; bir klinik diğerinin cihazını göremez", async ({ page, browser }) => {
  // İlk açılışta klinik listesi gelir
  await page.goto("/giris?sec=1");
  await expect(page.getByRole("heading", { name: "Kliniğinizi seçin" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Koşuyolu Park" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Örnek Klinik B" })).toBeVisible();

  // Koşuyolu Park yöneticisi bir cihaz ekler
  await login(page, "Demo Yönetici");
  await expect(page.getByRole("banner")).toContainText("Koşuyolu Park");
  const name = uniq("Ayrım cihazı");
  await page.goto("/cihazlar/yeni");
  await page.getByLabel("Cihaz türü").selectOption({ label: "Aeratör" });
  await page.getByLabel("Cihaz adı").fill(name);
  await page.getByRole("button", { name: "Cihazı kaydet" }).click();
  await expect(page.getByText(/Cihaz kaydedildi: AER-\d+/)).toBeVisible();
  const deviceUrl = page.url();

  // Klinik B personeli göremez: listede yok, adresiyle açınca bulunamaz
  const b = await newSession(browser, "Demo B Personel");
  await expect(b.page.getByRole("banner")).toContainText("Örnek Klinik B");
  await b.page.goto(`/cihazlar?q=${encodeURIComponent(name)}`);
  await expect(b.page.getByText(name)).toHaveCount(0);
  const res = await b.page.goto(deviceUrl);
  expect(res?.status()).toBe(404);
  // Klinik B yönetimi de yapamaz
  const r = await b.page.request.post("/api/klinikler", { data: { name: "Yetkisiz Klinik" } });
  expect(r.status()).toBe(403);
  await b.context.close();

  // Giriş ekranı son kullanılan kliniği hatırlar
  await page.request.post("/api/cikis");
  await page.goto("/giris");
  await expect(page.getByRole("heading", { name: "Koşuyolu Park" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Başka klinik seç" })).toBeVisible();
});

test("genel yönetici klinik açar, kliniğe geçer; klinik yöneticisi klinikleri yönetemez", async ({ page, browser }) => {
  await login(page, "Demo Genel Yönetici");
  await page.goto("/ayarlar/klinikler");
  await expect(page.getByRole("link", { name: "Klinikler" })).toBeVisible();
  const clinic = uniq("Deneme Kliniği");
  await page.getByRole("button", { name: "+ Klinik ekle" }).click();
  await page.getByLabel("Klinik adı").fill(clinic);
  await page.getByRole("button", { name: "Klinik aç" }).click();
  await expect(page.getByText(`${clinic} açıldı.`)).toBeVisible();

  // Yeni kliniğe geçince boş başlar, başlangıç listeleri hazırdır
  await page.getByRole("listitem").filter({ hasText: clinic }).getByRole("button", { name: "Bu kliniğe geç" }).click();
  await page.waitForURL("**/");
  await expect(page.getByRole("banner")).toContainText(clinic);
  await page.goto("/cihazlar");
  await expect(page.getByText(/AER-\d+/)).toHaveCount(0);
  await page.goto("/cihazlar/yeni");
  await expect(page.getByLabel("Cihaz türü").locator("option", { hasText: "Aeratör" })).toHaveCount(1);

  // Yeni klinik giriş ekranında görünür
  const anon = await browser.newContext();
  const p2 = await anon.newPage();
  await p2.goto("/giris?sec=1");
  await expect(p2.getByRole("link", { name: clinic })).toBeVisible();
  await anon.close();

  // Klinik yöneticisi (genel yönetici değil) klinik sayfasına giremez, sekmeyi görmez
  const admin = await newSession(browser, "Demo Yönetici");
  await admin.page.goto("/ayarlar");
  await expect(admin.page.getByRole("heading", { name: "Klinik şifreleri" })).toBeVisible();
  await expect(admin.page.getByRole("link", { name: "Klinikler" })).toHaveCount(0);
  await admin.page.goto("/ayarlar/klinikler");
  await expect(admin.page).toHaveURL(/\/\?yetki=yok/);
  await admin.context.close();
});
