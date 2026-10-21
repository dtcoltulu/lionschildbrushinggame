import type { NextRequest } from "next/server";
import { AppError, NotFoundError } from "@/server/errors";
import { assertSameOrigin, errorResponse, json, makeCtx } from "@/server/http";
import { matchRoute } from "@/server/routes";

type Context = { params: Promise<{ path: string[] }> };

/** Bütün uygulama uç noktaları için tek giriş: yol tablosu `src/server/routes.ts`. Oturum her istekte doğrulanır. */
async function handle(req: NextRequest, context: Context) {
  try {
    assertSameOrigin(req);
    const { path } = await context.params;
    const m = matchRoute(req.method, path);
    if (m === null) throw new NotFoundError("Böyle bir uç nokta yok.");
    if (m === "method") throw new AppError(405, "method", "Bu yöntem desteklenmiyor.");
    const ctx = await makeCtx();
    const result = await m.handler(ctx, req, m.params);
    if (result instanceof Response) return result;
    return json(result ?? { ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
