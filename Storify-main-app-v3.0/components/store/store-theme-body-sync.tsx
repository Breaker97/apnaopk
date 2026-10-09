"use client";

import { useEffect } from "react";

/** Latest the sync may wait for an idle moment. */
const IDLE_TIMEOUT_MS = 2000;

/**
 * Mirrors the store surface's compiled theme onto <body> so PORTALED
 * overlays — sheets, dialogs, dropdowns, which Radix mounts on
 * document.body, OUTSIDE `.store-surface` — read the same tokens as in-flow
 * storefront content: the color scheme, fonts, radii, shadows. The consumer
 * rules in globals.css target `:is(.store-surface, body[data-store-theme])`
 * for exactly this reason.
 *
 * Overlays only exist after hydration, so applying these in an effect can
 * never flash server markup. Everything applied is removed on unmount:
 * navigating to a non-storefront segment (admin, POS) must not leak
 * storefront styling into its overlays.
 *
 * When: writing ~40 custom properties on <body> re-styles the whole page, and
 * during hydration that stalled a phone's main thread for over a hundred
 * milliseconds. In-flow content already has these tokens from
 * `.store-surface`, and an overlay needs an interaction to open, so the sync
 * waits for the browser to be idle — or for the first pointer or key press,
 * which comes before any overlay the shopper opens. Values already on <body>
 * (a client-side navigation between storefront pages) are left alone.
 */
export function StoreThemeBodySync({
  themeId,
  dataAttributes,
  vars,
}: {
  themeId: string;
  dataAttributes?: Record<string, string>;
  vars?: Record<string, string>;
}) {
  // Serialized so the effect keys on CONTENT — the layout hands us fresh
  // object literals on every render, and raw object deps would re-apply
  // (remove + set) the body state on each navigation for nothing.
  const payload = JSON.stringify({
    attributes: { "data-store-theme": themeId, ...(dataAttributes ?? {}) },
    vars: vars ?? {},
  });

  useEffect(() => {
    const { attributes, vars: cssVars } = JSON.parse(payload) as {
      attributes: Record<string, string>;
      vars: Record<string, string>;
    };
    const body = document.body;
    let applied = false;

    const apply = () => {
      if (applied) return;
      applied = true;
      for (const [name, value] of Object.entries(attributes)) {
        if (body.getAttribute(name) !== value) body.setAttribute(name, value);
      }
      for (const [name, value] of Object.entries(cssVars)) {
        if (body.style.getPropertyValue(name) !== value) {
          body.style.setProperty(name, value);
        }
      }
    };

    const idle =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(apply, { timeout: IDLE_TIMEOUT_MS })
        : null;
    const timer = idle === null ? window.setTimeout(apply, 500) : null;
    const listen = { capture: true, once: true } as const;
    window.addEventListener("pointerdown", apply, listen);
    window.addEventListener("keydown", apply, listen);

    return () => {
      if (idle !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idle);
      }
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("pointerdown", apply, listen);
      window.removeEventListener("keydown", apply, listen);
      if (!applied) return;
      for (const name of Object.keys(attributes)) {
        body.removeAttribute(name);
      }
      for (const name of Object.keys(cssVars)) {
        body.style.removeProperty(name);
      }
    };
  }, [payload]);

  return null;
}
