const CACHE_NAME = "mnemonic-solidifier-v2";

const CORE_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

const AUDIO_FILES = [
  "./A.wav",
  "./B.wav",
  "./Bb.wav",
  "./C.wav",
  "./D.wav",
  "./Db.wav",
  "./E.wav",
  "./Eb.wav",
  "./F.wav",
  "./Fs.wav",
  "./G.wav",
  "./Gs.wav"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    await cache.addAll(CORE_FILES);

    for (const file of AUDIO_FILES) {
      try {
        await cache.add(file);
      } catch (error) {
        console.warn("Could not cache:", file, error);
      }
    }

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();

    await Promise.all(
      cacheNames
        .filter(name => name !== CACHE_NAME)
        .map(name => caches.delete(name))
    );

    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  event.respondWith((async () => {
    const cachedResponse = await caches.match(event.request);

    if (cachedResponse) {
      return cachedResponse;
    }

    try {
      const networkResponse = await fetch(event.request);

      if (networkResponse && networkResponse.status === 200) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, networkResponse.clone());
      }

      return networkResponse;
    } catch (error) {
      if (event.request.mode === "navigate") {
        const fallback = await caches.match("./index.html");
        if (fallback) return fallback;
      }

      throw error;
    }
  })());
});
