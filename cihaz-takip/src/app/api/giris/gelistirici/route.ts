import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { asBody, isUuid } from "@/lib/validate";
import { CLINIC_COOKIE, CLINIC_COOKIE_OPTIONS, stateForUser, USER_COLS, type UserRow } from "@/server/auth";
import { getDb } from "@/server/db";
import { createDevToken, DEV_COOKIE, DEV_COOKIE_OPTIONS } from "@/server/dev-session";
import { authMode } from "@/server/env";
import { AppError } from "@/server/errors";
import { publicApi, readJson } from "@/server/http";

/** YALNIZCA geliştirme/test: seçilen deneme hesabıyla parolasız giriş. Üretimde authMode() bunu engeller. */
export const POST = publicApi(async (req: NextRequest) => {
  if (authMode() !== "dev") throw new AppError(404, "not_found", "Bulunamadı.");
  const { userId, clinicId } = asBody(await readJson(req));
  if (!isUuid(userId)) throw new AppError(422, "validation", "Kullanıcı seçin.");
  const db = await getDb();
  const [row] = await db.query<UserRow>(`select ${USER_COLS} from app_users where id = $1`, [userId]);
  const state = await stateForUser(db, row, { selectedClinicId: isUuid(clinicId) ? clinicId : null });
  if (state.kind !== "ok" && state.kind !== "choose_clinic") throw new AppError(403, "no_access", "Bu hesabın erişimi kapalı.");
  await db.query(`update app_users set last_login_at = now() where id = $1`, [userId]);
  const store = await cookies();
  store.set(DEV_COOKIE, createDevToken(userId), DEV_COOKIE_OPTIONS);
  if (state.kind === "ok") store.set(CLINIC_COOKIE, state.actor.clinicId, CLINIC_COOKIE_OPTIONS);
  return { ok: true, chooseClinic: state.kind === "choose_clinic" };
});
