import { HomeTopVendors } from "@/components/store/home-top-vendors";
import { TopVendorsSkeleton } from "@/components/store/home-section-skeletons";
import { lt } from "../localized";
import {
  TOP_VENDOR_BUTTON_STYLES,
  TOP_VENDOR_CARD_STYLES,
  TOP_VENDOR_COLUMNS_MAX,
  TOP_VENDOR_COLUMNS_MIN,
  TOP_VENDOR_LAYOUTS,
  TOP_VENDOR_MAX,
  TOP_VENDOR_SOURCES,
  type TopVendorButtonStyle,
  type TopVendorCardStyle,
  type TopVendorLayout,
  type TopVendorSource,
} from "../top-vendors";
import type { LocalizedText, SectionDefinition } from "../types";

const RANKED_SOURCES = TOP_VENDOR_SOURCES.filter((source) => source !== "manual");

export const vendorList: SectionDefinition = {
  type: "vendor-list",
  version: 1,
  category: "more",
  // Every new setting defaults to what the section drew before it existed,
  // so stored documents need no migration and render exactly as they did.
  fields: [
    // Content
    { key: "title", type: "text", translatable: true, default: "Top Vendors" },
    { key: "subtitle", type: "text", translatable: true, default: "" },
    { key: "source", type: "select", options: TOP_VENDOR_SOURCES, default: "topRated" },
    {
      key: "vendorIds",
      type: "vendorList",
      max: TOP_VENDOR_MAX,
      hint: "Drag to set the order. Only approved stores appear on the storefront.",
      showWhen: { key: "source", values: ["manual"] },
    },
    {
      key: "limit",
      type: "number",
      default: 8,
      min: 1,
      max: TOP_VENDOR_MAX,
      // Hand-picked lists show every pick; the count only caps a ranking.
      showWhen: { key: "source", values: RANKED_SOURCES },
    },
    {
      key: "ctaLabel",
      type: "text",
      translatable: true,
      default: "",
      hint: "Leave empty for “Go to Shop”.",
    },
    {
      key: "viewAllLabel",
      type: "text",
      translatable: true,
      default: "",
      hint: "Leave empty to hide the link.",
    },
    { key: "viewAllLink", type: "url", default: "/vendors" },
    // Layout
    { key: "layout", type: "select", options: TOP_VENDOR_LAYOUTS, default: "carousel" },
    {
      key: "desktopColumns",
      type: "number",
      default: 4,
      min: TOP_VENDOR_COLUMNS_MIN,
      max: TOP_VENDOR_COLUMNS_MAX,
    },
    // Style
    { key: "cardStyle", type: "select", options: TOP_VENDOR_CARD_STYLES, default: "bordered" },
    { key: "cardRadius", type: "number", default: 16, min: 0, max: 32 },
    { key: "buttonStyle", type: "select", options: TOP_VENDOR_BUTTON_STYLES, default: "solid" },
    { key: "backgroundColor", type: "color", default: "" },
    { key: "buttonColor", type: "color", default: "" },
    // Show & hide
    { key: "showTagline", type: "toggle", default: true },
    { key: "showRating", type: "toggle", default: true },
    { key: "showSold", type: "toggle", default: true },
    { key: "showPrice", type: "toggle", default: true },
    { key: "showFollow", type: "toggle", default: true },
    { key: "showButton", type: "toggle", default: true },
    { key: "hideEmptyStores", type: "toggle", default: false },
  ],
  available: (ctx) => ctx.isMultiVendorEnabled,
  Render({ settings, ctx }) {
    const text = (key: string) =>
      lt(settings[key] as LocalizedText, ctx.locale, ctx.defaultLanguage);
    return (
      <HomeTopVendors
        locale={ctx.locale}
        title={text("title")}
        subtitle={text("subtitle")}
        ctaLabel={text("ctaLabel")}
        viewAllLabel={text("viewAllLabel")}
        viewAllLink={settings.viewAllLink as string}
        query={{
          source: settings.source as TopVendorSource,
          vendorIds: settings.vendorIds as string[],
          limit: settings.limit as number,
          hideEmptyStores: settings.hideEmptyStores as boolean,
        }}
        display={{
          layout: settings.layout as TopVendorLayout,
          desktopColumns: settings.desktopColumns as number,
          cardStyle: settings.cardStyle as TopVendorCardStyle,
          cardRadius: settings.cardRadius as number,
          buttonStyle: settings.buttonStyle as TopVendorButtonStyle,
          backgroundColor: settings.backgroundColor as string,
          buttonColor: settings.buttonColor as string,
          showTagline: settings.showTagline as boolean,
          showRating: settings.showRating as boolean,
          showSold: settings.showSold as boolean,
          showPrice: settings.showPrice as boolean,
          showFollow: settings.showFollow as boolean,
          showButton: settings.showButton as boolean,
        }}
        preview={ctx.preview}
      />
    );
  },
  Skeleton: TopVendorsSkeleton,
};
