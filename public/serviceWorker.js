
const CACHE = "sem-realtime-v2";
const STATIC = [
  "/",
  "/styles.css?v=1.5.1",
  "/script.js?v=1.5.1",
  "/manifest.json?v=1.5.1",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Sempre rede online para API e navegação (evita UI velha)
  const isAPI = url.pathname.startsWith("/api/");
  const isDoc = event.request.mode === "navigate" || event.request.destination === "document";
  if (isAPI || isDoc) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request, {ignoreSearch:true}))
    );
    return;
  }

  // Para CSS/JS/Ícones: stale-while-revalidate
  if (["style","script","image","font"].includes(event.request.destination)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(networkRes => {
          if (networkRes && networkRes.ok) {
            const copy = networkRes.clone();
            caches.open(CACHE).then(c => c.put(event.request, copy));
          }
          return networkRes;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // default
  event.respondWith(fetch(event.request).catch(() => caches.match("/")));
});
