import { expect, test } from "@playwright/test";
import { addStaff, login, newSession, uniq } from "./helpers";

/**
 * Kabul 15 (mobil temel akış), 2 (seri no olmadan cihaz), 4 (temel bilgilerle arıza), 5 (boş firma/tarihle
 * "Serviste"), 9 (sorun devam ediyor), 14 (yenileme ve başka cihazdan giriş).
 */
test("telefonda: cihaz ekle → arıza bildir → servise gönder → tamirden geldi (sorun devam)", async ({ page, browser }) => {
  // Hazırlık: yönetici bir personel kartı ekler (cihaz sorumlusu olarak seçilecek).
  const admin = await newSession(browser, "Demo Yönetici");
  const person = uniq("Asistan Ayşe");
  await addStaff(admin.page, person);

  await login(page, "Demo Personel");
  await expect(page.getByRole("heading", { name: "Genel bakış" })).toBeVisible();

  // Cihaz ekle (seri numarası olmadan)
  await page.getByRole("link", { name: "+ Cihaz ekle" }).first().click();
  await page.getByLabel("Cihaz türü").selectOption({ label: "Aeratör" });
  await expect(page.getByLabel("Cihaz adı")).toHaveValue("Aeratör");
  await page.getByLabel("Marka").fill("W&H");
  await page.getByLabel("Oda / ünit").selectOption({ label: "Ünit 3" });
  await page.getByLabel("Sorumlu çalışan").selectOption({ label: person });
  await page.getByRole("button", { name: "Cihazı kaydet" }).click();
  await expect(page.getByText(/Cihaz kaydedildi: AER-\d+/)).toBeVisible();
  const deviceUrl = page.url();
  await expect(page.getByText("Girilmemiş")).toBeVisible(); // seri no eksik ama kayıt engellenmedi

  // Cihaz kartından arıza bildir: cihaz ve konum otomatik dolu
  const started = Date.now();
  await page.getByRole("link", { name: "+ Arıza bildir" }).last().click();
  await expect(page.getByRole("heading", { name: "Arıza bildir" })).toBeVisible();
  await page.getByLabel("Ne oldu?").fill("Dönerken ses yapıyor");
  await page.getByRole("button", { name: "Arızayı kaydet" }).click();
  await expect(page.getByText("Arıza kaydedildi ✓")).toBeVisible();
  expect(Date.now() - started).toBeLessThan(60_000);
  await expect(page.getByText("Arızalı").first()).toBeVisible();
  const faultUrl = page.url();

  // "Serviste": firma ve gönderim tarihi boş
  await page.getByRole("radio", { name: /^Serviste / }).check();
  await expect(page.getByText("Servis bilgileri (yeni gidiş)")).toBeVisible();
  await page.getByLabel("Beklenen dönüş tarihi").fill("2099-01-15"); // ileri tarih kabul edilir
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText(/Kaydedildi ✓/)).toBeVisible();
  await expect(page.getByText("Servis gidişleri (1)")).toBeVisible();

  // Sayfa yenilenince kayıt korunur (14)
  await page.reload();
  await expect(page.getByRole("radio", { name: /^Serviste / })).toBeChecked();
  await expect(page.getByLabel("Beklenen dönüş tarihi")).toHaveValue("2099-01-15");

  // Tamirden geldi: sonuç seçilmeden kaydedilemez, alan belirtilir
  await page.getByRole("radio", { name: /^Tamirden geldi / }).check();
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Sonucu seçin: cihaz kullanıma hazır mı, sorun devam ediyor mu?").first()).toBeVisible();
  await page.getByRole("radio", { name: /Sorun devam ediyor/ }).check();
  await page.getByLabel("Tamir maliyeti (TL)").fill("1.250,50");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText(/Kaydedildi ✓/)).toBeVisible();
  await expect(page.getByText("Tamirden geldi – sorun devam ediyor").first()).toBeVisible();

  // Cihaz kullanılabilir sayılmaz (9)
  await page.goto(deviceUrl);
  await expect(page.getByText("Tamirden geldi – sorun devam ediyor").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Açık arıza kaydına git" })).toBeVisible();

  // Başka cihazdan (ayrı oturum) aynı güncel kayıt görünür (14)
  await admin.page.goto(faultUrl);
  await expect(admin.page.getByLabel("Ne oldu?")).toHaveValue("Dönerken ses yapıyor");
  await expect(admin.page.getByText("Tamirden geldi – sorun devam ediyor").first()).toBeVisible();
  await admin.context.close();
});

test("açık arızası olan cihaz için yeni bildirim mevcut kayda yönlendirir", async ({ page }) => {
  await login(page, "Demo Personel");
  const r = await page.request.post("/api/cihazlar", { data: { name: "Mikromotor", typeId: await typeId(page, "MKM") } });
  const deviceId = (await r.json()).ids[0];
  const f = await page.request.post("/api/arizalar", { data: { deviceId, description: "İlk kayıt" } });
  const faultId = (await f.json()).fault.id;
  await page.goto(`/arizalar/yeni?cihaz=${deviceId}`);
  await expect(page).toHaveURL(new RegExp(`/arizalar/${faultId}\\?mevcut=1`));
  await expect(page.getByText("Bu cihazın zaten açık bir arıza kaydı var")).toBeVisible();
  // API de ikinci kaydı reddeder
  const again = await page.request.post("/api/arizalar", { data: { deviceId, description: "İkinci" } });
  expect(again.status()).toBe(409);
  expect((await again.json()).faultId).toBe(faultId);
});

test("oturum/yenileme: kaydedilmemiş form taslağı korunur", async ({ page }) => {
  await login(page, "Demo Personel");
  const r = await page.request.post("/api/cihazlar", { data: { name: "Piyasemen", typeId: await typeId(page, "PYS") } });
  const deviceId = (await r.json()).ids[0];
  await page.goto(`/arizalar/yeni?cihaz=${deviceId}`);
  await page.getByLabel("Ne oldu?").fill("Taslak metin – yarıda kaldı");
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByText("kaydedilmemiş bilgileriniz vardı")).toBeVisible();
  await expect(page.getByLabel("Ne oldu?")).toHaveValue("Taslak metin – yarıda kaldı");
  // Oturum kapandıktan sonra kaydetmeye çalışınca bilgiler kaybolmaz
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Arızayı kaydet" }).click();
  await expect(page.getByText("Oturumunuz kapanmış.")).toBeVisible();
  await page.getByRole("link", { name: "Tekrar giriş yap" }).click();
  await page.getByRole("button", { name: /Demo Personel/ }).click();
  await expect(page).toHaveURL(new RegExp(`cihaz=${deviceId}`));
  await expect(page.getByLabel("Ne oldu?")).toHaveValue("Taslak metin – yarıda kaldı");
  await page.getByRole("button", { name: "Arızayı kaydet" }).click();
  await expect(page.getByText("Arıza kaydedildi ✓")).toBeVisible();
});

test("eşzamanlı düzenleme: ikinci kişi eski sürümle kaydedince uyarı alır, sessizce ezmez", async ({ browser }) => {
  const a = await newSession(browser, "Demo Personel", { width: 1200, height: 900 });
  const b = await newSession(browser, "Demo Yönetici", { width: 1200, height: 900 });
  const r = await a.page.request.post("/api/cihazlar", { data: { name: "Otoklav", typeId: await typeId(a.page, "OTK") } });
  const id = (await r.json()).ids[0];
  await a.page.goto(`/cihazlar/${id}/duzenle`);
  await b.page.goto(`/cihazlar/${id}/duzenle`);
  await a.page.getByLabel("Marka").fill("Melag");
  await a.page.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await expect(a.page.getByText("Değişiklikler kaydedildi.")).toBeVisible();
  await b.page.getByLabel("Marka").fill("Euronda");
  await b.page.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await expect(b.page.getByText("Kayıt başka biri tarafından değiştirildi.")).toBeVisible();
  await a.page.goto(`/cihazlar/${id}`);
  await expect(a.page.getByText("Melag", { exact: true })).toBeVisible();
  await expect(a.page.getByText("Euronda")).toHaveCount(0);
  await a.context.close();
  await b.context.close();
});

async function typeId(page: import("@playwright/test").Page, prefix: string): Promise<string> {
  await page.goto("/cihazlar/yeni");
  const options = await page.getByLabel("Cihaz türü").locator("option").evaluateAll((els) => els.map((e) => ({ v: (e as HTMLOptionElement).value, t: e.textContent ?? "" })));
  const names: Record<string, string> = { MKM: "Mikromotor", PYS: "Piyasemen", OTK: "Otoklav", AER: "Aeratör" };
  return options.find((o) => o.t === names[prefix])!.v;
}
