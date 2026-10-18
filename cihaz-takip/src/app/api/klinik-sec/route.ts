import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { asBody, isUuid } from "@/lib/validate";
import { CLINIC_COOKIE, CLINIC_COOKIE_OPTIONS, getAuthState } from "@/server/auth";
import { getDb } from "@/server/db";
import { AppError, ForbiddenError, UnauthorizedError } from "@/server/errors";
import { publicApi, readJson } from "@/server/http";

/** Genel yönetici çalışacağı kliniği seçer (ya da değiştirir). Klinik hesapları kendi kliniklerine bağlıdır. */
export const POST = publicApi(async (req: NextRequest) => {
  const state = await getAuthState();
  if (state.kind === "anonymous" || state.kind === "no_access") throw new UnauthorizedError();
  if (state.kind === "ok" && !state.actor.superAdmin) throw new ForbiddenError("Klinik hesabı yalnızca kendi kliniğinde çalışır.");
  const { clinicId } = asBody(await readJson(req));
  if (!isUuid(clinicId) || !(await (await getDb()).query(`select 1 from clinics where id = $1`, [clinicId])).length) {
    throw new AppError(404, "not_found", "Klinik bulunamadı.");
  }
  (await cookies()).set(CLINIC_COOKIE, clinicId, CLINIC_COOKIE_OPTIONS);
  return { ok: true };
});
