import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { todayIstanbul } from "@/lib/dates";
import { requireActor } from "./auth";
import type { Ctx } from "./context";
import { forClinic, getDb } from "./db";
import { ConfigError } from "./env";
import { AppError, ForbiddenError } from "./errors";

const NO_STORE = { "cache-control": "no-store" };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) {
    return json({ error: e.message, code: e.code, fieldErrors: e.fieldErrors ?? {}, ...(e.data ?? {}) }, e.status);
  }
  if (e instanceof ConfigError) {
    console.error("[yapılandırma]", e.message);
    return json({ error: `Sunucu yapılandırma hatası: ${e.message}`, code: "config" }, 500);
  }
  console.error("[api]", e);
  return json({ error: "Beklenmeyen bir hata oluştu. Girdiğiniz bilgiler bu sayfada duruyor; birazdan tekrar deneyin.", code: "server" }, 500);
}

/** Başka bir siteden gönderilen isteklere karşı (CSRF): değişiklik yapan istekler yalnızca aynı kökenden kabul edilir. */
export function assertSameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  if (!host || originHost !== host) throw new ForbiddenError("İstek başka bir siteden geldiği için reddedildi.");
}

/** API bağlamı: veritabanı yalnızca kullanıcının kliniğini görür. */
export async function makeCtx(): Promise<Ctx> {
  const actor = await requireActor();
  return { db: forClinic(await getDb(), actor.clinicId), actor, today: todayIstanbul() };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

type Params = Record<string, string>;

/** Oturum gerektiren API uç noktası. Yetki kontrolü servis fonksiyonlarının içinde yapılır. */
export function api<P extends Params = Params>(fn: (ctx: Ctx, req: NextRequest, params: P) => Promise<unknown>) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    try {
      assertSameOrigin(req);
      const ctx = await makeCtx();
      const result = await fn(ctx, req, await context.params);
      if (result instanceof Response) return result;
      return json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function publicApi<P extends Params = Params>(fn: (req: NextRequest, params: P) => Promise<unknown>) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    try {
      assertSameOrigin(req);
      const result = await fn(req, await context.params);
      if (result instanceof Response) return result;
      return json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}
