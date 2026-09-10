"use client";

import { useEffect } from "react";

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
    for (const [name, value] of Object.entries(attributes)) {
      body.setAttribute(name, value);
    }
    for (const [name, value] of Object.entries(cssVars)) {
      body.style.setProperty(name, value);
    }
    return () => {
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
