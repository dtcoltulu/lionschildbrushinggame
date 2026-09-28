import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "lions_admin";
export const SESSION_TTL_MS = 12 * 3600 * 1000;

function secret(): string | null {
  const s = process.env.ADMIN_SESSION_SECRET;
  return s && s.length >= 32 ? s : null;
}

function expectedPassword(): string | null {
  const p = process.env.ADMIN_PASSWORD;
  return p && p.length >= 12 ? p : null;
}

/** Yönetici girişi yapılandırılmış mı? (Değilse admin tamamen kapalı kalır.) */
export function adminConfigured(): boolean {
  return secret() !== null && expectedPassword() !== null;
}

const sha = (v: string) => createHash("sha256").update(v).digest();

/** Sabit süreli parola karşılaştırması. */
export function checkPassword(input: string): boolean {
  const expected = expectedPassword();
  if (!expected) return false;
  return timingSafeEqual(sha(input), sha(expected));
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createSessionToken(now = Date.now()): string | null {
  const key = secret();
  if (!key) return null;
  const exp = String(now + SESSION_TTL_MS);
  return `${exp}.${sign(exp, key)}`;
}

export function verifySessionToken(token: string | undefined | null, now = Date.now()): boolean {
  const key = secret();
  if (!key || !token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  const good = sign(exp, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(good);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(exp) > now;
}

// ---- Giriş denemesi yavaşlatma (IP saklamadan, bellek içi, genel) -----------
const attempts: number[] = [];
const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILS = 20;

export function tooManyFailures(now = Date.now()): boolean {
  while (attempts.length && now - attempts[0]! > WINDOW_MS) attempts.shift();
  return attempts.length >= MAX_FAILS;
}

export function recordFailure(now = Date.now()): void {
  attempts.push(now);
}
