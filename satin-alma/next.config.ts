import path from "node:path";
import type { NextConfig } from "next";

// Bu uygulama depo içinde kendi klasöründedir; üst klasördeki diğer projenin dosyaları izlenmez.
const root = path.resolve(__dirname);

const isProd = process.env.NODE_ENV === "production";

const csp = [
  "default-src 'self'",
  // Next.js satır içi başlatma betikleri için 'unsafe-inline' gerekir; dış kaynak yüklenmez.
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // Tarayıcı yalnızca bu uygulamanın sunucusuyla konuşur (veritabanı/Supabase'e doğrudan bağlanmaz).
  "connect-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: root,
  turbopack: { root },
  reactStrictMode: true,
  // `next dev` ajan kuralları dosyası (AGENTS.md) üretmesin; depodaki diğer uygulamayla aynı.
  agentRules: false,
  // Veritabanı sürücüleri paketlenmez (PGlite WASM dosyalarını diskten okur).
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // Kamera ileride QR okutma için bu sitenin kendisine açık; diğerleri kapalı.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), interest-cohort=()" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
