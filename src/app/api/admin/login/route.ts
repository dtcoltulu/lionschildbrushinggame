import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  SESSION_TTL_MS,
  adminConfigured,
  checkPassword,
  createSessionToken,
  recordFailure,
  tooManyFailures,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  // yalnızca site içi, admin/qr yolları
  return s === "/qr" || s.startsWith("/admin") ? s : "/admin";
}

function redirectTo(request: Request, path: string) {
  // Proxy/CDN arkasında doğru dış adresi kullanmak için göreli Location.
  return new NextResponse(null, { status: 303, headers: { location: path, "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const next = safeNext(form?.get("next") ?? null);
  const fail = (code: string) => redirectTo(request, `/admin/login?error=${code}&next=${encodeURIComponent(next)}`);

  if (!adminConfigured()) return fail("config");
  if (tooManyFailures()) return fail("locked");

  const password = form?.get("password");
  if (typeof password !== "string" || password.length > 200 || !checkPassword(password)) {
    recordFailure();
    await new Promise((r) => setTimeout(r, 700));
    return fail("bad");
  }

  const token = createSessionToken();
  if (!token) return fail("config");
  const res = redirectTo(request, next);
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
