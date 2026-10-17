import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/** Kabul 13: personel hesabı yönetici işlemlerini arayüzde de API üzerinden de yapamaz. */
test("personel: yönetici API'leri 403, yönetici sayfaları kapalı", async ({ page }) => {
  await login(page, "Demo Personel");
  const forbidden: [string, string, unknown?][] = [
    ["POST", "/api/calisanlar", { fullName: "Yetkisiz Kişi", jobRole: "diger" }],
    ["POST", "/api/kullanicilar", { email: "x@ornek.local", displayName: "Yetkisiz", role: "admin" }],
    ["POST", "/api/listeler/locations", { name: "Gizli oda" }],
    ["GET", "/api/disa-aktar/cihazlar"],
  ];
  for (const [method, url, data] of forbidden) {
    const r = await page.request.fetch(url, { method, data });
    expect(r.status(), `${method} ${url}`).toBe(403);
  }
  // Kendi hesabını yöneticiye yükseltemez
  const me = await page.request.fetch("/api/kullanicilar/00000000-0000-0000-0000-000000000000", { method: "PATCH", data: { version: 1, displayName: "X Y", role: "admin", active: true } });
  expect(me.status()).toBe(403);
  // Arıza silme / geri alma / kalıcı silme
  const devices = await page.request.post("/api/cihazlar", { data: { name: "Test", typeId: await firstTypeId(page) } });
  const deviceId = (await devices.json()).ids[0];
  const fault = await (await page.request.post("/api/arizalar", { data: { deviceId, description: "Deneme" } })).json();
  for (const [method, url] of [["POST", `/api/arizalar/${fault.fault.id}/sil`], ["POST", `/api/arizalar/${fault.fault.id}/geri-al`], ["DELETE", `/api/arizalar/${fault.fault.id}`]] as const) {
    const r = await page.request.fetch(url, { method, data: {} });
    expect(r.status(), `${method} ${url}`).toBe(403);
  }
  // Silme talebi ise personele açıktır
  const req = await page.request.post(`/api/arizalar/${fault.fault.id}/silme-talebi`, { data: { reason: "Deneme kaydı" } });
  expect(req.status()).toBe(200);
  // Yönetici sayfaları
  await page.goto("/analizler");
  await expect(page).toHaveURL(/\/\?yetki=yok/);
  await expect(page.getByText("Bu sayfa yalnızca yöneticiye açıktır.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Analiz" })).toHaveCount(0);
});

test("oturumsuz istekler 401, sayfalar giriş ekranına yönlenir", async ({ page }) => {
  const r = await page.request.post("/api/arizalar", { data: { description: "x" } });
  expect(r.status()).toBe(401);
  await page.goto("/cihazlar?q=aer");
  await expect(page).toHaveURL(/\/giris\?next=%2Fcihazlar%3Fq%3Daer/);
});

test("başka siteden gelen değişiklik isteği reddedilir", async ({ page }) => {
  await login(page, "Demo Personel");
  const r = await page.request.post("/api/cihazlar", { data: { name: "x" }, headers: { origin: "https://kotu-site.example" } });
  expect(r.status()).toBe(403);
});

async function firstTypeId(page: import("@playwright/test").Page) {
  await page.goto("/cihazlar/yeni");
  return page.getByLabel("Cihaz türü").locator("option").nth(1).getAttribute("value") as Promise<string>;
}
