const CACHE_PREFIX = "storify-pwa-";
// Prefixes shipped by earlier versions, cleaned up on activate. Keep in sync
// with LEGACY_PWA_CACHE_PREFIXES in lib/pwa.ts.
const LEGACY_CACHE_PREFIXES = ["marketify-pwa-"];
const STATIC_CACHE = `${CACHE_PREFIX}v5-static`;

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
            .filter((key) => isAppCacheKey(key) && key !== STATIC_CACHE)
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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!isCacheableSameOriginGet(request)) return;

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    const isPos = POS_PATH_PATTERN.test(url.pathname);

    event.respondWith(
      fetch(request)
        .then((response) => {
          if (isPos) {
            // Only a real, successful render is worth keeping: a redirect to
            // the login page or a 403 would otherwise become the "offline
            // register" and lock the counter out for good.
            if (response.ok && response.type === "basic" && !response.redirected) {
              const copy = response.clone();
              caches
                .open(STATIC_CACHE)
                .then((cache) => cache.put(posShellKey(url.pathname), copy))
                .catch(() => undefined);
            }
            return response;
          }

          if (isStorableFallback(request, response)) {
            const copy = response.clone();
            caches
              .open(STATIC_CACHE)
              .then((cache) => cache.put(OFFLINE_FALLBACK_KEY, copy))
              .catch(() => undefined);
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

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
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
