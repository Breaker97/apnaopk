/**
 * The maintenance page's own words: the page visitors get
 * (`buildMaintenanceHtml`, served from proxy.ts) and its preview in
 * Settings → Maintenance both read them, so the preview shows what the page
 * does. English only: the proxy builds the page without the translations.
 *
 * Client-safe: no imports.
 */
export const MAINTENANCE_COPY = {
  /** The headline when the admin sets none. */
  title: (storeName: string) => `${storeName} is temporarily offline`,
  message:
    "We're making a few improvements behind the scenes. Thanks for your patience.",
  status: "Scheduled maintenance in progress",
  countdownLabel: "Expected back in",
} as const;
