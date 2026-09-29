import { devices, expect, test } from "@playwright/test";
import { captureEvents, finishGameWithHelp, scrubWholeCanvas } from "./helpers";

test.describe("Oyun akışı", () => {
  test("QR adresi → öğretici → 6 aşama → ödül → tekrar oyna; olaylar doğru", async ({ page }) => {
    const cap = captureEvents(page);
    // Ses, animasyon ve yüz dönme dahil hiçbir yakalanmamış JS hatası olmamalı.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.goto("/oyun");
    await expect(page.getByRole("heading", { name: "Diş Kahramanı Ol!" })).toBeVisible();
    await expect(page.getByText("Bu içerik ağız ve diş sağlığı farkındalığı amacıyla hazırlanmıştır.")).toBeVisible();
    // giriş/kayıt alanı yok
    await expect(page.locator("input")).toHaveCount(0);

    await page.getByTestId("start").click();
    await expect(page.getByTestId("tutorial-screen")).toBeVisible();

    await scrubWholeCanvas(page, { until: async () => await page.getByTestId("tutorial-go").isVisible(), passes: 6 });
    await expect(page.getByTestId("tutorial-go")).toBeVisible();
    await page.getByTestId("tutorial-go").click();

    await expect(page.getByTestId("play-screen")).toBeVisible();
    const started = Date.now();
    const seen = new Set<string>();
    await expect
      .poll(
        async () => {
          if (await page.getByTestId("reward-screen").isVisible()) return "reward";
          const ph = await page.getByTestId("play-screen").getAttribute("data-phase").catch(() => null);
          if (ph) seen.add(ph);
          await scrubWholeCanvas(page, { passes: 1, until: async () => await page.getByTestId("reward-screen").isVisible() });
          return "playing";
        },
        { timeout: 130_000, intervals: [50] },
      )
      .toBe("reward");
    console.log("oyun süresi (sn, bot):", ((Date.now() - started) / 1000).toFixed(1), "aşamalar:", [...seen].join(","));

    const reward = page.getByTestId("reward-screen");
    await expect(reward).toContainText("TEBRİKLER!");
    await expect(reward).toContainText("DİŞ KAHRAMANI OLDUN!");
    await expect(reward).toContainText("Bu ekranı Lions standındaki görevliye göster.");
    await expect(reward).toContainText("Diş macunu hediyeni al.");
    await expect(reward).toContainText("Günde 3 kez fırçala");
    await expect(reward).toContainText("Yaklaşık 2 dakika fırçala");
    await expect(reward).toContainText("Dişlerini düzenli kontrol ettir");
    await expect(reward).toContainText("Tekrar Oyna");

    await page.getByTestId("replay").click();
    await expect(page.getByTestId("play-screen")).toBeVisible();
    await expect.poll(() => cap.names.includes("replay_started"), { timeout: 15_000 }).toBe(true);

    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect.poll(() => cap.names.filter((n) => n === "phase_completed").length, { timeout: 15_000 }).toBe(6);

    expect(pageErrors).toEqual([]);
    const count = (n: string) => cap.names.filter((x) => x === n).length;
    expect(count("landing_view")).toBe(1);
    expect(count("tutorial_started")).toBe(1);
    expect(count("tutorial_completed")).toBe(1);
    expect(count("game_started")).toBe(1);
    expect(count("game_completed")).toBe(1);
    expect(count("reward_screen_viewed")).toBe(1);
    expect(count("replay_started")).toBe(1);

    // Gizlilik: gövdede yalnızca izin verilen alanlar ve rastgele UUID'ler var.
    const allowedTop = new Set(["sessionId", "campaignId", "deviceClass", "sentAt", "events"]);
    const allowedEv = new Set(["id", "name", "ts", "playId", "playIndex", "durationMs", "phase"]);
    for (const b of cap.bodies) {
      for (const k of Object.keys(b)) expect(allowedTop.has(k)).toBe(true);
      for (const e of b.events as Record<string, unknown>[]) for (const k of Object.keys(e)) expect(allowedEv.has(k)).toBe(true);
    }
  });

  test("öğreticiyi atlama", async ({ page }) => {
    const cap = captureEvents(page);
    await page.goto("/oyun");
    await page.getByTestId("start").click();
    await page.getByTestId("skip-tutorial").click();
    await expect(page.getByTestId("play-screen")).toBeVisible();
    await expect.poll(() => cap.names.includes("game_started"), { timeout: 10_000 }).toBe(true);
    expect(cap.names).toContain("tutorial_skipped");
  });

  test("yardım butonuyla da tamamlanır (fırçalayamayan çocuk)", async ({ page }) => {
    await page.goto("/oyun");
    await page.getByTestId("start").click();
    await page.getByTestId("skip-tutorial").click();
    await finishGameWithHelp(page);
  });

  test("ses düğmesi çalışır ve tercih saklanır", async ({ page }) => {
    await page.goto("/oyun");
    const btn = page.getByRole("button", { name: "Sesi kapat" });
    await btn.click();
    await expect(page.getByRole("button", { name: "Sesi aç" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Sesi aç" })).toBeVisible();
  });

  test("kök adres /oyun'a yönlenir ve ?k= korunur", async ({ page }) => {
    await page.goto("/?k=lions-118y-2026-10-11");
    await expect(page).toHaveURL(/\/oyun\?k=lions-118y-2026-10-11$/);
  });

  test("gizlilik sayfası", async ({ page }) => {
    await page.goto("/gizlilik");
    await expect(page.getByRole("heading", { name: "Gizlilik" })).toBeVisible();
    await expect(page.getByText("reklam yoktur", { exact: false }).or(page.getByText("Reklam yoktur"))).toBeVisible();
  });
});

test.describe("Bağlantı sorunları", () => {
  test("çevrimdışı oynanır, olaylar kuyrukta bekler, internet gelince gönderilir", async ({ page, context }) => {
    const cap = captureEvents(page);
    await page.goto("/oyun");
    await expect.poll(() => cap.names.includes("landing_view"), { timeout: 10_000 }).toBe(true);

    await context.setOffline(true);
    await page.getByTestId("start").click();
    await page.getByTestId("skip-tutorial").click();
    await expect(page.getByTestId("play-screen")).toBeVisible();
    await finishGameWithHelp(page);
    // Oyun çevrimdışı tamamlandı: ödül ekranı geldi. Kuyrukta bekleyen olaylar var.
    const queued = await page.evaluate(() => JSON.parse(localStorage.getItem("lions.q") ?? "[]").length);
    expect(queued).toBeGreaterThanOrEqual(6);

    const before = cap.names.filter((n) => n === "game_completed").length;
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("lions.q") ?? "[]").length), { timeout: 20_000 }).toBe(0);
    expect(cap.names.filter((n) => n === "game_completed").length).toBeGreaterThan(before);
  });

  test("service worker: bir kez yüklendikten sonra internet tamamen kesilse de sayfa açılır ve oyun oynanır", async ({ page, context }) => {
    await page.goto("/oyun");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    // Statik dosyalar önbelleğe alınana kadar bekle
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const c = await caches.open("lions-static-v1");
            return (await c.keys()).length;
          }),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(3);
    await page.reload(); // SW artık sayfayı kontrol ediyor
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId("start")).toBeVisible();
    await page.getByTestId("start").click();
    await page.getByTestId("skip-tutorial").click();
    await expect(page.getByTestId("play-screen")).toBeVisible();
    await scrubWholeCanvas(page, { passes: 1 });
    await context.setOffline(false);
  });

  test("gerçek dokunmatik parmak hareketiyle (Android telefon) öğretici lekesi temizlenir", async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices["Pixel 7"] });
    const page = await ctx.newPage();
    await page.goto("/oyun");
    await page.getByTestId("start").click();
    await expect(page.getByTestId("tutorial-screen")).toBeVisible();
    const box = (await page.getByTestId("game-canvas").boundingBox())!;
    const scale = Math.min(box.width / 360, box.height / 520);
    const ox = box.x + (box.width - 360 * scale) / 2;
    const oy = box.y + (box.height - 520 * scale) / 2;
    const cdp = await ctx.newCDPSession(page);
    // Fırça, parmağın ~26 birim üstünde çizilir → parmağı lekenin biraz altına koy.
    const fy = oy + (268 + 26) * scale;
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y: fy, id: 1 }] });
    for (let round = 0; round < 8; round++) {
      await touch("touchStart", ox + 140 * scale);
      for (let i = 0; i <= 12; i++) await touch("touchMove", ox + (140 + i * 6.6) * scale);
      for (let i = 0; i <= 12; i++) await touch("touchMove", ox + (220 - i * 6.6) * scale);
      await touch("touchEnd", 0);
      if (await page.getByTestId("tutorial-go").isVisible()) break;
    }
    await expect(page.getByTestId("tutorial-go")).toBeVisible();
    // sayfa kaymamalı (kaydırma/yenileme jesti engellenmeli)
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await ctx.close();
  });
});
