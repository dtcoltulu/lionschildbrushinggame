import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * YALNIZCA geliştirme/test: parolasız "bu kullanıcı olarak gir" çerezi. Üretimde env.authMode() bunu
 * açtırmaz. Gerçek kimlik doğrulama Supabase Auth'tadır; bu bir kimlik doğrulama sistemi değildir.
 */
export const DEV_COOKIE = "sa_dev_session";
const TTL_MS = 12 * 3600 * 1000;

type G = { __devSecret?: string };
function secret(): string {
  const env = process.env.DEV_SESSION_SECRET;
  if (env && env.length >= 32) return env;
  const g = globalThis as G;
  g.__devSecret ??= randomBytes(32).toString("hex");
  return g.__devSecret;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function createDevToken(userId: string, now = Date.now()): string {
  const payload = `${userId}.${now + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyDevToken(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts as [string, string, string];
  const good = Buffer.from(sign(`${userId}.${exp}`));
  const got = Buffer.from(sig);
  if (good.length !== got.length || !timingSafeEqual(good, got)) return null;
  if (!/^\d+$/.test(exp) || Number(exp) < now) return null;
  return userId;
}

export const DEV_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: TTL_MS / 1000, secure: process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "1" };
