import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!;
const stamp = Date.now().toString(36);
const STAFF_EMAIL = `personel-${stamp}@klinik.test`;

async function login(page: Page, email: string, password: string) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
}

test.describe.configure({ mode: "serial" });

test("hatalı parola reddedilir; hesap bilgisi sızdırılmaz", async ({ page }) => {
  await login(page, ADMIN_EMAIL, "yanlis-parola-123");
  await expect(page.getByText("E-posta veya parola hatalı.")).toBeVisible();
  await login(page, "olmayan@klinik.test", "yanlis-parola-123");
  await expect(page.getByText("E-posta veya parola hatalı.")).toBeVisible();
});

test("ilk yönetici, yönetici e-postasıyla ilk girişte oluşur; personel hesabı açar", async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page.getByRole("heading", { name: "Genel bakış" })).toBeVisible();
  await page.goto("/ayarlar");
  await page.getByRole("button", { name: "+ Kullanıcı ekle" }).click();
  await page.getByLabel("E-posta (giriş adı)").fill(STAFF_EMAIL);
  await page.getByLabel("Görünen ad").fill("Test Personel");
  await page.getByLabel("İlk parola").fill("kisa");
  await page.getByRole("button", { name: "Kullanıcı ekle" }).click();
  await expect(page.getByText("Parola en az 10 karakter olmalı.").first()).toBeVisible();
  await page.getByLabel("İlk parola").fill("Ilk-parola-2026");
  await page.getByRole("button", { name: "Kullanıcı ekle" }).click();
  await expect(page.getByText(/Test Personel eklendi\. İlk parolayı/)).toBeVisible();
});

test("personel kendi hesabıyla girer, yönetici işlemleri kapalı, parolasını değiştirir", async ({ page }) => {
  await login(page, STAFF_EMAIL, "Ilk-parola-2026");
  await expect(page.getByRole("heading", { name: "Genel bakış" })).toBeVisible();
  expect((await page.request.post("/api/calisanlar", { data: { fullName: "X Y", jobRole: "diger" } })).status()).toBe(403);
  expect((await page.request.post("/api/kullanicilar", { data: { email: "a@b.cd", displayName: "Kötü", role: "admin", password: "Kotu-parola-123" } })).status()).toBe(403);
  await page.goto("/analizler");
  await expect(page).toHaveURL(/yetki=yok/);

  await page.goto("/hesabim");
  await page.getByLabel("Yeni parola", { exact: true }).fill("Yeni-parola-2026");
  await page.getByLabel("Yeni parola (tekrar)").fill("Yeni-parola-2026");
  await page.getByRole("button", { name: "Parolayı değiştir" }).click();
  await expect(page.getByText("Parolanız değiştirildi.")).toBeVisible();
  await page.getByRole("button", { name: "Çıkış yap" }).click();
  await expect(page.getByText("Çıkış yaptınız.")).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/giris/);

  await login(page, STAFF_EMAIL, "Ilk-parola-2026");
  await expect(page.getByText("E-posta veya parola hatalı.")).toBeVisible();
  await login(page, STAFF_EMAIL, "Yeni-parola-2026");
  await expect(page.getByRole("heading", { name: "Genel bakış" })).toBeVisible();
});

test("yönetici erişimi kapatınca açık oturum da hemen geçersiz olur; parola sıfırlanıp yeniden açılabilir", async ({ browser }) => {
  const staffCtx = await browser.newContext();
  const staff = await staffCtx.newPage();
  await login(staff, STAFF_EMAIL, "Yeni-parola-2026");
  await expect(staff.getByRole("heading", { name: "Genel bakış" })).toBeVisible();

  const adminCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const admin = await adminCtx.newPage();
  await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  await admin.waitForURL((u) => !u.pathname.startsWith("/giris"));
  await admin.goto("/ayarlar");
  const row = admin.locator("li", { hasText: STAFF_EMAIL });
  await row.getByRole("button", { name: "Düzenle" }).click();
  await row.getByLabel("Erişim açık").uncheck();
  await row.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(admin.getByText("Test Personel güncellendi.")).toBeVisible();

  await staff.goto("/cihazlar");
  await expect(staff).toHaveURL(/hata=erisim/);
  expect((await staff.request.post("/api/arizalar", { data: { description: "x" } })).status()).toBe(401);
  await login(staff, STAFF_EMAIL, "Yeni-parola-2026");
  await expect(staff.getByText("Bu hesabın uygulamaya erişimi kapatılmış.", { exact: false })).toBeVisible();

  await admin.reload();
  const row2 = admin.locator("li", { hasText: STAFF_EMAIL });
  await row2.getByRole("button", { name: "Düzenle" }).click();
  await row2.getByLabel("Erişim açık").check();
  await row2.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(admin.getByText("Test Personel güncellendi.")).toBeVisible();
  await admin.reload();
  const row3 = admin.locator("li", { hasText: STAFF_EMAIL });
  await row3.getByRole("button", { name: "Düzenle" }).click();
  await row3.getByLabel("Yeni geçici parola").fill("Sifirlanan-2026");
  await row3.getByRole("button", { name: "Parolayı değiştir" }).click();
  await expect(admin.getByText("Test Personel için parola değiştirildi.")).toBeVisible();

  await login(staff, STAFF_EMAIL, "Sifirlanan-2026");
  await expect(staff.getByRole("heading", { name: "Genel bakış" })).toBeVisible();
  await staffCtx.close();
  await adminCtx.close();
});

test("Supabase'de hesabı olup uygulamada kaydı olmayan kişi giremez", async ({ page, request }) => {
  const email = `yabanci-${stamp}@klinik.test`;
  const r = await request.post(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY! },
    data: { email, password: "Yabanci-parola-1", email_confirm: true },
  });
  expect(r.ok()).toBe(true);
  await login(page, email, "Yabanci-parola-1");
  await expect(page.getByText("Bu hesabın uygulamaya erişimi yok")).toBeVisible();
});
