/* Diş Kahramanı – service worker
 * Amaç: oyun bir kez yüklendikten sonra internet kopsa da çalışsın.
 * - /_next/static ve /assets: önce önbellek (dosya adları içerik hash'li, güvenli)
 * - Sayfa gezintileri (/oyun, /gizlilik): önce ağ (3 sn zaman aşımı), olmazsa önbellek
 * - /api, /admin, /qr: asla önbelleğe alınmaz (analytics kuyruğu istemcide yönetilir)
 */
const VERSION = "v1";
const STATIC_CACHE = "lions-static-" + VERSION;
const PAGE_CACHE = "lions-pages-" + VERSION;
const PRECACHE = ["/oyun", "/gizlilik", "/ses-testi", "/manifest.webmanifest", "/icon.svg", "/assets/lions-logo.png"];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGE_CACHE);
      await Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, PAGE_CACHE]);
      for (const k of await caches.keys()) if (k.startsWith("lions-") && !keep.has(k)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/assets/") || url.pathname === "/icon.svg";
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "CACHE_URLS" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      for (const u of data.urls) {
        try {
          const url = new URL(u, self.location.origin);
          if (url.origin !== self.location.origin || !isStaticAsset(url)) continue;
          if (await cache.match(url.pathname + url.search)) continue;
          await cache.add(url.pathname + url.search);
        } catch (_) {
          /* yoksay */
        }
      }
    })(),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin") || url.pathname === "/qr") return;

  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGE_CACHE);
        const key = url.pathname === "/" ? "/oyun" : url.pathname;
        try {
          const res = await withTimeout(fetch(req), NETWORK_TIMEOUT_MS);
          if (res.ok && res.type === "basic" && !res.redirected && (key === "/oyun" || key === "/gizlilik" || key === "/ses-testi")) {
            cache.put(key, res.clone());
          }
          return res;
        } catch (_) {
          const hit = (await cache.match(key)) || (await cache.match("/oyun"));
          if (hit) return hit;
          return new Response("Çevrimdışı. Lütfen bağlantını kontrol edip tekrar dene.", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
      })(),
    );
  }
});
