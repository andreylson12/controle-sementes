const CACHE_NAME = "controle-sementes-v1";
const ASSETS = ["/","/index.html","/styles.css","/script.js","/manifest.json"];

self.addEventListener("install",(e)=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));
});

self.addEventListener("activate",(e)=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));
});

self.addEventListener("fetch",(e)=>{
  e.respondWith(
    caches.match(e.request).then(cached=>{
      return cached || fetch(e.request).then(resp=>{
        if (e.request.method==="GET" && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c=>c.put(e.request, clone));
        }
        return resp;
      }).catch(()=>caches.match("/"));
    })
  );
});
