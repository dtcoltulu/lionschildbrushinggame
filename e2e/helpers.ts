import type { Page } from "@playwright/test";

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
  const box = (await page.getByTestId("game-canvas").boundingBox())!;
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
