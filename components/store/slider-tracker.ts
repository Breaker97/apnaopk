"use client";

/**
 * Impression and click counting for saved sliders — which slide earns its
 * place. The same shape as the sponsored-placement tracker: impressions
 * once per (slider, slide, UTC day) per browser session, batched into one
 * beacon; clicks sent at once so they survive the navigation. Counts are
 * aggregated server-side (/api/track/slider) into daily buckets the Sliders
 * page reads back per slide.
 */

import { useEffect, type RefObject } from "react";
import { utcDay } from "@/lib/boosts/boost-days";

export type SliderTrackEvent = { h: string; s: string; t: "imp" | "clk" };

const ENDPOINT = "/api/track/slider";
const FLUSH_INTERVAL_MS = 5000;
const DWELL_MS = 1000;
const MAX_BATCH = 50;

let queue: SliderTrackEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pagehideBound = false;
const seen = new Set<string>();

function send(events: SliderTrackEvent[]) {
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

/** One impression per slide per day per session — a carousel that loops all afternoon counts once. */
function trackSliderImpression(handle: string, slideId: string) {
  const key = `${handle}:${slideId}:${utcDay()}`;
  if (seen.has(key)) return;
  seen.add(key);
  queue.push({ h: handle, s: slideId, t: "imp" });
  scheduleFlush();
}

/** Sent at once: the click is a navigation, and the page may be gone in a moment. */
export function trackSliderClick(handle: string, slideId: string) {
  send([{ h: handle, s: slideId, t: "clk" }]);
}

/**
 * Counts an impression of the slide on show whenever the frame has been at
 * least half visible for a second; a slide that comes around while the
 * frame is on screen counts when it does.
 */
export function useSliderImpressions(
  ref: RefObject<HTMLElement | null>,
  handle: string | undefined,
  slideId: string | undefined,
) {
  useEffect(() => {
    const node = ref.current;
    if (!node || !handle || !slideId) return;
    if (typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          if (timer) return;
          timer = setTimeout(() => {
            trackSliderImpression(handle, slideId);
            timer = null;
          }, DWELL_MS);
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [ref, handle, slideId]);
}
