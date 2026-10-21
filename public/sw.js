const CACHE_PREFIX = "storify-pwa-";
// Prefixes shipped by earlier versions, cleaned up on activate. Keep in sync
// with LEGACY_PWA_CACHE_PREFIXES in lib/pwa.ts.
const LEGACY_CACHE_PREFIXES = ["marketify-pwa-"];
const STATIC_CACHE = `${CACHE_PREFIX}v5-static`;

/**
 * Product pictures for the register, kept so the till's grid still shows them
 * with the connection down — a cashier picks the right product by its photo.
 *
 * Only images a register page asks for are kept (the request's referrer is a
 * POS page: same-origin requests carry the full page URL under the site's
 * `strict-origin-when-cross-origin` policy), only same-origin answers — the
 * image optimizer's — because an opaque cross-origin one cannot be stamped,
 * and only up to `POS_IMAGE_LIMIT`, the least recently stored going first.
 * The till warms this after each snapshot pull (lib/pos/offline-images.ts).
 */
const POS_IMAGE_CACHE = `${CACHE_PREFIX}v1-pos-images`;
const POS_IMAGE_LIMIT = 600;
const POS_IMAGE_TRIM_EVERY_MS = 60 * 1000;
let posImagesTrimmedAt = 0;

// The one document kept for offline navigations. Stored under a key of its own
// so it can never be confused with a live page response.
const OFFLINE_FALLBACK_KEY = "/__offline-fallback";

// Signed-in surfaces whose rendered HTML must never be kept on disk and handed
// to whoever opens the app next on a shared device. The optional leading
// segment absorbs the locale prefix ("/bn/admin/orders").
//
// `staff` was missing here: it is a full signed-in root alongside admin and
// vendor, so a staff page could become the generic offline fallback and be
// served to the next person who opened the app with no network.
const PRIVATE_PATH_PATTERN =
  /^\/(?:[a-z]{2}\/)?(?:admin|vendor|staff|account|profile|checkout|cart|orders|login|register|forgot-password|reset-password)(?:\/|$)/;

/**
 * The register, which is the one signed-in page that is cached on purpose.
 *
 * A till has to open when the shop's connection is down — that is the entire
 * point of offline POS — and it cannot, because the page is server-rendered
 * behind an auth check that needs a server. So its document is kept, under a
 * key of its own so it can never be confused with the generic fallback that
 * `PRIVATE_PATH_PATTERN` guards.
 *
 * What this does and does not protect against, stated plainly: it does NOT
 * stop someone holding the device from seeing the terminal — the shop's own
 * catalogue on the shop's own till is the intended use. What bounds it is the
 * app's offline session window (`lib/pos/offline-session.ts`), which locks the
 * terminal once too long has passed since the server last authenticated it,
 * and the fact that a queued sale can only ever reach the server with a valid
 * session: a revoked one gets a 401 and every sale rung up on a stolen tablet
 * is refused.
 *
 * Cached per exact path, because an admin register, a vendor register and a
 * staff register are three different documents.
 */
const POS_PATH_PATTERN = /^\/(?:[a-z]{2}\/)?(?:admin|vendor|staff)\/pos(?:\/|$)/;

function posShellKey(pathname) {
  return `/__pos-shell${pathname}`;
}

/**
 * Keeping the runtime cache from growing forever.
 *
 * Build assets are content-hashed, so every deploy adds a new set and nothing
 * ever replaced the old ones: a till on a store that deploys often carried
 * every bundle it had ever loaded. The cache name cannot carry the build (this
 * file is static and does not change per deploy), and evicting the oldest
 * entries first is unsafe — a bundle the current build still uses may well be
 * the oldest one stored, and losing it is a till that renders and cannot sell.
 *
 * So entries are evicted by disuse instead. Each one is stamped when stored,
 * and stamped again when it is served from the cache (at most once a day per
 * entry, to keep writes off the hot path). Once a day, after a page has loaded
 * from the network — the one moment anything still needed is about to be
 * fetched again anyway — entries unused for `CACHE_MAX_IDLE_MS` are deleted.
 * The POS shell is stamped only when it is rendered online, so a shell that
 * old is one the offline session window would lock in any case.
 *
 * Entries stored before stamping existed get a stamp on the first sweep rather
 * than being deleted: a till must not lose its offline shell to an upgrade.
 */
const STAMP_HEADER = "x-storify-cached-at";
const CACHE_MAX_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
const RESTAMP_AFTER_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;
const SWEEP_MARKER_KEY = "/__cache-swept-at";

/**
 * Cache keys requested in the last few minutes, by absolute URL, with when.
 *
 * The sweep reads an entry's stamp and then deletes it; a page fetching that
 * same asset in between would have it deleted from under it. Checking this map
 * in the same tick as the delete closes that gap: a request records its key
 * before its first await, so either the sweep sees it and keeps the entry, or
 * the request's own cache operations are issued after the delete.
 *
 * Time-bounded rather than kept for the worker's life: a worker the browser
 * keeps alive would otherwise shield every entry it had ever served.
 */
const touchedAt = new Map();
const TOUCH_GUARD_MS = 5 * 60 * 1000;

function touch(key) {
  touchedAt.set(key, Date.now());
}

function inUse(key, now) {
  const at = touchedAt.get(key);
  return at !== undefined && now - at < TOUCH_GUARD_MS;
}

function absoluteKey(key) {
  return new URL(typeof key === "string" ? key : key.url, self.location.origin)
    .href;
}

function stampOf(response) {
  const value = Number(response?.headers.get(STAMP_HEADER));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** A copy of `response` carrying the time it was stored. */
function stamped(response, now = Date.now()) {
  const headers = new Headers(response.headers);
  headers.set(STAMP_HEADER, String(now));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function sweepCache(now = Date.now()) {
  const cache = await caches.open(STATIC_CACHE);

  const marker = await cache.match(SWEEP_MARKER_KEY);
  const lastSweep = marker ? Number(await marker.text()) : 0;
  if (Number.isFinite(lastSweep) && now - lastSweep < SWEEP_EVERY_MS) return;
  await cache.put(SWEEP_MARKER_KEY, new Response(String(now)));

  const keep = new Set([
    absoluteKey(OFFLINE_FALLBACK_KEY),
    absoluteKey(SWEEP_MARKER_KEY),
  ]);
  const cutoff = now - CACHE_MAX_IDLE_MS;

  for (const [key, at] of touchedAt) {
    if (now - at >= TOUCH_GUARD_MS) touchedAt.delete(key);
  }

  for (const request of await cache.keys()) {
    const key = absoluteKey(request);
    if (keep.has(key)) continue;

    const response = await cache.match(request);
    if (!response) continue;

    const at = stampOf(response);
    if (!at) {
      // Stored before stamping existed. Given a full idle period from now.
      if (!inUse(key, now)) await cache.put(request, stamped(response, now));
      continue;
    }
    // The check and the delete in one tick — see `touchedAt`.
    if (at < cutoff && !inUse(key, now)) await cache.delete(request);
  }
}

function isAppCacheKey(key) {
  return (
    key.startsWith(CACHE_PREFIX) ||
    LEGACY_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

self.addEventListener("install", () => {
  // Nothing is precached: app icons are rendered from store settings and every
  // document is personalized, so there is no static asset worth shipping ahead
  // of the first visit.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                isAppCacheKey(key) &&
                key !== STATIC_CACHE &&
                key !== POS_IMAGE_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isCacheableSameOriginGet(request) {
  if (request.method !== "GET") return false;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  // Build assets under /_next/static are content-hashed and immutable, and the
  // register needs them: a cached POS document whose scripts 404 renders a
  // picture of a till that cannot take a sale. Everything else under /_next/
  // (the image optimizer, RSC payloads) is dynamic and stays uncached.
  if (
    url.pathname.startsWith("/_next/") &&
    !url.pathname.startsWith("/_next/static/")
  ) {
    return false;
  }
  if (url.pathname === "/sw.js") return false;
  // Resolved from settings on every request (it redirects to the configured
  // favicon), so caching it first-hand would pin an old icon after a change.
  if (url.pathname === "/favicon.ico") return false;

  return true;
}

/**
 * Whether a navigation response may be kept as the offline fallback.
 *
 * `ok` drops maintenance (503) and not-found pages, which would otherwise
 * become a permanent offline page. `redirected` responses are excluded because
 * the Cache API hands them back unchanged and a navigation may not be answered
 * with a redirected response — the locale redirect on "/" hits this.
 */
function isStorableFallback(request, response) {
  return (
    response.ok &&
    response.type === "basic" &&
    !response.redirected &&
    !PRIVATE_PATH_PATTERN.test(new URL(request.url).pathname)
  );
}

function isPosImageRequest(request) {
  if (request.method !== "GET" || request.destination !== "image") return false;
  try {
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return false;
    const referrer = request.referrer ? new URL(request.referrer) : null;
    return Boolean(
      referrer &&
        referrer.origin === self.location.origin &&
        POS_PATH_PATTERN.test(referrer.pathname),
    );
  } catch {
    return false;
  }
}

/** Keep the register's picture cache to `POS_IMAGE_LIMIT`, oldest stored first. */
async function trimPosImages(now = Date.now()) {
  if (now - posImagesTrimmedAt < POS_IMAGE_TRIM_EVERY_MS) return;
  posImagesTrimmedAt = now;
  const cache = await caches.open(POS_IMAGE_CACHE);
  const keys = await cache.keys();
  if (keys.length <= POS_IMAGE_LIMIT) return;
  const dated = await Promise.all(
    keys.map(async (request) => ({ request, at: stampOf(await cache.match(request)) })),
  );
  dated.sort((a, b) => a.at - b.at);
  for (const { request } of dated.slice(0, dated.length - POS_IMAGE_LIMIT)) {
    await cache.delete(request);
  }
}

/**
 * Cache first: a product picture's URL changes when the picture does, so a
 * stored one is never stale. With nothing stored and no network, the image
 * fails as it would have, and the tile shows its placeholder.
 */
async function posImageResponse(event, request) {
  const cache = await caches.open(POS_IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const copy = stamped(response.clone());
    event.waitUntil(
      cache
        .put(request, copy)
        .then(() => trimPosImages())
        .catch(() => undefined),
    );
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (isPosImageRequest(request)) {
    event.respondWith(posImageResponse(event, request));
    return;
  }
  if (!isCacheableSameOriginGet(request)) return;

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    const isPos = POS_PATH_PATTERN.test(url.pathname);

    event.respondWith(
      fetch(request)
        .then((response) => {
          let stored = Promise.resolve();

          if (isPos) {
            // Only a real, successful render is worth keeping: a redirect to
            // the login page or a 403 would otherwise become the "offline
            // register" and lock the counter out for good.
            if (response.ok && response.type === "basic" && !response.redirected) {
              const shellKey = posShellKey(url.pathname);
              touch(absoluteKey(shellKey));
              const copy = stamped(response.clone());
              stored = caches
                .open(STATIC_CACHE)
                .then((cache) => cache.put(shellKey, copy))
                .catch(() => undefined);
            }
          } else if (isStorableFallback(request, response)) {
            const copy = response.clone();
            stored = caches
              .open(STATIC_CACHE)
              .then((cache) => cache.put(OFFLINE_FALLBACK_KEY, copy))
              .catch(() => undefined);
          }

          // A page just loaded from the network, so whatever it needs is about
          // to be fetched and stamped again: the one safe moment to drop what
          // nothing has used for weeks. At most once a day (`sweepCache`).
          if (response.ok) {
            event.waitUntil(
              stored.then(() => sweepCache()).catch(() => undefined),
            );
          }
          return response;
        })
        .catch(async () => {
          // The register falls back to its own document, never to the generic
          // one — a cashier who reloads mid-shift must get the terminal back,
          // not a storefront page.
          const cached = await caches.match(
            isPos ? posShellKey(url.pathname) : OFFLINE_FALLBACK_KEY,
          );
          return (
            cached ||
            new Response("You are offline. Please reconnect and try again.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
          );
        }),
    );
    return;
  }

  const isStaticAsset =
    /\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?)$/i.test(url.pathname) ||
    // Hashed build output: the filename changes whenever the content does, so
    // serving it from cache can never pin a stale bundle.
    url.pathname.startsWith("/_next/static/");

  if (!isStaticAsset) return;

  // Before the first await — see `touchedAt`.
  touch(absoluteKey(request));

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Still in use: keep it from being swept. Once a day at most.
        if (Date.now() - stampOf(cached) > RESTAMP_AFTER_MS) {
          const copy = stamped(cached.clone());
          event.waitUntil(
            caches
              .open(STATIC_CACHE)
              .then((cache) => cache.put(request, copy))
              .catch(() => undefined),
          );
        }
        return cached;
      }

      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = stamped(response.clone());
          caches
            .open(STATIC_CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => undefined);
        }
        return response;
      });
    }),
  );
});

function parsePushPayload(event) {
  if (!event.data) return {};

  try {
    return event.data.json();
  } catch {
    return {
      title: "Notification",
      body: event.data.text(),
    };
  }
}

/**
 * Tell every open tab a push landed, so live surfaces can refetch at once.
 *
 * The notification surfaces poll on a slow timer (see
 * `hooks/use-live-resource.ts`); this is what keeps that timer from being the
 * only path for something the server already knows about. Receiving this is
 * also the proof that push actually reaches this device, which is what lets
 * the hook step its interval down — an active subscription on its own only
 * says the browser accepted one, not that deliveries arrive.
 *
 * The push body is NOT forwarded as trusted data: tabs use it as a signal to
 * refetch through the authenticated API, so a tab never renders anything it
 * did not fetch for itself.
 */
async function notifyClientsOfPush(payload) {
  try {
    const windowClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    for (const client of windowClients) {
      client.postMessage({
        source: "storify",
        type: "push-received",
        notificationId: payload.notificationId,
      });
    }
  } catch {
    // Best effort: the slow interval still picks the change up.
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  const title = payload.title || "Notification";
  const options = {
    body: payload.body || "",
    // Sent by the server from the store's favicon; omitted when unset so the
    // browser falls back to its own default instead of this app's branding.
    icon: payload.icon || undefined,
    badge: payload.badge || undefined,
    tag: payload.tag || payload.notificationId || undefined,
    renotify: Boolean(payload.tag || payload.notificationId),
    data: {
      url: payload.url || "/",
      notificationId: payload.notificationId,
    },
    actions: [
      { action: "open", title: "Open" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      notifyClientsOfPush(payload),
    ]),
  );
});

async function markNotificationRead(notificationId) {
  if (!notificationId) return;

  try {
    await fetch("/api/notifications", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [notificationId], action: "read" }),
    });
  } catch {
    // Best effort only; the app will reconcile state when it opens.
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin);
  const notificationId = event.notification.data?.notificationId;

  event.waitUntil(
    (async () => {
      await markNotificationRead(notificationId);
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windowClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === targetUrl.origin && "focus" in client) {
          if ("navigate" in client) await client.navigate(targetUrl.href);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl.href);
      }
    })(),
  );
});
