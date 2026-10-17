import { defineConfig } from "@playwright/test";
import fs from "node:fs";

/**
 * GERÇEK Supabase Auth'a karşı giriş testleri (isteğe bağlı; CI'da çalışmaz).
 * Ayrı bir TEST Supabase projesi (ya da yerel Supabase) ve şu ortam değişkenleri gerekir:
 *   DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *   BOOTSTRAP_ADMIN_EMAIL + E2E_ADMIN_PASSWORD (Supabase'de açılmış, uygulamada henüz kaydı olmayan ilk yönetici)
 * Çalıştırma: npm run build && npx playwright test -c playwright.supabase.config.ts
 * ÜRETİM veritabanına karşı ÇALIŞTIRMAYIN (deneme kullanıcıları ve kayıtları oluşturur).
 */
const PORT = 3400;
const localChromium = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "e2e-supabase",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 390, height: 844 },
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    launchOptions: fs.existsSync(localChromium) ? { executablePath: localChromium, args: ["--no-sandbox"] } : {},
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/giris`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: { AUTH_MODE: "supabase", APP_ENV_LABEL: "TEST" },
  },
});
