/*
  Mnemonic Solidifier - Service Worker v3
  Designed for GitHub Pages + offline WAV playback, including Safari/iOS
  byte-range media requests.
*/

const CACHE_NAME = "mnemonic-solidifier-v3";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",

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

function absoluteURL(path) {
  return new URL(path, self.registration.scope).href;
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Cache files individually so one problem file doesn't prevent
    // the service worker from installing.
    for (const file of FILES_TO_CACHE) {
      try {
        const url = absoluteURL(file);
        const response = await fetch(url, { cache: "reload" });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        await cache.put(url, response);
      } catch (error) {
        console.warn("Could not pre-cache:", file, error);
      }
    }

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();

    await Promise.all(
      names
        .filter(name => name !== CACHE_NAME)
        .map(name => caches.delete(name))
    );

    await self.clients.claim();
  })());
});

/*
  Safari/iOS and other browsers can request media with:
      Range: bytes=0-...
  A normal cached 200 response is not always enough for offline media.
  This function returns the requested slice as HTTP 206 Partial Content.
*/
async function createRangeResponse(request, cachedResponse) {
  const rangeHeader = request.headers.get("range");

  if (!rangeHeader) {
    return cachedResponse;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());

  if (!match) {
    return cachedResponse;
  }

  const buffer = await cachedResponse.arrayBuffer();
  const total = buffer.byteLength;

  let start;
  let end;

  if (match[1] === "" && match[2] !== "") {
    // Suffix request, e.g. bytes=-500
    const suffixLength = Number(match[2]);
    start = Math.max(total - suffixLength, 0);
    end = total - 1;
  } else {
    start = match[1] === "" ? 0 : Number(match[1]);
    end = match[2] === "" ? total - 1 : Number(match[2]);
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= total
  ) {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${total}`
      }
    });
  }

  end = Math.min(end, total - 1);

  const sliced = buffer.slice(start, end + 1);

  const headers = new Headers(cachedResponse.headers);
  headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
  headers.set("Content-Length", String(sliced.byteLength));
  headers.set("Accept-Ranges", "bytes");

  return new Response(sliced, {
    status: 206,
    statusText: "Partial Content",
    headers
  });
}

async function cachedResponseFor(request) {
  const cache = await caches.open(CACHE_NAME);

  // Match by URL, rather than by the full Range request.
  return cache.match(request.url, {
    ignoreSearch: false,
    ignoreVary: true
  });
}

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  event.respondWith((async () => {
    const cached = await cachedResponseFor(request);

    if (cached) {
      // Important for offline WAV/audio playback on browsers using byte ranges.
      if (request.headers.has("range")) {
        return createRangeResponse(request, cached);
      }

      return cached;
    }

    try {
      const networkResponse = await fetch(request);

      // Store successful full responses for later offline use.
      if (
        networkResponse &&
        networkResponse.ok &&
        !request.headers.has("range")
      ) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request.url, networkResponse.clone());
      }

      return networkResponse;
    } catch (error) {
      // Offline navigation fallback.
      if (request.mode === "navigate") {
        const cache = await caches.open(CACHE_NAME);
        const fallback =
          await cache.match(absoluteURL("./index.html")) ||
          await cache.match(absoluteURL("./"));

        if (fallback) {
          return fallback;
        }
      }

      return new Response("Offline resource unavailable.", {
        status: 503,
        statusText: "Offline"
      });
    }
  })());
});
