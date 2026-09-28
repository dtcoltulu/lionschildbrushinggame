import "server-only";
import { MemoryStore, type EventStore } from "./store";
import { SupabaseStore } from "./supabase-store";

declare global {
  var __lionsStore: EventStore | undefined;
}

/**
 * Supabase ortam değişkenleri varsa Supabase; yoksa yalnızca geliştirmede bellek içi depo.
 * Üretimde yapılandırma eksikse null döner (API 503 verir, istemci kuyrukta tutar).
 */
export function getStore(): EventStore | null {
  if (globalThis.__lionsStore) return globalThis.__lionsStore;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    globalThis.__lionsStore = new SupabaseStore(url, key);
  } else if (process.env.NODE_ENV !== "production" || process.env.ALLOW_MEMORY_STORE === "1") {
    globalThis.__lionsStore = new MemoryStore();
  } else {
    return null;
  }
  return globalThis.__lionsStore;
}
