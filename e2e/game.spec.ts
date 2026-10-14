import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { JAW_DROP, MOUTH, MOUTH_IN } from "../src/game/layout";
import { answerCheckIfOpen, captureEvents, finishGameWithHelp, scrubWholeCanvas, type Captured } from "./helpers";

test.describe("Oyun akışı", () => {
  test("QR adresi → öğretici → 6 aşama → ödül → tekrar oyna; olaylar doğru", async ({ page }) => {
    const cap = captureEvents(page);
    // Ses, animasyon ve ağız açılması dahil hiçbir yakalanmamış JS hatası olmamalı.
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
    // Asıl kampanya: diş macunu / standdaki görevli kartı yerine Koşuyolu Park ücretsiz muayene fırsatı ve web sitesi
    await expectClinicOffer(reward);
    await expect(reward).toContainText("Günde 3 kez fırçala");
    await expect(reward).toContainText("Yaklaşık 2 dakika fırçala");
    await expect(reward).toContainText("Dişlerini düzenli kontrol ettir");
    await expect(reward).toContainText("Tekrar Oyna");
    // Oyun süresi + 2 dakika geri bildirimi + tarih/saat damgası; hiçbir şey saniye saniye akmaz.
    await expect(reward.getByTestId("took")).toHaveText(/^🏁 Süren: (\d+ dk)?( ?\d+ sn)?$/);
    await expect(reward.getByTestId("verdict")).toHaveText(/Hızlı fırçaladın!|ideal süreye ulaştın!/);
    await expect(reward.getByTestId("stamp")).toHaveText(/\d{1,2} \p{L}+ · \d{2}:\d{2}/u);
    await expect(reward.getByTestId("stamp")).not.toHaveText(/\d{2}:\d{2}:\d{2}/);

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

  test("diş araları bitince yüz dönmez: çene iner, ağız kocaman açılır; sonra iç yüzeyler fırçalanır", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.goto("/oyun");
    await page.getByTestId("start").click();
    await page.getByTestId("skip-tutorial").click();
    const dlg = page.getByTestId("check-dialog");
    // 1. aşama bitince çıkan soruyu geç; 2. aşama (diş araları) bitince çıkan soruda dur
    await expect
      .poll(
        async () => {
          if (await dlg.isVisible()) {
            if ((await page.getByTestId("play-screen").getAttribute("data-phase")) === "2") return "diş araları bitti";
            await answerCheckIfOpen(page);
            return "ilk soru";
          }
          await page.getByTestId("help").click({ timeout: 500 }).catch(() => {});
          return "oynanıyor";
        },
        { timeout: 120_000, intervals: [100] },
      )
      .toBe("diş araları bitti");
    await page.getByTestId("check-no").click();
    await expect(page.getByTestId("check-continue")).toBeVisible();

    // Sayfa içinden her karede üç nokta okunur: yüzün yanağı (yüz), yüzün dışı (arka plan) ve alt dudağın tam açık ağızdaki yeri.
    const lipY = MOUTH_IN.y + MOUTH_IN.h + JAW_DROP + (MOUTH.y + MOUTH.h - (MOUTH_IN.y + MOUTH_IN.h)) / 2;
    const probe = page.evaluate(
      ({ face, bg, lip, ms }) =>
        new Promise<{ t: number; face: number[]; bg: number[]; lip: number[] }[]>((resolve) => {
          const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]')!;
          const ctx = canvas.getContext("2d")!;
          const W = canvas.clientWidth;
          const H = canvas.clientHeight;
          const dpr = canvas.width / W;
          const scale = Math.min(W / 360, H / 520);
          const ox = (W - 360 * scale) / 2;
          const oy = (H - 520 * scale) / 2;
          const at = (p: number[]) => Array.from(ctx.getImageData(Math.round(dpr * (ox + scale * p[0]!)), Math.round(dpr * (oy + scale * p[1]!)), 1, 1).data);
          const out: { t: number; face: number[]; bg: number[]; lip: number[] }[] = [];
          const t0 = performance.now();
          const tick = () => {
            const t = performance.now() - t0;
            out.push({ t, face: at(face), bg: at(bg), lip: at(lip) });
            if (t < ms) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
      { face: [20, 200], bg: [2, 500], lip: [180, lipY], ms: 2600 },
    );
    await page.getByTestId("check-continue").click();

    // Sahne değişince yeni aşama başlar: "Aaa de!" ve iç yüzey yönergesi
    await expect(page.getByTestId("callout")).toHaveText("Aaa de!");
    await expect(page.getByTestId("message")).toContainText("Ağzını kocaman aç");
    await expect(page.getByTestId("play-screen")).toHaveAttribute("data-phase", "3");

    const samples = await probe;
    expect(samples.length).toBeGreaterThan(30);
    const lum = (c: number[]) => 0.3 * c[0]! + 0.59 * c[1]! + 0.11 * c[2]!;
    const coral = (c: number[]) => c[0]! > 200 && c[1]! > 70 && c[1]! < 150 && c[2]! > 70 && c[2]! < 150; // dudak #FF6B6B
    // Yüz dönmez: yanak noktası ilk karesinden son karesine dek yüzün rengindedir (yüz yana dönse arka plan görünürdü)
    for (const s of samples) expect(lum(s.face) - lum(s.bg), `t=${Math.round(s.t)} ms`).toBeGreaterThan(30);
    // Çene iner: başta alt dudağın olacağı nokta yüzün rengidir, sonda dudak rengidir
    expect(coral(samples[0]!.lip)).toBe(false);
    expect(samples.some((s) => coral(s.lip))).toBe(true);
    expect(coral(samples[samples.length - 1]!.lip)).toBe(true);
    // Oynanış sürüyor: iç yüzeyler bitirilebilir
    await finishGameWithHelp(page);
    expect(pageErrors).toEqual([]);
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
    // Ödül ekranındaki dış (klinik) bağlantısı gizlilik sayfasında açıkça belirtilir
    await expect(page.getByText("diş kliniğinin web sitesine giden bağlantı", { exact: false })).toBeVisible();
    // Soruya verilen Evet/Hayır cevabının kimliksiz sayıldığı da açıkça belirtilir
    await expect(page.getByText("Sence yeterli ve etkin temizlendi mi?", { exact: false })).toBeVisible();
    await expect(page.getByText("cevabı kimin verdiği bilinmez", { exact: false })).toBeVisible();
  });
});

test.describe("Bağlantı sorunları", () => {
  test("çevrimdışı oynanır, olaylar kuyrukta bekler, internet gelince gönderilir", async ({ page, context }) => {
    const cap = captureEvents(page);
    await page.goto("/oyun");
    await expect.poll(() => cap.names.includes("landing_view"), { timeout: 10_000 }).toBe(true);
    // Klinik logosu oyun başında yüklenip service worker önbelleğine alınır (çevrimdışı ödül ekranında görünsün)
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const c = await caches.open("lions-static-v1");
            return (await c.keys()).some((r) => r.url.endsWith("/assets/kosuyolu-park.png"));
          }),
        { timeout: 20_000 },
      )
      .toBe(true);

    await context.setOffline(true);
    await page.getByTestId("start").click();
    await page.getByTestId("skip-tutorial").click();
    await expect(page.getByTestId("play-screen")).toBeVisible();
    await finishGameWithHelp(page);
    // Oyun çevrimdışı tamamlandı: ödül ekranı geldi ve klinik logosu yüklü (kırık resim değil). Kuyrukta bekleyen olaylar var.
    const logo = page.getByTestId("clinic-offer").getByRole("img", { name: "Koşuyolu Park Diş Kliniği" });
    await expect(logo).toBeVisible();
    expect(await logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
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

  test("telefonda ses: gerçek 'dokunmadan ses yok' politikasında ilk dokunuşla ses açılır ve oyun boyunca açık kalır", async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices["Pixel 7"] });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/oyun");
    await expect(page.getByTestId("sound-hint")).toBeVisible(); // sessiz mod uyarısı
    // Dokunmadan önce ses bağlamı yok / askıda (tarayıcı politikası)
    expect(["none", "suspended"]).toContain(await page.evaluate(() => document.documentElement.dataset.audio));

    await page.getByTestId("start").tap(); // gerçek dokunuş
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.audio), { timeout: 5000 }).toBe("running");

    await page.getByTestId("skip-tutorial").tap();
    await expect(page.getByTestId("play-screen")).toBeVisible();
    // Oyun sırasında da açık kalır ve hata yok
    await page.getByTestId("help").tap();
    expect(await page.evaluate(() => document.documentElement.dataset.audio)).toBe("running");
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test("ses testi sayfası: dokununca ses açılır, durum ve ipuçları görünür", async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices["Pixel 7"] });
    const page = await ctx.newPage();
    await page.goto("/ses-testi");
    await expect(page.getByRole("heading", { name: "Ses testi" })).toBeVisible();
    await expect(page.getByTestId("state")).toContainText("Henüz açılmadı");
    await page.getByTestId("play-yay").tap();
    await expect(page.getByTestId("state")).toContainText("Açık", { timeout: 5000 });
    await expect(page.getByTestId("tips")).toContainText("sessiz düğmesini");
    await ctx.close();
  });
});

type Answer = "yes" | "no";

interface QuestionRun {
  /** Sorulan aşamalar, verilen cevaplar ve cevaptan sonra görünen geri bildirim metni (sırayla). */
  results: { phase: number; answer: Answer; text: string }[];
  /** Soru, aşama TAMAMEN temizlenmeden (ilerleme aşamanın sonunda değilken) çıktı mı? */
  questionBeforeCompletion: boolean;
}

/** Her aşamada verilen cevap sırası: 1. Evet, 2. Hayır, 3. Evet, 4. Hayır, 5. Hayır. */
const ANSWERS: Answer[] = ["yes", "no", "yes", "no", "no"];

/**
 * Öğreticiyi atlar, oyunu "Yardım"la oynar ve her aşama bitince çıkan soruyu verilen cevaplarla yanıtlar; ödül ekranı açılınca döner.
 * İlk soruda oyunun durduğunu (ilerleme değişmez, soru kendiliğinden kapanmaz, arkadaki "Yardım" kullanılamaz) doğrular.
 */
async function playAnsweringQuestions(page: Page, answers: Answer[]): Promise<QuestionRun> {
  await page.getByTestId("start").click();
  await page.getByTestId("skip-tutorial").click();
  await expect(page.getByTestId("play-screen")).toBeVisible();

  const results: QuestionRun["results"] = [];
  let pausedChecked = false;
  let questionBeforeCompletion = false;

  await expect
    .poll(
      async () => {
        if (await page.getByTestId("reward-screen").isVisible()) return "reward";
        const dlg = page.getByTestId("check-dialog");
        if (await dlg.isVisible()) {
          const phase = Number(await page.getByTestId("play-screen").getAttribute("data-phase"));
          await expect(dlg).toContainText("Sence yeterli ve etkin temizlendi mi?");
          // Soru, aşama TAMAMEN temizlendikten sonra çıkar: ilerleme tam o aşamanın sonunda (aşama/6), arada değil.
          const pct = Number(await page.getByRole("progressbar").getAttribute("aria-valuenow"));
          if (pct !== Math.round((phase / 6) * 100)) questionBeforeCompletion = true;
          if (!pausedChecked) {
            // Soru açıkken oyun durur: ilerleme değişmez, soru kendiliğinden kapanmaz, arkadaki "Yardım" tıklanamaz.
            const bar = page.getByRole("progressbar");
            const before = await bar.getAttribute("aria-valuenow");
            await page.waitForTimeout(1500);
            expect(await bar.getAttribute("aria-valuenow")).toBe(before);
            await expect(dlg).toBeVisible();
            // Arkadaki "Yardım" butonu soru açıkken kullanılamaz (üstü kapalı/inert): soru atlanamaz.
            await expect(page.getByTestId("help").click({ timeout: 400 })).rejects.toThrow();
            pausedChecked = true;
          }
          const a = answers[results.length]!;
          await page.getByTestId(a === "yes" ? "check-yes" : "check-no").click();
          const fb = page.getByTestId("check-feedback");
          await expect(fb).toHaveAttribute("data-answer", a);
          results.push({ phase, answer: a, text: await fb.innerText() });
          await page.getByTestId("check-continue").click();
          await expect(dlg).toBeHidden();
          // Cevaptan sonra sonraki aşamaya geçilir (ağız açılması/geçiş dahil): aşama göstergesi bir artar.
          await expect(page.getByTestId("play-screen")).toHaveAttribute("data-phase", String(phase + 1), { timeout: 8000 });
          return "playing";
        }
        await page.getByTestId("help").click({ timeout: 500 }).catch(() => {});
        return "playing";
      },
      { timeout: 170_000, intervals: [100] },
    )
    .toBe("reward");

  return { results, questionBeforeCompletion };
}

/** 5 soru (aşama 1..5), son aşamada (6) soru yok; hiçbiri aşama bitmeden çıkmadı; her cevaba uygun geri bildirim (ANSWERS sırasıyla). */
function expectQuestionRun(run: QuestionRun) {
  const { results, questionBeforeCompletion } = run;
  expect(results.map((r) => r.phase)).toEqual([1, 2, 3, 4, 5]);
  expect(questionBeforeCompletion).toBe(false);
  for (const r of results) {
    if (r.answer === "yes") {
      // aşama bitti ama temizlik bitmedi: kalan yüzeyler söylenir
      expect(r.text).toContain("Henüz bitmedi! Sırada");
      expect(r.text).toContain("diş ipi var"); // her "Evet" uyarısı son adımı (diş ipi) da sayar
    } else {
      expect(r.text).toContain("Aferin, işi biliyorsun"); // doğru farkındalık için tebrik
    }
  }
  expect(results[0]!.text).toContain("diş araları"); // 1. aşama bitince "Evet": sırada diş araları ... var
  expect(results[2]!.text).not.toContain("diş araları"); // 3. aşama bitince diş araları artık sayılmaz
}

/** Ödül ekranında diş macunu / standdaki görevli yerine Koşuyolu Park ücretsiz muayene fırsatı ve web sitesi bağlantısı görünür. */
async function expectClinicOffer(reward: Locator) {
  const offer = reward.getByTestId("clinic-offer");
  await expect(offer).toContainText("Ücretsiz muayene fırsatı!");
  await expect(offer).toContainText("Koşuyolu Park Diş Kliniği");
  await expect(offer.getByRole("img", { name: "Koşuyolu Park Diş Kliniği" })).toBeVisible();
  // Kartın sonunda klinik web sitesi: dokunulabilir, yeni sekmede açılır, yönlendiren adres gönderilmez
  const site = offer.getByTestId("clinic-website");
  await expect(site).toBeVisible();
  await expect(site).toContainText("www.kosuyolupark.com");
  await expect(site).toHaveAttribute("href", "https://www.kosuyolupark.com");
  await expect(site).toHaveAttribute("target", "_blank");
  await expect(site).toHaveAttribute("rel", /noopener/);
  await expect(site).toHaveAttribute("rel", /noreferrer/);
  await expect(reward).not.toContainText("Diş macunu hediyeni al.");
  await expect(reward).not.toContainText("görevliye göster");
}

/** Cevaplar anonim olay olarak, o kampanyanın kimliğiyle ve aşama numarasıyla gönderilir; sayılar cevaplarla eşleşir (ANSWERS). */
async function expectAnswersSent(page: Page, cap: Captured, campaignId: string) {
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => cap.names.filter((n) => n.startsWith("self_check")).length, { timeout: 15_000 }).toBe(5);
  expect(cap.names.filter((n) => n === "self_check_yes")).toHaveLength(2);
  expect(cap.names.filter((n) => n === "self_check_no")).toHaveLength(3);
  const withAnswers = cap.bodies.filter((b) => (b.events as { name: string }[]).some((e) => e.name.startsWith("self_check")));
  expect(withAnswers.length).toBeGreaterThan(0);
  for (const b of withAnswers) expect(b.campaignId).toBe(campaignId);
  const sent = cap.bodies.flatMap((b) => (b.events as { name: string; phase?: number }[]).filter((e) => e.name.startsWith("self_check")));
  expect(sent.map((e) => [e.name, e.phase])).toEqual([
    ["self_check_yes", 1],
    ["self_check_no", 2],
    ["self_check_yes", 3],
    ["self_check_no", 4],
    ["self_check_no", 5],
  ]);
}

test.describe('Kendini değerlendirme: "Sence yeterli ve etkin temizlendi mi?" (asıl ve deneme kampanyası)', () => {
  test("ASIL kampanyada her aşama BİTİNCE (son aşama hariç) soru çıkar; oyun durur; Evet/Hayır geri bildirimi, geçiş ve sayım çalışır; ödül ekranında diş macunu yerine klinik fırsatı çıkar", async ({ page }) => {
    const cap = captureEvents(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.goto("/oyun");
    expectQuestionRun(await playAnsweringQuestions(page, ANSWERS));

    // Ödül ekranı: diş macunu/standdaki görevli yerine Koşuyolu Park ücretsiz muayene fırsatı ve web sitesi
    await expectClinicOffer(page.getByTestId("reward-screen"));

    await expectAnswersSent(page, cap, "lions-118y-2026-10-11");
    expect(pageErrors).toEqual([]);
  });

  test("deneme kampanyasında da aynı soru çıkar ve aynı klinik fırsatı görünür", async ({ page }) => {
    const cap = captureEvents(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.goto("/oyun?k=test-deneme");
    expectQuestionRun(await playAnsweringQuestions(page, ANSWERS));

    await expectClinicOffer(page.getByTestId("reward-screen"));

    await expectAnswersSent(page, cap, "test-deneme");
    expect(pageErrors).toEqual([]);
  });
});
