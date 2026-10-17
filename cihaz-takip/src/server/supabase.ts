import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "./env";

/** İstek başına Supabase istemcisi (oturum çerezleri). Anahtarlar yalnızca sunucuda okunur. */
export async function supabaseForRequest() {
  const cfg = supabaseConfig();
  const store = await cookies();
  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) store.set(c.name, c.value, c.options);
        } catch {
          // Sunucu bileşeninde çerez yazılamaz; oturum yenilemesini proxy yapar.
        }
      },
    },
  });
}
