import { expect, type Page } from "@playwright/test";

export interface Captured {
  names: string[];
  bodies: Record<string, unknown>[];
}

/** /api/events isteklerini yakalar (gövdeyi doğrulamak için). İsteği yine de sunucuya iletir. */
export function captureEvents(page: Page): Captured {
  const cap: Captured = { names: [], bodies: [] };
  page.on("request", (req) => {
    if (req.url().endsWith("/api/events") && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "{}");
      cap.bodies.push(body);
      for (const e of body.events ?? []) cap.names.push(e.name);
    }
  });
  return cap;
}

/** Tuvali baştan sona zikzakla tarayan sanal çocuk (fare olayları). */
export async function scrubWholeCanvas(page: Page, opts: { until?: () => Promise<boolean>; passes?: number } = {}) {
  // Tuval kalkmış olabilir (ödül ekranı açıldı): sınırsız beklemeden çık.
  const box = await page.getByTestId("game-canvas").boundingBox({ timeout: 1000 }).catch(() => null);
  if (!box) return;
  const scale = Math.min(box.width / 360, box.height / 520);
  const ox = box.x + (box.width - 360 * scale) / 2;
  const oy = box.y + (box.height - 520 * scale) / 2;
  const passes = opts.passes ?? 6;
  for (let p = 0; p < passes; p++) {
    for (let wy = 70; wy <= 480; wy += 34) {
      if (opts.until && (await opts.until())) return;
      const y = oy + wy * scale;
      await page.mouse.move(ox + 10 * scale, y);
      await page.mouse.down();
      for (let k = 0; k < 4; k++) {
        await page.mouse.move(ox + (k % 2 ? 20 : 340) * scale, y, { steps: 10 });
      }
      await page.mouse.up();
    }
  }
}

/**
 * "Yardım" butonuyla oyunu bitirir (fırçalayamayan çocuk).
 * Tıklamaya KISA zaman sınırı konur: ödül ekranı açılınca buton DOM'dan kalkar; sınırsız bekleyen bir
 * click() döngüyü kilitler (CI'da aralıklı görülen hata buydu).
 */
export async function finishGameWithHelp(page: Page, timeout = 120_000) {
  await expect
    .poll(
      async () => {
        if (await page.getByTestId("reward-screen").isVisible()) return true;
        await page.getByTestId("help").click({ timeout: 500 }).catch(() => {});
        return false;
      },
      { timeout, intervals: [100] },
    )
    .toBe(true);
}
