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

test.describe("Kendini değerlendirme sayıları (panel)", () => {
  const uuid = () => crypto.randomUUID();
  const MAIN = "lions-118y-2026-10-11";
  const TRIAL = "test-deneme";

  test("Evet/Hayır sayısı, oranı ve aşama dökümü her iki kampanyanın panelinde, raporda ve CSV'de görünür; kampanyalar birbirini etkilemez", async ({ page, request }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Parola").fill(PASSWORD);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page).toHaveURL(/\/admin$/);

    // Önceki testlerden kalan cevaplar olabilir: farkı ölç.
    const read = async (campaign: string) => {
      await page.goto(`/admin?k=${campaign}`);
      await expect(page.getByTestId("selfcheck")).toBeVisible();
      if ((await page.getByTestId("selfcheck-empty").count()) > 0) return { yes: 0, no: 0 };
      return { yes: Number(await page.getByTestId("selfcheck-yes").innerText()), no: Number(await page.getByTestId("selfcheck-no").innerText()) };
    };
    // İki çocuk: A (Evet@1, Hayır@2), B (Hayır@1, Hayır@3)  → +1 Evet, +3 Hayır
    const post = async (campaignId: string) => {
      const kids = [
        [{ name: "self_check_yes", phase: 1 }, { name: "self_check_no", phase: 2 }],
        [{ name: "self_check_no", phase: 1 }, { name: "self_check_no", phase: 3 }],
      ];
      for (const events of kids) {
        const res = await request.post("/api/events", {
          data: { sessionId: uuid(), campaignId, sentAt: Date.now(), events: events.map((e) => ({ id: uuid(), name: e.name, ts: Date.now(), phase: e.phase })) },
        });
        expect(res.status()).toBe(200);
      }
    };

    for (const [campaign, other] of [
      [MAIN, TRIAL],
      [TRIAL, MAIN],
    ] as const) {
      const otherBefore = await read(other);
      const before = await read(campaign);
      await post(campaign);
      const after = await read(campaign);
      expect(after.yes - before.yes).toBe(1);
      expect(after.no - before.no).toBe(3);
      await expect(page.getByTestId("selfcheck-yes-rate")).toContainText("%");
      await expect(page.getByTestId("selfcheck-no-rate")).toContainText("%");
      await expect(page.getByTestId("selfcheck-total")).toHaveText(String(after.yes + after.no));
      // Başlangıç yanılgısı (ilk cevap), ilk oyun / tekrar ayrımı ve soruların eklediği süre görünür
      await expect(page.getByTestId("selfcheck-first-yes-rate")).toContainText("%");
      await expect(page.getByTestId("selfcheck-first-play-rate")).toContainText("%");
      await expect(page.getByTestId("selfcheck-replay-rate")).toBeVisible();
      await expect(page.getByTestId("selfcheck-overhead")).toBeVisible();
      const table = page.getByTestId("selfcheck-phases");
      await expect(table).toContainText("1. Dış yüzeyler");
      await expect(table).toContainText("2. Diş araları");
      await expect(table).toContainText("3. İç yüzeyler");
      await expect(page.getByRole("table", { name: "Son olaylar" })).toContainText("Soru: Evet");

      // Yazdırılabilir rapor ve CSV
      await page.goto(`/admin/report?k=${campaign}`);
      await expect(page.getByText("Sence yeterli ve etkin temizlendi mi?").first()).toBeVisible();
      await expect(page.getByText("“Evet” (diğer yüzeyler kalmışken “yeterli” dedi)")).toBeVisible();
      const csv = await (await page.request.get(`/api/admin/export?k=${campaign}&type=report`)).text();
      expect(csv).toContain("KENDİNİ DEĞERLENDİRME");
      expect(csv).toContain("Aşama 1;Dış yüzeyler;");

      // Diğer kampanyanın sayıları değişmedi
      expect(await read(other)).toEqual(otherBefore);
    }
  });
});

test.describe("Tarih aralığı filtresi (panel, rapor, CSV)", () => {
  const MAIN = "lions-118y-2026-10-11";
  // Kampanya saat diliminde (İstanbul) bugünden `offset` gün sonrası: YYYY-MM-DD
  const day = (offset: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(Date.now() + offset * 86_400_000));

  test("aralık dışındaki olaylar sayılmaz, içindekiler sayılır; form, rapor ve CSV aynı aralığı kullanır; veri silinmez", async ({ page, request }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Parola").fill(PASSWORD);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page).toHaveURL(/\/admin$/);

    // Bu testin kendi olayı: bir ziyaretçi sayfayı açtı (bugün)
    const res = await request.post("/api/events", {
      data: { sessionId: crypto.randomUUID(), campaignId: MAIN, sentAt: Date.now(), events: [{ id: crypto.randomUUID(), name: "landing_view", ts: Date.now() }] },
    });
    expect(res.status()).toBe(200);

    const landing = async (query: string) => {
      await page.goto(`/admin${query}`);
      return Number(await page.getByTestId("kpi-landing").innerText());
    };
    const all = await landing("");
    expect(all).toBeGreaterThanOrEqual(1);

    // Bugünü kapsayan aralıkta hepsi; gelecekte ya da geçmişte kalan aralıkta hiçbiri
    expect(await landing(`?from=${day(-1)}&to=${day(1)}`)).toBe(all);
    expect(await landing(`?from=${day(0)}`)).toBe(all);
    expect(await landing(`?from=${day(2)}`)).toBe(0);
    expect(await landing(`?to=${day(-2)}`)).toBe(0);
    // Geçersiz değerler yok sayılır (tüm dönem gösterilir)
    expect(await landing(`?from=2026-02-30&to=abc`)).toBe(all);

    // Süzülmüş görünüm: form alanları dolu, dönem notu görünür, rapor ve CSV bağlantıları aralığı taşır
    await page.goto(`/admin?from=${day(2)}&to=${day(3)}`);
    await expect(page.getByTestId("range-from")).toHaveValue(day(2));
    await expect(page.getByTestId("range-to")).toHaveValue(day(3));
    await expect(page.getByTestId("range-note")).toContainText("Gösterilen dönem");
    await expect(page.getByTestId("report-link")).toHaveAttribute("href", new RegExp(`from=${day(2)}&to=${day(3)}`));

    // Formdan uygulama ve temizleme
    await page.goto("/admin");
    await page.getByTestId("range-from").fill(day(2));
    await page.getByTestId("range-to").fill(day(3));
    await page.getByTestId("range-apply").click();
    await expect(page).toHaveURL(new RegExp(`from=${day(2)}`));
    await expect(page.getByTestId("kpi-landing")).toHaveText("0");
    await page.getByTestId("range-clear").click();
    await expect(page.getByTestId("kpi-landing")).toHaveText(String(all));

    // Rapor: dönem başlığı, sayılar aralıkla sınırlı; CSV bağlantısı aralığı taşır
    await page.goto(`/admin/report?k=${MAIN}&from=${day(2)}&to=${day(3)}`);
    await expect(page.getByTestId("report-range")).toContainText("Rapor dönemi:");
    await expect(page.getByTestId("report-value").first()).toHaveText("0"); // Toplam erişim
    await expect(page.getByTestId("csv-link")).toHaveAttribute("href", new RegExp(`from=${day(2)}&to=${day(3)}`));

    // CSV: aralıksız tüm olaylar; gelecekteki aralıkta yalnızca başlık satırı; rapor CSV'sinde dönem satırı
    const rows = (s: string) => s.split("\r\n").filter(Boolean).length;
    const eventsAll = await (await page.request.get(`/api/admin/export?k=${MAIN}&type=events`)).text();
    const eventsNone = await (await page.request.get(`/api/admin/export?k=${MAIN}&type=events&from=${day(2)}`)).text();
    expect(rows(eventsAll)).toBeGreaterThan(1);
    expect(rows(eventsNone)).toBe(1);
    const report = await (await page.request.get(`/api/admin/export?k=${MAIN}&type=report&from=${day(-1)}&to=${day(1)}`)).text();
    expect(report).toContain("Rapor dönemi;");

    // Veri silinmedi: aralıksız görünüm aynı sayıyı gösterir
    expect(await landing("")).toBe(all);
  });
});
