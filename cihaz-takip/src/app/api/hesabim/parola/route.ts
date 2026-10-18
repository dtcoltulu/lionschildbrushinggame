import type { NextRequest } from "next/server";
import { asBody } from "@/lib/validate";
import { audit } from "@/server/audit";
import { authMode } from "@/server/env";
import { AppError, ValidationError } from "@/server/errors";
import { api, readJson } from "@/server/http";
import { MIN_PASSWORD } from "@/server/services/users";

/** Kullanıcı kendi parolasını değiştirir (yöneticinin verdiği ilk parolayı değiştirmek için). */
export const POST = api(async (ctx, req: NextRequest) => {
  if (authMode() !== "supabase") throw new AppError(400, "dev_mode", "Geliştirme modunda parola kullanılmaz.");
  if (ctx.actor.shared) {
    throw new AppError(403, "shared_login", "Kliniğin ortak şifresini yönetici Ayarlar → Giriş ve erişim bölümünden değiştirir.");
  }
  const body = asBody(await readJson(req));
  const pw = typeof body.password === "string" ? body.password : "";
  const again = typeof body.passwordAgain === "string" ? body.passwordAgain : "";
  if (pw.length < MIN_PASSWORD) throw new ValidationError({ password: `Yeni parola en az ${MIN_PASSWORD} karakter olmalı.` });
  if (pw !== again) throw new ValidationError({ passwordAgain: "İki parola aynı değil." });
  const { supabaseForRequest } = await import("@/server/supabase");
  const { error } = await (await supabaseForRequest()).auth.updateUser({ password: pw });
  if (error) throw new ValidationError({ password: `Parola değiştirilemedi: ${error.message}` });
  await audit(ctx.db, ctx, { entity: "user", entityId: ctx.actor.userId, action: "change_password", summary: `${ctx.actor.displayName} parolasını değiştirdi` });
  return { ok: true };
});
