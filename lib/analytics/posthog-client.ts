import type { PostHog, Properties } from "posthog-js";

/**
 * PostHog, loaded lazily.
 *
 * `posthog-js` is ~240 KB of JavaScript before compression. Initialising it
 * synchronously from `instrumentation-client.ts`, and importing it directly
 * from the components that capture events, put all of that in the first load
 * of every page — ahead of the storefront's own code. Here the library is
 * fetched once the browser is idle (or the first time something is captured,
 * whichever comes first); anything captured before it arrives is queued and
 * replayed in order, so no event or identify is lost. The initial `$pageview`
 * is captured by `init()` itself against the same URL, and history-change
 * pageviews are patched in at that point as before.
 *
 * Components must not import `posthog-js` directly — use `posthogClient`.
 */

type Queued =
  | { kind: "capture"; event: string; properties?: Properties }
  | { kind: "identify"; distinctId: string; properties?: Properties }
  | { kind: "reset" };

let instance: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;
const queue: Queued[] = [];

/**
 * The address of a page can carry a credential: a password-reset or invite
 * link's `token`, a checkout recovery link's `recover`, an unsubscribe link's
 * path. Pageviews recorded them — in the page, the referrer and the session's
 * entry URL — so anyone who could read the analytics could use them.
 */
const SECRET_QUERY = /([?&](?:token|recover)=)[^&#\s]*/gi;
const SECRET_PATH = /(\/unsubscribe\/)[^/?#\s]+/gi;

export function withoutSecrets(value: string): string {
  return value
    .replace(SECRET_QUERY, "$1[redacted]")
    .replace(SECRET_PATH, "$1[redacted]");
}

/** Every string an event carries, and those its `$set` / `$set_once` carry. */
function scrubEvent<T extends { properties?: Properties; $set?: Properties; $set_once?: Properties }>(
  event: T,
): T {
  for (const bag of [event.properties, event.$set, event.$set_once]) {
    if (!bag) continue;
    for (const [key, value] of Object.entries(bag)) {
      if (typeof value === "string") bag[key] = withoutSecrets(value);
    }
    for (const nested of [bag.$set, bag.$set_once]) {
      if (!nested || typeof nested !== "object") continue;
      for (const [key, value] of Object.entries(nested as Properties)) {
        if (typeof value === "string") (nested as Properties)[key] = withoutSecrets(value);
      }
    }
  }
  return event;
}

function replay(posthog: PostHog) {
  for (const item of queue.splice(0)) {
    if (item.kind === "capture") posthog.capture(item.event, item.properties);
    else if (item.kind === "identify")
      posthog.identify(item.distinctId, item.properties);
    else posthog.reset();
  }
}

export function loadPostHog(): Promise<PostHog | null> {
  if (instance) return Promise.resolve(instance);
  if (loading) return loading;
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (typeof window === "undefined" || !token) {
    queue.length = 0;
    return Promise.resolve(null);
  }

  loading = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(token, {
        api_host: "/ingest",
        ui_host: "https://us.posthog.com",
        defaults: "2026-01-30",
        capture_exceptions: true,
        // Real-user Core Web Vitals (LCP, CLS, INP, FCP) per page — the only
        // signal that ranks performance work by what shoppers actually feel.
        // The library is loaded late on purpose, but the observers it installs
        // are buffered, so the LCP/FCP of the initial paint still get reported.
        capture_performance: { web_vitals: true },
        debug: process.env.NODE_ENV === "development",
        // Exception autocapture assigns window.onunhandledrejection directly
        // and ignores preventDefault, so filter the same abort noise out here
        // that instrumentation-client.ts silences for the console — otherwise
        // every visitor with a fetch-wrapping extension floods error tracking
        // with AbortError teardown rejections.
        before_send: (event) => {
          if (!event) return event;
          scrubEvent(event);
          if (event.event !== "$exception") return event;
          const exceptions = (event.properties?.$exception_list ?? []) as Array<{
            type?: string;
          }>;
          const onlyAborts =
            exceptions.length > 0 &&
            exceptions.every((exception) => exception.type === "AbortError");
          return onlyAborts ? null : event;
        },
      });
      instance = posthog;
      replay(posthog);
      return posthog;
    })
    .catch((error: unknown) => {
      console.error("PostHog failed to load:", error);
      loading = null;
      return null;
    });
  return loading;
}

export const posthogClient = {
  capture(event: string, properties?: Properties) {
    if (instance) {
      instance.capture(event, properties);
      return;
    }
    queue.push({ kind: "capture", event, properties });
    void loadPostHog();
  },
  identify(distinctId: string, properties?: Properties) {
    if (instance) {
      instance.identify(distinctId, properties);
      return;
    }
    queue.push({ kind: "identify", distinctId, properties });
    void loadPostHog();
  },
  reset() {
    if (instance) {
      instance.reset();
      return;
    }
    queue.push({ kind: "reset" });
  },
};
