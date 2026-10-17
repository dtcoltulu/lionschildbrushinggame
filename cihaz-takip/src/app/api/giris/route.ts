import type { NextRequest } from "next/server";
import { asBody, Reader } from "@/lib/validate";
import { resolveAuthUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { authMode } from "@/server/env";
import { AppError, ValidationError } from "@/server/errors";
import { publicApi, readJson } from "@/server/http";

// Basit yavaşlatma: art arda hatalı girişlerde bekletir (Supabase'in kendi hız sınırına ek).
const fails = new Map<string, number[]>();
function tooMany(key: string) {
  const now = Date.now();
  const list = (fails.get(key) ?? []).filter((t) => now - t < 10 * 60_000);
  fails.set(key, list);
  return list.length >= 8;
}

export const POST = publicApi(async (req: NextRequest) => {
  if (authMode() !== "supabase") throw new AppError(400, "dev_mode", "Geliştirme modunda parolasız giriş kullanılır.");
  const body = asBody(await readJson(req));
  const r = new Reader(body);
  const email = r.optEmail("email", "E-posta");
  if (!email && !r.errors.email) r.error("email", "E-posta adresinizi yazın.");
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) r.error("password", "Parolanızı yazın.");
  if (!r.ok) throw new ValidationError(r.errors);
  if (tooMany(email!)) throw new AppError(429, "too_many", "Çok fazla hatalı deneme. 10 dakika sonra tekrar deneyin.");

  const { supabaseForRequest } = await import("@/server/supabase");
  const sb = await supabaseForRequest();
  const { data, error } = await sb.auth.signInWithPassword({ email: email!, password });
  if (error?.code === "user_banned") {
    throw new AppError(403, "no_access", "Bu hesabın uygulamaya erişimi kapatılmış. Klinik yöneticisine başvurun.");
  }
  if (error || !data.user) {
    fails.get(email!)!.push(Date.now());
    throw new AppError(401, "bad_credentials", "E-posta veya parola hatalı.", { password: "E-posta veya parola hatalı." });
  }
  const db = await getDb();
  const state = await resolveAuthUser(db, { id: data.user.id, email: data.user.email, emailConfirmed: !!data.user.email_confirmed_at });
  if (state.kind !== "ok") {
    await sb.auth.signOut();
    throw new AppError(403, "no_access", "Bu hesabın uygulamaya erişimi yok veya kapatılmış. Klinik yöneticisine başvurun.");
  }
  await db.query(`update app_users set last_login_at = now() where id = $1`, [state.actor.userId]);
  return { ok: true };
});
