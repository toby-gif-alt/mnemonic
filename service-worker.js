/*
  Mnemonic Solidifier - Service Worker v6

  Behaviour:
  - App files are available offline.
  - WAV files are NETWORK-FIRST:
      * Online: fetch the newest WAV from GitHub and replace the cached copy.
      * Offline: use the cached WAV.
  - Handles Safari/iOS byte-range audio requests.
  - You do NOT need to bump the cache version just because you replace a WAV.
*/

const CACHE_NAME = "mnemonic-solidifier-v6";

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

function isWavRequest(request) {
  try {
    const url = new URL(request.url);
    return url.pathname.toLowerCase().endsWith(".wav");
  } catch {
    return false;
  }
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

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

async function createRangeResponse(request, fullResponse) {
  const rangeHeader = request.headers.get("range");

  if (!rangeHeader) {
    return fullResponse;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());

  if (!match) {
    return fullResponse;
  }

  const buffer = await fullResponse.arrayBuffer();
  const total = buffer.byteLength;

  let start;
  let end;

  if (match[1] === "" && match[2] !== "") {
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
  const headers = new Headers(fullResponse.headers);

  headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
  headers.set("Content-Length", String(sliced.byteLength));
  headers.set("Accept-Ranges", "bytes");

  return new Response(sliced, {
    status: 206,
    statusText: "Partial Content",
    headers
  });
}

async function handleWavRequest(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const freshResponse = await fetch(request.url, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin"
    });

    if (!freshResponse.ok) {
      throw new Error(`HTTP ${freshResponse.status}`);
    }

    await cache.put(request.url, freshResponse.clone());

    if (request.headers.has("range")) {
      return createRangeResponse(request, freshResponse);
    }

    return freshResponse;

  } catch (error) {
    const cachedResponse = await cache.match(request.url, {
      ignoreSearch: false,
      ignoreVary: true
    });

    if (cachedResponse) {
      if (request.headers.has("range")) {
        return createRangeResponse(request, cachedResponse);
      }

      return cachedResponse;
    }

    return new Response("Audio unavailable offline.", {
      status: 503,
      statusText: "Offline"
    });
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  if (isWavRequest(request)) {
    event.respondWith(handleWavRequest(request));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    const cached = await cache.match(request.url, {
      ignoreSearch: false,
      ignoreVary: true
    });

    if (cached) {
      return cached;
    }

    try {
      const response = await fetch(request);

      if (response && response.ok) {
        await cache.put(request.url, response.clone());
      }

      return response;

    } catch (error) {
      if (request.mode === "navigate") {
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
