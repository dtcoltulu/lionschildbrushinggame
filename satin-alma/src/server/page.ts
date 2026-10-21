import "server-only";
import { todayIstanbul } from "@/lib/dates";
import { requirePageActor } from "./auth";
import type { Ctx } from "./context";
import { forClinic, getDb } from "./db";
import type { Permission } from "./permissions";

/** Sayfa bağlamı: oturum yoksa giriş sayfasına, yetki yoksa ana sayfaya yönlendirir. Veritabanı yalnızca kullanıcının kliniğini görür. */
export async function pageCtx(perm?: Permission | Permission[]): Promise<Ctx> {
  const actor = await requirePageActor(perm);
  return { actor, db: forClinic(await getDb(), actor.clinicId), today: todayIstanbul() };
}

export type SearchParams = Record<string, string | string[] | undefined>;

export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function dateParam(v: string | string[] | undefined): string | null {
  const s = firstParam(v);
  return s && ISO.test(s) ? s : null;
}
