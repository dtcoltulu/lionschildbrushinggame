import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { asBody, Reader } from "@/lib/validate";
import { CLINIC_COOKIE, CLINIC_COOKIE_OPTIONS, resolveAuthUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { authMode } from "@/server/env";
import { AppError, ValidationError } from "@/server/errors";
import { publicApi, readJson } from "@/server/http";
import { recordFailure, tooManyFailures } from "@/server/login-throttle";

/** E-posta ile giriş: genel yönetici ve (varsa) kliniğin kişisel hesapları. */
export const POST = publicApi(async (req: NextRequest) => {
  if (authMode() !== "supabase") throw new AppError(400, "dev_mode", "Geliştirme modunda parolasız giriş kullanılır.");
  const body = asBody(await readJson(req));
  const r = new Reader(body);
  const email = r.optEmail("email", "E-posta");
  if (!email && !r.errors.email) r.error("email", "E-posta adresinizi yazın.");
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) r.error("password", "Parolanızı yazın.");
  if (!r.ok) throw new ValidationError(r.errors);
  if (tooManyFailures(email!)) throw new AppError(429, "too_many", "Çok fazla hatalı deneme. 10 dakika sonra tekrar deneyin.");

  const { supabaseForRequest } = await import("@/server/supabase");
  const sb = await supabaseForRequest();
  const { data, error } = await sb.auth.signInWithPassword({ email: email!, password });
  if (error?.code === "user_banned") {
    throw new AppError(403, "no_access", "Bu hesabın uygulamaya erişimi kapatılmış. Klinik yöneticisine başvurun.");
  }
  if (error || !data.user) {
    recordFailure(email!);
    throw new AppError(401, "bad_credentials", "E-posta veya parola hatalı.", { password: "E-posta veya parola hatalı." });
  }
  const db = await getDb();
  const store = await cookies();
  const state = await resolveAuthUser(
    db,
    { id: data.user.id, email: data.user.email, emailConfirmed: !!data.user.email_confirmed_at },
    { selectedClinicId: store.get(CLINIC_COOKIE)?.value ?? null },
  );
  if (state.kind !== "ok" && state.kind !== "choose_clinic") {
    await sb.auth.signOut();
    const closed = state.kind === "no_access" && state.reason === "clinic_inactive";
    throw new AppError(403, "no_access", closed ? "Bu kliniğin erişimi kapatılmış. Genel yöneticiye başvurun." : "Bu hesabın uygulamaya erişimi yok veya kapatılmış. Klinik yöneticisine başvurun.");
  }
  const userId = state.kind === "ok" ? state.actor.userId : state.userId;
  await db.query(`update app_users set last_login_at = now() where id = $1`, [userId]);
  if (state.kind === "ok") store.set(CLINIC_COOKIE, state.actor.clinicId, CLINIC_COOKIE_OPTIONS);
  return { ok: true, chooseClinic: state.kind === "choose_clinic" };
});
