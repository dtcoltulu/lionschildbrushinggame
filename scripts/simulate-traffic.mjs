#!/usr/bin/env node
/**
 * Yük / prova simülasyonu: gerçek çocukları taklit eden anonim olaylar gönderir.
 * SADECE deneme kampanyasına yazar (varsayılan: test-deneme), gerçek istatistikleri kirletmez.
 *
 *   npm run simulate -- --base=https://alanadi.org --kids=300 --concurrency=40
 */
import { randomUUID } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const BASE = (args.base ?? "http://localhost:3000").replace(/\/+$/, "");
const KIDS = Number(args.kids ?? 200);
const CONC = Number(args.concurrency ?? 30);
const CAMPAIGN = args.campaign ?? "test-deneme";
const SPREAD_HOURS = Number(args.hours ?? 4);

if (CAMPAIGN !== "test-deneme" && args.force !== "true") {
  console.error(`Güvenlik: yalnızca "test-deneme" kampanyasına yazılır. (Zorlamak için --force=true)`);
  process.exit(1);
}

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (p) => Math.random() < p;

function kidEvents(now) {
  const t0 = now - rnd(0, SPREAD_HOURS * 3600_000);
  let t = t0;
  const ev = (name, extra = {}) => ({ id: randomUUID(), name, ts: Math.round((t += rnd(500, 4000))), ...extra });
  const out = [ev("landing_view")];
  if (!pick(0.86)) return out; // sadece baktı
  const playId = randomUUID();
  if (pick(0.7)) {
    out.push(ev("tutorial_started"));
    out.push(pick(0.8) ? ev("tutorial_completed") : ev("tutorial_skipped"));
  }
  out.push(ev("game_started", { playId, playIndex: 1 }));
  const completes = pick(0.88);
  const phases = completes ? 6 : Math.floor(rnd(1, 6));
  let total = 0;
  for (let p = 1; p <= phases; p++) {
    const d = Math.round(rnd(5000, 13000));
    total += d + 1400;
    out.push(ev("phase_completed", { playId, playIndex: 1, phase: p, durationMs: d }));
  }
  if (completes) {
    out.push(ev("game_completed", { playId, playIndex: 1, durationMs: Math.round(total) }));
    out.push(ev("reward_screen_viewed", { playId, playIndex: 1 }));
    if (pick(0.15)) {
      const p2 = randomUUID();
      out.push(ev("replay_started", { playId: p2, playIndex: 2 }));
      if (pick(0.7)) out.push(ev("game_completed", { playId: p2, playIndex: 2, durationMs: Math.round(rnd(30000, 55000)) }));
    }
  }
  return out;
}

async function sendKid(now) {
  const sessionId = randomUUID();
  const events = kidEvents(now);
  const deviceClass = pick(0.9) ? "mobile" : "tablet";
  let failures = 0;
  for (let i = 0; i < events.length; i += 20) {
    const body = { sessionId, campaignId: CAMPAIGN, deviceClass, sentAt: now, events: events.slice(i, i + 20) };
    const t = performance.now();
    try {
      const res = await fetch(`${BASE}/api/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      lat.push(performance.now() - t);
      if (!res.ok) failures++;
    } catch {
      failures++;
    }
  }
  return { failures, events: events.length };
}

const lat = [];
const now = Date.now();
let next = 0;
let failed = 0;
let sent = 0;
const started = performance.now();
await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (next < KIDS) {
      next++;
      const r = await sendKid(now);
      failed += r.failures;
      sent += r.events;
    }
  }),
);
const secs = (performance.now() - started) / 1000;
lat.sort((a, b) => a - b);
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]?.toFixed(0);
console.log(`${KIDS} çocuk, ${sent} olay, ${lat.length} istek, ${secs.toFixed(1)} sn`);
console.log(`gecikme ms → p50: ${q(0.5)}  p95: ${q(0.95)}  max: ${lat.at(-1)?.toFixed(0)}`);
console.log(failed ? `HATALI İSTEK: ${failed}` : "hata yok ✔");
process.exit(failed ? 1 : 0);
