"use client";

import { useEffect } from "react";
import { useClientValue } from "@/hooks/use-client-value";
import {
  compileTheme,
  THEME_ATTRIBUTES,
  THEME_VARS,
  type BrandColors,
} from "@/lib/storefront/themes/compile";
import {
  isThemePreviewMessage,
  THEME_PREVIEW_READY_MESSAGE,
} from "@/lib/storefront/themes/preview-message";
import { normalizeThemeTokens } from "@/lib/storefront/themes/tokens";
import type { ThemeTokens } from "@/lib/storefront/themes/tokens";

/**
 * The storefront half of the Themes editor's live preview. Active ONLY when
 * this render sits inside a same-origin iframe: it listens for the editor's
 * unsaved tokens, compiles them with the SAME compiler the server layout
 * used for the first paint, and re-applies the result to the store surface
 * and the <body> mirror portaled overlays read — no server round-trip. A
 * visitor's tab is never framed and never runs any of this.
 */
export function ThemePreviewBridge({
  brand,
  defaults,
}: {
  brand: BrandColors;
  /** The active theme's defaults, so a partial payload normalizes the same
   * way the server would. */
  defaults: ThemeTokens;
}) {
  const framed = useClientValue(() => window.self !== window.top, false);
  const defaultsJson = JSON.stringify(defaults);
  const brandJson = JSON.stringify(brand);

  useEffect(() => {
    if (!framed) return;
    const themeDefaults = JSON.parse(defaultsJson) as ThemeTokens;
    const brandColors = JSON.parse(brandJson) as BrandColors;

    const apply = (raw: unknown) => {
      const surface = document.querySelector<HTMLElement>(".store-surface");
      if (!surface) return;
      const tokens = normalizeThemeTokens(themeDefaults, raw);
      const { vars, attributes } = compileTheme(tokens, brandColors);
      const targets = [surface, document.body];
      // Clear first, then set: a choice the editor just undid must go away.
      for (const target of targets) {
        for (const name of THEME_ATTRIBUTES) target.removeAttribute(name);
        for (const name of THEME_VARS) target.style.removeProperty(name);
        for (const [name, value] of Object.entries(attributes)) {
          target.setAttribute(name, value);
        }
        for (const [name, value] of Object.entries(vars)) {
          target.style.setProperty(name, value);
        }
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isThemePreviewMessage(event.data)) return;
      apply(event.data.tokens);
    };

    window.addEventListener("message", onMessage);
    // Listening now — the editor sends the current tokens in reply.
    window.parent.postMessage(
      { type: THEME_PREVIEW_READY_MESSAGE },
      window.location.origin,
    );
    return () => window.removeEventListener("message", onMessage);
  }, [framed, defaultsJson, brandJson]);

  return null;
}
