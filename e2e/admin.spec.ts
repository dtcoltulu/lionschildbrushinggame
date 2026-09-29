import { expect, test } from "@playwright/test";
import { captureEvents, finishGameWithHelp } from "./helpers";

const PASSWORD = "test-parola-12345";

test.describe("Yönetici erişimi", () => {
  test("giriş yapmadan admin, qr ve API'ye erişilemez", async ({ page, request }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
    await page.goto("/qr");
    await expect(page).toHaveURL(/\/admin\/login\?next=%2Fqr/);
    await page.goto("/admin/report");
    await expect(page).toHaveURL(/\/admin\/login/);
    const r = await request.get("/api/admin/export", { maxRedirects: 0 });
    expect(r.status()).toBe(401);
  });

  test("yanlış parola reddedilir, oyun sayfaları herkese açıktır", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Parola").fill("yanlis-parola-123");
    await page.getByRole("button", { name: "Giriş yap" }).click();
    // Next.js'in gizli "route announcer" öğesi de role=alert taşır; yalnızca sayfamızdaki uyarıyı hedefle.
    await expect(page.locator("main [role=alert]")).toContainText("Parola hatalı");
    await page.goto("/oyun");
    await expect(page.getByTestId("start")).toBeVisible();
  });

  test("giriş → dashboard sayıları oyun olaylarıyla eşleşir → rapor → CSV → QR", async ({ page, browser }) => {
    // Bir çocuk oyunu oynar (ayrı bağlam = ayrı tarayıcı)
    const kid = await browser.newContext({ viewport: { width: 390, height: 780 } });
    const kp = await kid.newPage();
    const cap = captureEvents(kp);
    await kp.goto("/oyun");
    await kp.getByTestId("start").click();
    await kp.getByTestId("skip-tutorial").click();
    await finishGameWithHelp(kp);
    await expect.poll(() => cap.names.includes("reward_screen_viewed")).toBe(true);
    // sunucuya ulaştığından emin ol
    await expect.poll(async () => (await kp.evaluate(() => JSON.parse(localStorage.getItem("lions.q") ?? "[]").length)), { timeout: 15_000 }).toBe(0);
    await kid.close();

    await page.goto("/admin/login");
    await page.getByLabel("Parola").fill(PASSWORD);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Özet" })).toBeVisible();

    const n = async (id: string) => Number(await page.getByTestId(id).innerText());
    expect(await n("kpi-starters")).toBeGreaterThanOrEqual(1);
    expect(await n("kpi-completers")).toBeGreaterThanOrEqual(1);
    expect(await n("kpi-landing")).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("kpi-rate")).toContainText("%");
    // saatlik grafik + tablo alternatifi
    await expect(page.getByRole("img", { name: /Saatlere göre oyun kullanımı/ })).toBeVisible();
    await page.getByText("Tablo görünümü").click();
    await expect(page.getByRole("table", { name: "Saatlik dağılım" })).toBeVisible();
    // son olaylar: kişisel veri yok, sadece kısa anonim kod
    await expect(page.getByRole("table", { name: "Son olaylar" })).toContainText("Oyun tamamlandı");

    // Rapor
    await page.getByTestId("report-link").click();
    await expect(page.getByRole("heading", { name: "11 Ekim Dünya Lions Hizmet Günü" })).toBeVisible();
    await expect(page.getByText("Ağız ve Diş Sağlığı Komitesi").first()).toBeVisible();
    await expect(page.getByText("Dijital Ağız ve Diş Sağlığı Farkındalık Etkinliği")).toBeVisible();
    for (const label of ["Toplam erişim", "Oyuna başlayan", "Tamamlayan", "Tamamlama oranı", "Ortalama süre", "Tekrar oynama", "Saatlik dağılım"]) {
      await expect(page.getByText(label).first()).toBeVisible();
    }

    // CSV
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("csv-link").click()]);
    expect(dl.suggestedFilename()).toMatch(/^lions-118y-2026-10-11-report-\d{4}-\d{2}-\d{2}\.csv$/);
    const fs = await import("node:fs");
    const csv = fs.readFileSync((await dl.path())!, "utf8");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Ağız ve Diş Sağlığı Komitesi");
    expect(csv).toContain("Tamamlama oranı;");

    // QR sayfası
    await page.goto("/qr");
    await expect(page.getByTestId("qr-preview")).toBeVisible();
    await expect(page.getByTestId("qr-url")).toHaveValue("https://dis.example.org/oyun");
    const [svgDl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("dl-svg").click()]);
    const svg = fs.readFileSync((await svgDl.path())!, "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    const [pngDl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("dl-png").click()]);
    const png = fs.readFileSync((await pngDl.path())!);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(1800); // genişlik (px)

    // Çıkış
    await page.goto("/admin");
    await page.getByRole("button", { name: "Çıkış" }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
