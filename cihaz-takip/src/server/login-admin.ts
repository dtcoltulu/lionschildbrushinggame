import "server-only";
import { authMode, ConfigError, supabaseConfig } from "./env";

/**
 * Giriş hesaplarının (kimlik doğrulama sağlayıcısı tarafı) yönetimi. Parolalar uygulamada SAKLANMAZ;
 * Supabase Auth tutar. Geliştirme modunda parola yoktur (geliştirici girişi), bu işlemler etkisizdir.
 */
export interface LoginAdmin {
  /**
   * dev: parola yok (deneme girişi). supabase: hesaplar uygulamadan açılır/parola verilir.
   * supabase-manual: SUPABASE_SERVICE_ROLE_KEY tanımlı değil; giriş hesabı Supabase panelinden açılır,
   * kişi ilk girişte (doğrulanmış e-postasıyla) uygulamadaki kaydına bağlanır.
   */
  readonly mode: "dev" | "supabase" | "supabase-manual";
  readonly usesPasswords: boolean;
  /** Yeni giriş hesabı açar; Supabase kullanıcı kimliğini döndürür. Hesap zaten varsa null. */
  createLogin(email: string, password: string): Promise<string | null>;
  setPassword(authUserId: string, password: string): Promise<void>;
  setBlocked(authUserId: string, blocked: boolean): Promise<void>;
}

export const devLoginAdmin: LoginAdmin = {
  mode: "dev",
  usesPasswords: false,
  async createLogin() {
    return null;
  },
  async setPassword() {},
  async setBlocked() {},
};

export class LoginAdminError extends Error {}

async function supabaseAdminClient() {
  const cfg = supabaseConfig();
  if (!cfg.serviceRoleKey) throw new ConfigError("Kullanıcı eklemek için SUPABASE_SERVICE_ROLE_KEY (yalnızca sunucuda) tanımlı olmalı.");
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(cfg.url, cfg.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

const supabaseLoginAdmin: LoginAdmin = {
  mode: "supabase",
  usesPasswords: true,
  async createLogin(email, password) {
    const sb = await supabaseAdminClient();
    const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) return null;
      if (/password/i.test(error.message)) throw new LoginAdminError(`Parola kabul edilmedi: ${error.message}`);
      throw new LoginAdminError(`Giriş hesabı açılamadı: ${error.message}`);
    }
    return data.user?.id ?? null;
  },
  async setPassword(authUserId, password) {
    const sb = await supabaseAdminClient();
    const { error } = await sb.auth.admin.updateUserById(authUserId, { password });
    if (error) throw new LoginAdminError(`Parola değiştirilemedi: ${error.message}`);
  },
  async setBlocked(authUserId, blocked) {
    const sb = await supabaseAdminClient();
    // Uygulama erişimi app_users.active ile anında kesilir; ayrıca Supabase oturumu da engellenir.
    const { error } = await sb.auth.admin.updateUserById(authUserId, { ban_duration: blocked ? "876000h" : "none" });
    if (error) throw new LoginAdminError(`Giriş hesabı güncellenemedi: ${error.message}`);
  },
};

/** Gizli anahtar yokken: hesap açma/parola işlemleri Supabase panelinden yapılır; erişim kapatma uygulamada anında geçerlidir. */
const manualLoginAdmin: LoginAdmin = {
  mode: "supabase-manual",
  usesPasswords: false,
  async createLogin() {
    return null;
  },
  async setPassword() {
    throw new LoginAdminError("Parola, Supabase panelinden (Authentication → Users) sıfırlanmalı: SUPABASE_SERVICE_ROLE_KEY tanımlı değil.");
  },
  async setBlocked() {},
};

export function getLoginAdmin(): LoginAdmin {
  if (authMode() !== "supabase") return devLoginAdmin;
  return supabaseConfig().serviceRoleKey ? supabaseLoginAdmin : manualLoginAdmin;
}
