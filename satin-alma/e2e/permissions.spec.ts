import { expect, test } from "@playwright/test";
import { api, login } from "./helpers";

/** Kabul 8: asistan finansal verilere ne ekrandan ne de doğrudan API'den erişebilir. */
test("asistan: finansal API'ler 403, finans sayfaları kapalı", async ({ page }) => {
  // Fatura kimliği finans hesabıyla alınır; asistan bu kimliği bilse bile (doğrudan bağlantı) erişemez.
  await login(page, "Demo Finans");
  const inv = await api<{ items: { id: string }[] }>(page, "GET", "/api/faturalar");
  const invoiceId = inv.body.items[0]!.id;
  await page.context().clearCookies();
  await login(page, "Demo Asistan");
  for (const [method, url, data] of [
    ["GET", "/api/faturalar"], ["GET", "/api/odemeler"], ["GET", "/api/bakiyeler"], ["GET", "/api/duzeltmeler"], ["GET", "/api/raporlar/aylik"],
    ["GET", "/api/raporlar/harcama"], ["GET", "/api/disa-aktar/faturalar"], ["GET", "/api/disa-aktar/bakiyeler"], ["GET", `/api/faturalar/${invoiceId}`],
    ["GET", `/api/dosyalar?tur=invoice&id=${invoiceId}`],
    ["POST", "/api/odemeler", { supplierId: "00000000-0000-4000-8000-000000000001", amount: "1", paidOn: "2026-01-01", method: "nakit" }],
    ["POST", "/api/faturalar", { invoiceNo: "X" }], ["GET", "/api/kullanicilar"], ["GET", "/api/siparisler"],
  ] as [string, string, unknown?][]) {
    const r = await api(page, method, url, data);
    expect(r.status, `${method} ${url}`).toBe(403);
  }
  for (const p of ["/finans", "/finans/faturalar", `/finans/faturalar/${invoiceId}`, "/raporlar", "/siparisler"]) {
    await page.goto(p);
    await expect(page, p).toHaveURL(/\/\?yetki=yok/);
  }
  await expect(page.getByText("Bu sayfaya erişim yetkiniz yok.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Finans" })).toHaveCount(0);
});

test("teslimat sorumlusu: sipariş fiyatlarını API'de de göremez, finans 403", async ({ page }) => {
  await login(page, "Demo Teslimat");
  const html = await (await page.request.get("/teslimatlar")).text();
  const orderId = /\/siparisler\/([0-9a-f-]{36})/.exec(html)![1];
  const r = await api<{ order: { lines: { unitPrice: unknown; netAmount: unknown }[]; totals: unknown } }>(page, "GET", `/api/siparisler/${orderId}`);
  expect(r.status).toBe(200);
  expect(r.body.order.totals).toBeNull();
  expect(r.body.order.lines.every((l) => l.unitPrice === null && l.netAmount === null)).toBe(true);
  expect((await api(page, "GET", "/api/bakiyeler")).status).toBe(403);
  const text = await api<{ text: string }>(page, "GET", `/api/siparisler/${orderId}/metin?fiyat=1`);
  expect(text.status).toBe(200);
  expect(text.body.text).not.toMatch(/birim fiyat/);
});

test("oturumsuz istek 401, sayfa girişe yönlenir; başka siteden istek reddedilir", async ({ page }) => {
  expect((await api(page, "POST", "/api/talepler", {})).status).toBe(401);
  expect((await api(page, "GET", "/api/faturalar")).status).toBe(401);
  await page.goto("/finans/faturalar?gorunum=acik");
  await expect(page).toHaveURL(/\/giris\?next=%2Ffinans%2Ffaturalar%3Fgorunum%3Dacik/);
  await login(page, "Demo Satın Alma");
  const r = await page.request.post("/api/talepler", { data: {}, headers: { origin: "https://kotu-site.example" } });
  expect(r.status()).toBe(403);
});
