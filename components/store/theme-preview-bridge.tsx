"use client";

import { ownTheme } from "@/lib/storefront/themes/dom-theme";
import { useEffect } from "react";
import { useClientValue } from "@/hooks/use-client-value";
import {
  compileTheme,
  ROLE_VAR,
  THEME_ATTRIBUTES,
  THEME_VARS,
  type BrandColors,
} from "@/lib/storefront/themes/compile";
import {
  isThemePreviewMessage,
  THEME_PREVIEW_READY_MESSAGE,
} from "@/lib/storefront/themes/preview-message";
import { markKeyColor } from "@/lib/storefront/themes/preview-highlight";
import { normalizeThemeTokens } from "@/lib/storefront/themes/tokens";
import { setThemePreviewOverride } from "@/providers/theme-provider";
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
  themeId,
}: {
  brand: BrandColors;
  themeId: string;
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
    let lastSequence = -1;
    let restore: (() => void)[] = [];
    let remark: number | undefined;
    const originalDark = document.documentElement.classList.contains("dark");
    const apply = (message: import("@/lib/storefront/themes/preview-message").ThemePreviewMessage) => {
      const surface = document.querySelector<HTMLElement>(".store-surface");
      if (!surface) return;
      let tokens: ThemeTokens;
      try { tokens = normalizeThemeTokens(themeDefaults, message.tokens); } catch { return; }
      const { vars, attributes } = compileTheme(tokens, message.brand);
      restore.reverse().forEach(fn => fn());
      // Through the theme provider, so components that branch on the mode
      // (the header's dark scheme, the logo artwork) follow too — the class
      // alone repainted the page but left them light. Nothing is stored.
      setThemePreviewOverride(message.previewMode);
      document.documentElement.classList.toggle("dark", message.previewMode === "dark");
      // Everything the compiler can emit and this output does not (a font or
      // radius just reset) is cleared, or the saved page's value would stay.
      const cleared = (keys: readonly string[], present: Record<string, string>) =>
        Object.fromEntries(keys.filter((key) => !(key in present)).map((key) => [key, ""]));
      restore = [surface,document.body].map(target => ownTheme(target, { ...cleared(THEME_VARS, vars), ...vars }, {
        ...cleared(THEME_ATTRIBUTES, attributes),...attributes,"data-store-theme":themeId,"data-theme-preview":"true",
      }));
      const role = message.highlight;
      const color = role ? vars[`--store-${message.previewMode === "dark" ? "d" : "l"}-${ROLE_VAR[role]}`] : undefined;
      markKeyColor(role, color, { reveal: true });
      // Again once the mode switch has re-rendered what branches on it.
      window.clearTimeout(remark);
      if (role) remark = window.setTimeout(() => markKeyColor(role, color), 250);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (!isThemePreviewMessage(event.data)) return;
      if (event.data.themeId !== themeId || event.data.sequence <= lastSequence) return;
      lastSequence = event.data.sequence;
      apply(event.data);
    };

    window.addEventListener("message", onMessage);
    // Listening now — the editor sends the current tokens in reply.
    window.parent.postMessage(
      { type: THEME_PREVIEW_READY_MESSAGE, protocolVersion: 2, themeId },
      window.location.origin,
    );
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(remark);
      markKeyColor(null, undefined);
      restore.reverse().forEach(fn => fn());
      setThemePreviewOverride(null);
      document.documentElement.classList.toggle("dark", originalDark);
    };
  }, [framed, defaultsJson, brandJson, themeId]);

  return null;
}
