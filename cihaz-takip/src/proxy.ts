import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * 1) İstenen sayfa yolunu sunucu bileşenlerine iletir (girişten sonra aynı sayfaya dönmek için).
 * 2) Supabase modunda oturum çerezlerini yeniler (süresi dolan erişim anahtarı sessizce tazelenir).
 * Yetki kontrolü burada DEĞİL, her sayfa ve API'nin kendisinde yapılır.
 */
export async function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-url-path", request.nextUrl.pathname + request.nextUrl.search);
  let response = NextResponse.next({ request: { headers } });

  const mode = process.env.AUTH_MODE || (process.env.NODE_ENV === "production" ? "supabase" : "dev");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (mode === "supabase" && url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list, cacheHeaders) => {
          for (const c of list) request.cookies.set(c.name, c.value);
          response = NextResponse.next({ request: { headers } });
          for (const c of list) response.cookies.set(c.name, c.value, c.options);
          for (const [k, v] of Object.entries(cacheHeaders ?? {})) response.headers.set(k, v);
        },
      },
    });
    await supabase.auth.getClaims();
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|apple-icon.png|manifest.webmanifest|favicon.ico).*)"],
};
