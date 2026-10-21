import { defineConfig } from "@playwright/test";
import fs from "node:fs";

const PORT = 3500;
const localChromium = "/opt/pw-browsers/chromium";

/**
 * Uçtan uca testler üretim derlemesine (`npm run build`) karşı çalışır. Veritabanı her çalıştırmada
 * sıfırdan oluşturulan yerel test veritabanıdır (.data/e2e) ve örnek verilerle (Örnek/Demo adlı) başlar.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: false,
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
    command: `rm -rf .data/e2e && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/giris`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      AUTH_MODE: "dev",
      ALLOW_DEV_AUTH: "1",
      ALLOW_LOCAL_DB: "1",
      LOCAL_DB_DIR: ".data/e2e",
      DEV_SESSION_SECRET: "e2e-oturum-anahtari-".padEnd(40, "x"),
    },
  },
});
