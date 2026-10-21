import { expect, type Browser, type Page } from "@playwright/test";

export type Who = "Demo Asistan" | "Demo Satın Alma" | "Demo Teslimat" | "Demo Finans" | "Demo Klinik Yöneticisi";

/** Giriş: geliştirme modunda deneme hesabı seçilir (parola yok). */
export async function login(page: Page, who: Who, next = "/") {
  await page.goto(`/giris?${new URLSearchParams({ next })}`);
  await page.getByRole("button", { name: new RegExp(`^${who}`) }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/giris"));
}

export async function newSession(browser: Browser, who: Who) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "tr-TR", timezoneId: "Europe/Istanbul" });
  const page = await context.newPage();
  await login(page, who);
  return { context, page };
}

/** Deneme hesabının kimliği (giriş ekranındaki listeden; yalnızca geliştirme/test). */
export async function demoUserId(browser: Browser, name: Who): Promise<string> {
  const ctx = await browser.newContext();
  const html = await (await ctx.request.get("/giris")).text();
  await ctx.close();
  for (const m of html.matchAll(/\\?"id\\?":\\?"([0-9a-f-]{36})\\?",\\?"displayName\\?":\\?"([^"\\]+)/g)) if (m[2] === name) return m[1]!;
  throw new Error(`Deneme hesabı bulunamadı: ${name}`);
}

export function isoDays(n: number) {
  const d = new Date(Date.now() + n * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(d);
}

export async function api<T = Record<string, unknown>>(page: Page, method: string, url: string, data?: unknown): Promise<{ status: number; body: T }> {
  const r = await page.request.fetch(url, { method, data });
  return { status: r.status(), body: (await r.json().catch(() => ({}))) as T };
}

export async function expectOk(r: { status: number; body: unknown }) {
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}
