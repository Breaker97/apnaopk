import { loadPostHog } from "@/lib/analytics/posthog-client";
import { isSectionPreviewPath } from "@/lib/storefront/pages/section-preview-path";

// Aborted fetches are intentional teardown (effect cleanup, superseded
// searches, navigation), not failures. Some browser extensions branch
// `window.fetch` promises without attaching a rejection handler, so those
// aborts resurface as unhandled AbortError rejections outside our code.
// Mark them handled to keep the console clean.
//
// `stopImmediatePropagation` is load-bearing, not belt-and-braces. Next's dev
// overlay registers its own `unhandledrejection` listener and never consults
// `defaultPrevented`, so `preventDefault` alone silenced the browser console
// while the same abort kept being forwarded to the dev terminal as
// "⨯ unhandledRejection: AbortError: signal is aborted without reason",
// pointing at whichever effect cleanup happened to call `abort()`. This file is
// required before the overlay installs its handler, so stopping propagation
// here reaches it; ordering is what makes that true, so keep this listener at
// the very top of the module.
window.addEventListener("unhandledrejection", (event) => {
  const reason: unknown = event.reason;
  if (
    reason instanceof Error &&
    reason.name === "AbortError"
  ) {
    event.stopImmediatePropagation();
    event.preventDefault();
  }
});

// PostHog is fetched once the browser is idle rather than bundled into every
// page's first load (~240 KB of JS). Events captured before it arrives are
// queued and replayed — see lib/analytics/posthog-client.ts.
const startPostHog = () => {
  void loadPostHog();
};
// The builder's section preview frames are admin scaffolding, reloaded after
// every autosave; each one used to count as a storefront pageview.
if (!isSectionPreviewPath(window.location.pathname)) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(startPostHog, { timeout: 3000 });
  } else {
    window.setTimeout(startPostHog, 1500);
  }
}
