import { expect, type Browser, type Page } from "@playwright/test";

export type Who = "Demo Yönetici" | "Demo Personel";

export async function login(page: Page, who: Who, next = "/") {
  await page.goto(`/giris?next=${encodeURIComponent(next)}`);
  await page.getByRole("button", { name: new RegExp(who) }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris"));
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
