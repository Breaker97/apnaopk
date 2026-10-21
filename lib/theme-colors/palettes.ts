import { colorsEqual } from "@/lib/site-config/appearance-colors";

/** A theme's three key colours as a palette: primary, secondary, accent. */
export interface KeyColorTrio {
  primary: string;
  secondary: string;
  accent: string;
}

export interface KeyColorPalette extends KeyColorTrio {
  /** Also the i18n key: `admin.themeEditor.presets.<key>`. */
  key: "default" | "cyan" | "purple" | "blue" | "orange" | "red";
  name: string;
}

/**
 * The ready-made palettes the Colors editor offers beside a theme's own
 * default. Primary and accent are the presets merchants already know from
 * the brand; the secondary (Add to cart) is a near-black each reads well
 * beside, so a palette never paints two loud buttons side by side.
 */
export const KEY_COLOR_PALETTES: readonly KeyColorPalette[] = [
  { key: "default", name: "Blue", primary: "#2065D1", secondary: "#1C252E", accent: "#F59E0B" },
  { key: "cyan", name: "Cyan", primary: "#00B8D9", secondary: "#1C252E", accent: "#FFC107" },
  { key: "purple", name: "Purple", primary: "#7635DC", secondary: "#1C252E", accent: "#FFAB00" },
  { key: "blue", name: "Black", primary: "#111111", secondary: "#454F5B", accent: "#FFC107" },
  { key: "orange", name: "Orange", primary: "#FDA92D", secondary: "#1C252E", accent: "#2065D1" },
  { key: "red", name: "Red", primary: "#FF3030", secondary: "#1C252E", accent: "#FFAB00" },
];

/** Whether two palettes paint the same three colours. */
export function sameTrio(a: Partial<KeyColorTrio>, b: Partial<KeyColorTrio>): boolean {
  return (
    colorsEqual(a.primary, b.primary) &&
    colorsEqual(a.secondary, b.secondary) &&
    colorsEqual(a.accent, b.accent)
  );
}
