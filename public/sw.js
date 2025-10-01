const CACHE = "fixitbot-v1";
const ASSETS = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : null)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  e.respondWith(
    (async () => {
      try {
        const net = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put(request, net.clone());
        return net;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        // fallback a home si es navegación
        if (request.mode === "navigate") return caches.match("/");
        throw new Error("Offline sin caché");
      }
    })()
  );
});
