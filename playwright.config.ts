import { defineConfig } from "@playwright/test";
import fs from "node:fs";

const PORT = 3100;
const localChromium = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 390, height: 780 },
    launchOptions: fs.existsSync(localChromium) ? { executablePath: localChromium, args: ["--no-sandbox"] } : {},
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/oyun`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ADMIN_PASSWORD: "test-parola-12345",
      ADMIN_SESSION_SECRET: "e2e-secret-".padEnd(40, "x"),
      ALLOW_MEMORY_STORE: "1",
      NEXT_PUBLIC_SITE_URL: "https://dis.example.org",
    },
  },
});
