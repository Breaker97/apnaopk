/**
 * Settings vocabulary of the Top Vendors section, shared by its definition
 * (server), the data read, and the carousel (client). Kept out of the
 * "use client" carousel module so the server side can read the values.
 *
 * Every FIRST option is the default and reproduces the section as it looked
 * before the setting existed — stored documents render unchanged.
 */

/** Where the cards come from. */
export const TOP_VENDOR_SOURCES = [
  "topRated",
  "bestSelling",
  "newest",
  "manual",
] as const;
export type TopVendorSource = (typeof TOP_VENDOR_SOURCES)[number];

export const TOP_VENDOR_LAYOUTS = ["carousel", "cardGrid"] as const;
export type TopVendorLayout = (typeof TOP_VENDOR_LAYOUTS)[number];

export const TOP_VENDOR_CARD_STYLES = ["bordered", "shadow", "flat"] as const;
export type TopVendorCardStyle = (typeof TOP_VENDOR_CARD_STYLES)[number];

export const TOP_VENDOR_BUTTON_STYLES = ["solid", "outline"] as const;
export type TopVendorButtonStyle = (typeof TOP_VENDOR_BUTTON_STYLES)[number];

export const TOP_VENDOR_COLUMNS_MIN = 2;
export const TOP_VENDOR_COLUMNS_MAX = 6;
/** Hand-picked and ranked lists share one ceiling. */
export const TOP_VENDOR_MAX = 20;

/** How the cards look, as the section's settings resolve it. */
export interface TopVendorsDisplay {
  layout: TopVendorLayout;
  desktopColumns: number;
  cardStyle: TopVendorCardStyle;
  /** Pixels. */
  cardRadius: number;
  buttonStyle: TopVendorButtonStyle;
  /** Hex, or "" to keep the theme's paint. */
  backgroundColor: string;
  buttonColor: string;
  showTagline: boolean;
  showRating: boolean;
  showSold: boolean;
  showPrice: boolean;
  showFollow: boolean;
  showButton: boolean;
}
