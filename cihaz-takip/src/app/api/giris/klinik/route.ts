import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { asBody, Reader } from "@/lib/validate";
import { CLINIC_COOKIE, CLINIC_COOKIE_OPTIONS, resolveAuthUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { authMode } from "@/server/env";
import { AppError, ValidationError } from "@/server/errors";
import { publicApi, readJson } from "@/server/http";
import { recordFailure, tooManyFailures } from "@/server/login-throttle";
import { SHARED_KINDS, type SharedKind } from "@/server/services/clinics";

/**
 * Klinik şifresiyle giriş: klinik seçilir, personel ya da yönetici şifresi yazılır. Şifreyi Supabase Auth
 * doğrular (kliniğin ortak giriş hesabı); uygulama şifre saklamaz.
 */
export const POST = publicApi(async (req: NextRequest) => {
  if (authMode() !== "supabase") throw new AppError(400, "dev_mode", "Geliştirme modunda parolasız giriş kullanılır.");
  const body = asBody(await readJson(req));
  const r = new Reader(body);
  const clinicId = r.optId("clinicId", "Klinik");
  if (!clinicId && !r.errors.clinicId) r.error("clinicId", "Klinik seçin.");
  const kind = r.oneOf("kind", "Giriş", ["staff", "admin"] as SharedKind[], "staff");
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) r.error("password", "Şifreyi yazın.");
  if (!r.ok) throw new ValidationError(r.errors);
  const key = `klinik:${clinicId}:${kind}`;
  if (tooManyFailures(key)) throw new AppError(429, "too_many", "Çok fazla hatalı deneme. 10 dakika sonra tekrar deneyin.");

  const db = await getDb();
  const [clinic] = await db.query<{ active: boolean }>(`select active from clinics where id = $1`, [clinicId]);
  if (!clinic) throw new AppError(404, "not_found", "Klinik bulunamadı.");
  if (!clinic.active) throw new AppError(403, "no_access", "Bu kliniğin erişimi kapatılmış. Genel yöneticiye başvurun.");
  const [account] = await db.query<{ email: string; active: boolean }>(
    `select email, active from app_users where clinic_id = $1 and shared and role = $2 and auth_user_id is not null`,
    [clinicId, kind],
  );
  const label = SHARED_KINDS.find((k) => k.value === kind)!.label.toLocaleLowerCase("tr");
  if (!account || !account.active) {
    throw new AppError(409, "not_ready", `Bu kliniğin ${label} henüz belirlenmemiş. Genel yöneticiye başvurun.`);
  }

  const { supabaseForRequest } = await import("@/server/supabase");
  const sb = await supabaseForRequest();
  const { data, error } = await sb.auth.signInWithPassword({ email: account.email, password });
  if (error || !data.user) {
    recordFailure(key);
    throw new AppError(401, "bad_credentials", "Şifre hatalı.", { password: "Şifre hatalı." });
  }
  const state = await resolveAuthUser(
    db,
    { id: data.user.id, email: data.user.email, emailConfirmed: !!data.user.email_confirmed_at },
    { selectedClinicId: clinicId },
  );
  if (state.kind !== "ok" || state.actor.clinicId !== clinicId || !state.actor.shared) {
    await sb.auth.signOut();
    throw new AppError(403, "no_access", "Bu girişin erişimi kapatılmış. Genel yöneticiye başvurun.");
  }
  await db.query(`update app_users set last_login_at = now() where id = $1`, [state.actor.userId]);
  (await cookies()).set(CLINIC_COOKIE, clinicId!, CLINIC_COOKIE_OPTIONS);
  return { ok: true };
});
