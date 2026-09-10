/**
 * The Themes page's tabs — also the accepted values of its `?tab=` deep
 * link. Pure module: the server page validates the query param with it and
 * the client gallery keeps the URL in step, so it must import from neither.
 */
export const THEME_PAGE_TABS = ["theme", "branding", "settings"] as const;
export type ThemePageTab = (typeof THEME_PAGE_TABS)[number];

export function isThemePageTab(value: unknown): value is ThemePageTab {
  return THEME_PAGE_TABS.includes(value as ThemePageTab);
}
