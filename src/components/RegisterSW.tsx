"use client";
import { useEffect } from "react";

/**
 * Service worker yalnızca üretimde kaydedilir. Kayıttan sonra, sayfanın o ana kadar yüklediği
 * statik dosyalar (JS/CSS) önbelleğe eklenir → ilk ziyaretten sonra bağlantı kopsa da oyun açılır.
 */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    const warm = async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const urls = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((n) => n.startsWith(location.origin) && (n.includes("/_next/static/") || n.includes("/assets/")));
        reg.active?.postMessage({ type: "CACHE_URLS", urls });
      } catch {
        /* yoksay */
      }
    };
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => {
          void warm();
          setTimeout(warm, 4000);
        })
        .catch(() => {});
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
