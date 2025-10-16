
const CACHE_NAME = "controle-sementes-v1";
const ASSETS = ["/","/index.html","/styles.css","/script.js","/manifest.json"];
self.addEventListener("install",(e)=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",(e)=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))))});
self.addEventListener("fetch",(e)=>{e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{if(e.request.method==="GET"&&r.ok){const x=r.clone();caches.open(CACHE_NAME).then(C=>C.put(e.request,x));}return r;}).catch(()=>caches.match("/"))))});
