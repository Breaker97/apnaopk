"use client";

import { useEffect } from "react";
import { useClientValue } from "@/hooks/use-client-value";
import { usePathname } from "@/hooks/use-locale-navigation";
import { isDashboardPath } from "@/lib/access/role-dashboard";
import { markKeyColor } from "@/lib/storefront/themes/preview-highlight";
import {
  isThemePreviewMessage,
  THEME_PREVIEW_DASHBOARD_SURFACE,
  THEME_PREVIEW_READY_MESSAGE,
} from "@/lib/storefront/themes/preview-message";
import type { KeyColorRole } from "@/lib/storefront/themes/tokens";
import { useAppSettings } from "@/stores/app-settings";

/**
 * The dashboard half of the Themes editor's live preview. The dashboards are
 * painted with the LIVE theme's key colours (the apparent sidebar, buttons,
 * links), so a dashboard page opened in the editor's preview frame — by a
 * link in the shop's header — must follow the palette being picked, not just
 * the colours saved last. Active ONLY inside a same-origin iframe, on a
 * dashboard page: a merchant's own tab is never framed and never runs any of
 * this, and the storefront has its own bridge.
 *
 * The colours go into the app-settings store, which the sidebars read and
 * `SettingsApplier` turns into the brand variables. The store never persists
 * them, and this document is the frame's alone.
 */
export function DashboardPreviewBridge() {
  const onDashboard = isDashboardPath(usePathname());
  const framed = useClientValue(() => window.self !== window.top, false);

  useEffect(() => {
    if (!framed || !onDashboard) return;
    let lastSequence = -1;
    let previewed: { primaryColor: string; secondaryColor: string; accentColor: string } | null = null;
    let remark: number | undefined;

    const mark = (role: KeyColorRole | null | undefined) => {
      const color = role && role !== "skeleton" && previewed
        ? previewed[`${role}Color` as const]
        : undefined;
      markKeyColor(role, color, { reveal: true });
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (!isThemePreviewMessage(event.data) || !event.data.keyColors) return;
      if (event.data.sequence <= lastSequence) return;
      lastSequence = event.data.sequence;
      const { primary, secondary, accent } = event.data.keyColors;
      previewed = { primaryColor: primary, secondaryColor: secondary, accentColor: accent };
      useAppSettings.setState(previewed);
      // The marks wait for the brand variables, which land a render later.
      const role = event.data.highlight;
      window.clearTimeout(remark);
      remark = window.setTimeout(() => mark(role), 120);
    };

    // A refresh of the page's data hydrates the SAVED colours again; the
    // frame keeps showing the palette being previewed.
    const unsubscribe = useAppSettings.subscribe((state) => {
      if (!previewed) return;
      if (
        state.primaryColor !== previewed.primaryColor ||
        state.secondaryColor !== previewed.secondaryColor ||
        state.accentColor !== previewed.accentColor
      ) {
        useAppSettings.setState(previewed);
      }
    });

    window.addEventListener("message", onMessage);
    // Listening now — the editor sends the current key colours in reply. A
    // dashboard names no theme: it takes the colours whichever is edited.
    window.parent.postMessage(
      { type: THEME_PREVIEW_READY_MESSAGE, protocolVersion: 2, surface: THEME_PREVIEW_DASHBOARD_SURFACE },
      window.location.origin,
    );
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(remark);
      unsubscribe();
      markKeyColor(null, undefined);
    };
  }, [framed, onDashboard]);

  return null;
}
