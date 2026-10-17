import "server-only";

/**
 * Ortam ayrımı:
 *  - Üretim (Vercel production): Supabase Postgres (DATABASE_URL) + Supabase Auth. Yerel veritabanı ve
 *    geliştirici girişi YASAKTIR; yapılandırma eksikse uygulama açık bir hata verir.
 *  - Test/önizleme: ayrı bir Supabase projesi (ayrı DATABASE_URL ve anahtarlar).
 *  - Geliştirme: dosyadaki yerel PGlite veritabanı + parolasız geliştirici girişi (kırmızı şerit görünür).
 */

export type AuthMode = "supabase" | "dev";

export class ConfigError extends Error {}

const isVercelProduction = () => process.env.VERCEL_ENV === "production";
const isNodeProduction = () => process.env.NODE_ENV === "production";

export function authMode(): AuthMode {
  const mode = process.env.AUTH_MODE || (isNodeProduction() ? "supabase" : "dev");
  if (mode !== "dev" && mode !== "supabase") throw new ConfigError(`AUTH_MODE geçersiz: ${mode}`);
  if (mode === "dev") {
    if (isVercelProduction()) throw new ConfigError("Geliştirici girişi (AUTH_MODE=dev) üretim ortamında kullanılamaz.");
    if (isNodeProduction() && process.env.ALLOW_DEV_AUTH !== "1") {
      throw new ConfigError("AUTH_MODE=dev üretim derlemesinde yalnızca ALLOW_DEV_AUTH=1 ile (otomatik testler için) açılabilir.");
    }
  }
  return mode;
}

export type DbConfig = { kind: "pg"; url: string } | { kind: "pglite"; dir: string };

export function dbConfig(): DbConfig {
  const url = process.env.DATABASE_URL;
  if (url) return { kind: "pg", url };
  if (isVercelProduction()) throw new ConfigError("DATABASE_URL tanımlı değil (üretimde yerel veritabanı kullanılamaz).");
  if (isNodeProduction() && process.env.ALLOW_LOCAL_DB !== "1") {
    throw new ConfigError("DATABASE_URL tanımlı değil. Yerel deneme veritabanı yalnızca geliştirmede ya da ALLOW_LOCAL_DB=1 ile açılır.");
  }
  return { kind: "pglite", dir: process.env.LOCAL_DB_DIR ?? ".data/pglite" };
}

/** Şeritte gösterilecek ortam adı (ör. "TEST"). Üretimde boş. */
export function environmentLabel(): string | null {
  if (process.env.APP_ENV_LABEL) return process.env.APP_ENV_LABEL;
  try {
    if (authMode() === "dev" || dbConfig().kind === "pglite") return "GELİŞTİRME";
  } catch {
    return "YAPILANDIRMA HATASI";
  }
  return null;
}

export function supabaseConfig(): { url: string; anonKey: string; serviceRoleKey: string | null } {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new ConfigError("SUPABASE_URL ve SUPABASE_ANON_KEY tanımlı olmalı (AUTH_MODE=supabase).");
  return { url, anonKey, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null };
}
