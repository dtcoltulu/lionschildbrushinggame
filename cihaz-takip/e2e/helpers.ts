import { expect, type Browser, type Page } from "@playwright/test";

export type Who = "Demo Yönetici" | "Demo Personel" | "Demo B Yönetici" | "Demo B Personel" | "Demo Genel Yönetici";

/** Deneme hesaplarının klinikleri (örnek veri: seed-demo.ts). Genel yönetici e-posta ile girip klinik seçer. */
const CLINIC_OF: Record<Who, string | null> = {
  "Demo Yönetici": "Koşuyolu Park",
  "Demo Personel": "Koşuyolu Park",
  "Demo B Yönetici": "Örnek Klinik B",
  "Demo B Personel": "Örnek Klinik B",
  "Demo Genel Yönetici": null,
};

/** Giriş: klinik seçilir, deneme hesabı seçilir (geliştirme modunda şifre yoktur). */
export async function login(page: Page, who: Who, next = "/", generalClinic = "Koşuyolu Park") {
  const clinic = CLINIC_OF[who];
  const q = new URLSearchParams({ next, ...(clinic ? { sec: "1" } : { genel: "1" }) });
  await page.goto(`/giris?${q}`);
  if (clinic) await page.getByRole("link", { name: clinic }).click();
  await page.getByRole("button", { name: new RegExp(`^${who}`) }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris"));
  if (!clinic) {
    await page.getByRole("button", { name: new RegExp(`^${generalClinic}`) }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/klinik-sec"));
  }
}

export async function newSession(browser: Browser, who: Who, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, locale: "tr-TR", timezoneId: "Europe/Istanbul" });
  const page = await context.newPage();
  await login(page, who);
  return { context, page };
}

/** Yönetici olarak (API ile) personel kartı ekler. */
export async function addStaff(page: Page, fullName: string, jobRole = "asistan") {
  const r = await page.request.post("/api/calisanlar", { data: { fullName, jobRole } });
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()).staff.id as string;
}

export function uniq(prefix: string) {
  return `${prefix} ${Date.now().toString(36).slice(-5)}`;
}
