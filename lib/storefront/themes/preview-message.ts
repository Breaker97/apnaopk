import type { ThemeTokens } from "./tokens";

/**
 * The Themes editor ↔ storefront preview contract.
 *
 * The editor frames the LIVE storefront and posts the unsaved TOKENS into
 * it; the frame compiles them itself with the same `compileTheme` the
 * server layout uses. Tokens travel, not CSS — so the frame is the single
 * place that decides how a token becomes a variable, and the preview can
 * never drift from the storefront. Pure module: both bundles import it.
 */
export const THEME_PREVIEW_MESSAGE = "storify:theme-preview";

/**
 * Posted by the frame to its parent once the bridge is listening. The
 * iframe's `load` event fires long before React has hydrated the storefront
 * in development — a payload posted on `load` would fall on the floor — so
 * the editor waits for this instead, and re-sends on every ready (a frame
 * that navigates re-announces itself).
 */
export const THEME_PREVIEW_READY_MESSAGE = "storify:theme-preview-ready";

export interface ThemePreviewMessage {
  type: typeof THEME_PREVIEW_MESSAGE;
  /** The active theme's tokens as the editor currently has them. */
  tokens: ThemeTokens;
}

export function isThemePreviewMessage(
  data: unknown,
): data is ThemePreviewMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === THEME_PREVIEW_MESSAGE &&
    typeof (data as { tokens?: unknown }).tokens === "object" &&
    (data as { tokens?: unknown }).tokens !== null
  );
}
