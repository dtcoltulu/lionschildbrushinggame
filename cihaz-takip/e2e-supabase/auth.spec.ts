import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!;
const stamp = Date.now().toString(36);
const STAFF_EMAIL = `personel-${stamp}@klinik.test`;

const CLINIC = `GoTrue Kliniği ${stamp}`;

/** E-posta ile giriş (genel yönetici ve kişisel hesaplar). */
async function login(page: Page, email: string, password: string) {
  await page.goto("/giris?genel=1");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
}

/** Genel yönetici: e-postayla girer, çalışacağı kliniği seçer. */
async function loginGeneral(page: Page, clinic = "Koşuyolu Park") {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page.getByRole("heading", { name: "Hangi klinikte çalışacaksınız?" })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`^${clinic}`) }).click();
  await expect(page.getByRole("heading", { name: "Genel bakış" })).toBeVisible();
}

/** Klinik şifresiyle giriş: klinik seçilir, personel ya da yönetici şifresi yazılır. */
async function clinicLogin(page: Page, clinic: string, kind: "Personel" | "Yönetici", password: string) {
  await page.goto("/giris?sec=1");
  await page.getByRole("link", { name: clinic }).click();
  await page.getByRole("radio", { name: kind }).click();
  await page.getByLabel(kind === "Yönetici" ? "Yönetici şifresi" : "Klinik şifresi").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
}

test.describe.configure({ mode: "serial" });

test("hatalı parola reddedilir; hesap bilgisi sızdırılmaz", async ({ page }) => {
  await login(page, ADMIN_EMAIL, "yanlis-parola-123");
  await expect(page.getByText("E-posta veya parola hatalı.")).toBeVisible();
  await login(page, "olmayan@klinik.test", "yanlis-parola-123");
  await expect(page.getByText("E-posta veya parola hatalı.")).toBeVisible();
});

test("ilk genel yönetici, yönetici e-postasıyla ilk girişte oluşur; klinik seçer; kişisel hesap açar", async ({ page }) => {
  await loginGeneral(page);
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
  await admin.getByRole("button", { name: /^Koşuyolu Park/ }).click();
  await admin.waitForURL((u) => !u.pathname.startsWith("/klinik-sec"));
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

test("şifresi belirlenmemiş klinik girişi açık bir mesajla durur", async ({ page }) => {
  await clinicLogin(page, "Koşuyolu Park", "Personel", "Herhangi-bir-sifre");
  await expect(page.getByText("Bu kliniğin personel şifresi henüz belirlenmemiş.", { exact: false })).toBeVisible();
});

test("genel yönetici klinik açar; personel kliniği seçip şifreyle girer; şifre değişince eski oturum kapanır", async ({ browser }) => {
  const adminCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const admin = await adminCtx.newPage();
  await loginGeneral(admin);
  await admin.goto("/ayarlar/klinikler");
  await admin.getByRole("button", { name: "+ Klinik ekle" }).click();
  await admin.getByLabel("Klinik adı").fill(CLINIC);
  await admin.getByLabel("Personel şifresi").fill("Ortak-sifre-2026");
  await admin.getByLabel("Yönetici şifresi").fill("Ortak-sifre-2026");
  await admin.getByRole("button", { name: "Klinik aç" }).click();
  await expect(admin.getByText("Personel ve yönetici şifreleri farklı olmalı", { exact: false })).toBeVisible();
  await admin.getByLabel("Yönetici şifresi").fill("Yonetici-sifre-2026");
  await admin.getByRole("button", { name: "Klinik aç" }).click();
  await expect(admin.getByText(`${CLINIC} açıldı.`, { exact: false })).toBeVisible();

  // Personel: kliniği seçer, şifreyle girer; yönetici işlemleri kapalı
  const staffCtx = await browser.newContext();
  const staff = await staffCtx.newPage();
  await clinicLogin(staff, CLINIC, "Personel", "yanlis-sifre-123");
  await expect(staff.getByText("Şifre hatalı.")).toBeVisible();
  await clinicLogin(staff, CLINIC, "Personel", "Ortak-sifre-2026");
  await expect(staff.getByRole("heading", { name: "Genel bakış" })).toBeVisible();
  await expect(staff.getByRole("banner")).toContainText(CLINIC);
  await staff.goto("/analizler");
  await expect(staff).toHaveURL(/yetki=yok/);
  expect((await staff.request.post("/api/klinikler", { data: { name: "Yetkisiz" } })).status()).toBe(403);
  // Personel şifresiyle yönetici olarak girilemez
  const other = await browser.newContext();
  const p3 = await other.newPage();
  await clinicLogin(p3, CLINIC, "Yönetici", "Ortak-sifre-2026");
  await expect(p3.getByText("Şifre hatalı.")).toBeVisible();
  await clinicLogin(p3, CLINIC, "Yönetici", "Yonetici-sifre-2026");
  await expect(p3.getByRole("heading", { name: "Genel bakış" })).toBeVisible();
  await p3.goto("/analizler");
  await expect(p3.getByRole("heading", { name: "Analizler" })).toBeVisible();
  await other.close();

  // Genel yönetici personel şifresini değiştirir: yönetici şifresiyle aynı olamaz; değişince eski oturum kapanır
  await staff.waitForTimeout(1100);
  await admin.reload();
  const card = admin.getByRole("listitem").filter({ hasText: CLINIC }).first();
  await card.getByRole("listitem").filter({ hasText: "Personel şifresi" }).getByRole("button", { name: "Değiştir" }).click();
  await card.getByLabel("Yeni personel şifresi").fill("Yonetici-sifre-2026");
  await card.getByRole("button", { name: "Kaydet" }).click();
  await expect(card.getByText("Personel ve yönetici şifreleri farklı olmalı", { exact: false })).toBeVisible();
  await card.getByLabel("Yeni personel şifresi").fill("Yeni-personel-2026");
  await card.getByRole("button", { name: "Kaydet" }).click();
  await expect(admin.getByText("personel şifresi kaydedildi", { exact: false })).toBeVisible();

  await staff.goto("/cihazlar");
  await expect(staff).toHaveURL(/\/giris/);
  await clinicLogin(staff, CLINIC, "Personel", "Ortak-sifre-2026");
  await expect(staff.getByText("Şifre hatalı.")).toBeVisible();
  await clinicLogin(staff, CLINIC, "Personel", "Yeni-personel-2026");
  await expect(staff.getByRole("heading", { name: "Genel bakış" })).toBeVisible();
  await staffCtx.close();
  await adminCtx.close();
});
