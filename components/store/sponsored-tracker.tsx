"use client";

/**
 * Client half of sponsored-placement tracking, consumed by ModernProductCard
 * via useSponsoredTracking so every surface that renders a sponsored card
 * (home carousel, listing grid, PDP carousel) reports without per-surface
 * wiring.
 *
 * Impressions: IntersectionObserver at ≥50% visibility sustained for 1s,
 * once per (campaign, placement, UTC day) per browser session, batched into one
 * beacon every few seconds and on pagehide. Clicks: immediate sendBeacon
 * (it survives the navigation). Counts are aggregated server-side.
 */

import { useEffect, type RefObject } from "react";
import { usePathname } from "next/navigation";

import { utcDay } from "@/lib/boosts/boost-days";

type SponsoredPlacement = "home" | "listing" | "pdp";

type QueuedEvent = { c: string; p: SponsoredPlacement; t: "imp" | "clk" };

const ENDPOINT = "/api/track/sponsored";
const FLUSH_INTERVAL_MS = 5000;
const DWELL_MS = 1000;
const MAX_BATCH = 50;

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pagehideBound = false;

function send(events: QueuedEvent[]) {
  if (events.length === 0) return;
  const body = JSON.stringify({ events });
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
  } catch {
    // Fall through to fetch.
  }
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

function flushQueue() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  send(batch);
  if (queue.length > 0) scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushQueue, FLUSH_INTERVAL_MS);
  if (!pagehideBound && typeof window !== "undefined") {
    pagehideBound = true;
    window.addEventListener("pagehide", flushQueue);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushQueue();
    });
  }
}

/**
 * Impressions dedupe per session — but scoped to the UTC day, the same axis the
 * daily buckets are keyed on. Without the day, a browser session left open
 * across midnight silently stops counting the second day of a multi-day
 * booking: the vendor is charged for it and the report shows zero.
 */
function sessionSeenKey(campaignId: string, placement: SponsoredPlacement) {
  return `boostimp:${utcDay()}:${campaignId}:${placement}`;
}

function queueSponsoredImpression(
  campaignId: string,
  placement: SponsoredPlacement,
) {
  try {
    const key = sessionSeenKey(campaignId, placement);
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    // Private mode without sessionStorage: count at most once per page.
  }
  queue.push({ c: campaignId, p: placement, t: "imp" });
  scheduleFlush();
}

/**
 * Clicks already counted this pageview. Impressions are deduped per session in
 * sessionStorage; clicks are deduped per PAGE, keyed by pathname. Client-side
 * navigation never reloads the module, so a key without the path would let one
 * click on a listing suppress a genuine later click on another page for the
 * rest of the session. Keying by path keeps that second click while still
 * preventing the same card counting twice from one visit — which is what pushes
 * CTR above 100%.
 */
const clickedPerPath = new Set<string>();

function sendSponsoredClick(
  campaignId: string,
  placement: SponsoredPlacement,
  pathname: string | null,
) {
  const key = `${pathname ?? ""}:${campaignId}:${placement}`;
  if (clickedPerPath.has(key)) return;
  clickedPerPath.add(key);
  // Clicks bypass the queue — the navigation is about to tear the page down.
  send([{ c: campaignId, p: placement, t: "clk" }]);
}

/** Placement from the current URL: home page, product detail, or a listing. */
function placementFromPathname(
  pathname: string | null,
): SponsoredPlacement {
  if (!pathname) return "listing";
  const segments = pathname.split("/").filter(Boolean);
  // "/{locale}" → home
  if (segments.length <= 1) return "home";
  // "/{locale}/products/{slug}" → product page; "/{locale}/products" → listing
  if (segments[1] === "products" && segments.length >= 3) return "pdp";
  return "listing";
}

/**
 * Attach impression + click tracking to a sponsored card's root element.
 * No-ops for organic cards (no campaign id).
 */
export function useSponsoredTracking(
  ref: RefObject<HTMLElement | null>,
  campaignId: string | undefined,
) {
  const pathname = usePathname();

  useEffect(() => {
    const element = ref.current;
    if (!campaignId || !element) return;
    const placement = placementFromPathname(pathname);

    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            dwellTimer = setTimeout(() => {
              queueSponsoredImpression(campaignId, placement);
              observer.disconnect();
            }, DWELL_MS);
          } else if (dwellTimer) {
            clearTimeout(dwellTimer);
            dwellTimer = null;
          }
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(element);

    // Only a click that actually opens the ad counts. The listener is on the
    // card root in the CAPTURE phase — it runs before the child handlers, so
    // their stopPropagation() cannot suppress it — and every control on the
    // card (wishlist, add-to-cart, quick view) lives INSIDE that root. Without
    // this filter a shopper toggling the wishlist twice recorded two ad clicks
    // against one impression.
    const handleClick = (event: Event) => {
      const target = event.target as Element | null;
      if (
        target?.closest(
          'button, [role="button"], input, select, textarea, label, [data-no-sponsored-click]',
        )
      ) {
        return;
      }
      sendSponsoredClick(campaignId, placement, pathname);
    };
    element.addEventListener("click", handleClick, { capture: true });

    return () => {
      observer.disconnect();
      if (dwellTimer) clearTimeout(dwellTimer);
      element.removeEventListener("click", handleClick, { capture: true });
    };
  }, [ref, campaignId, pathname]);
}
