import { CountdownOffer } from "@/components/store/sections/countdown-offer";
import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import { ElectronicsDeals } from "@/components/store/sections/themes/electronics-deals";
import { normalizeBackground } from "@/lib/sliders/types";
import {
  DEAL_LAYOUTS,
  DEFAULT_DEAL_LAYOUT,
  MAX_DEAL_SLOTS,
  getDealLayout,
} from "../deal-layouts";
import { lt } from "../localized";
import type {
  LocalizedText,
  SectionDefinition,
  SectionRenderProps,
} from "../types";

function props({ settings, ctx }: SectionRenderProps) {
  return {
    locale: ctx.locale,
    heading: lt(settings.heading as LocalizedText, ctx.locale, ctx.defaultLanguage),
    subheading: lt(settings.subheading as LocalizedText, ctx.locale, ctx.defaultLanguage),
    endsAt: settings.endsAt as string,
    ctaLabel: lt(settings.ctaLabel as LocalizedText, ctx.locale, ctx.defaultLanguage),
    href: settings.link as string,
  };
}

/** The original image-backed strip — what every stored instance renders. */
const banner: SectionDefinition["Render"] = (renderProps) => (
  <CountdownOffer
    {...props(renderProps)}
    imageSrc={renderProps.settings.image as string}
    emptyState={sectionEmptyState(renderProps.ctx, {
      title: "Countdown offer",
      hint: "Set when the offer ends — the strip counts down to that moment, so without it there is nothing to show.",
    })}
  />
);

/**
 * Panel that also lays out the products the deadline is about. It ignores
 * `image` — the panel is a designed field, not artwork — which is a
 * presentation choice, not a content one: the stored image is untouched and
 * comes back with the banner design.
 */
const dealsPanel: SectionDefinition["Render"] = (renderProps) => {
  const { settings, ctx } = renderProps;
  return (
    <ElectronicsDeals
      {...props(renderProps)}
      productIds={(settings.productIds as string[]) ?? []}
      layout={getDealLayout(settings.layout)}
      background={normalizeBackground(settings.background)}
      foreground={typeof settings.foreground === "string" ? settings.foreground : ""}
      minHeight={typeof settings.height === "number" ? settings.height : 360}
      showSavings={settings.showSavings !== false}
      showStock={settings.showStock !== false}
      emptyState={sectionEmptyState(ctx, {
        title: "Deals panel",
        hint: "Set when the offer ends — the panel counts down to that moment, so without it there is nothing to show.",
      })}
      // The same rule as the image banner: a countdown frozen at zero
      // advertises urgency that has expired, so the panel goes quiet.
      expiredState={sectionEmptyState(ctx, {
        title: "Deals panel",
        hint: "This offer has ended, so the panel is hidden on the storefront. Set a new end time to bring it back.",
      })}
    />
  );
};

export const countdownOffer: SectionDefinition = {
  type: "countdown-offer",
  version: 1,
  category: "promotions",
  // FIRST entry is the default every existing document falls back to — never
  // reorder this list, only append.
  variants: [
    { key: "banner", name: "Image banner", Render: banner },
    { key: "deals-panel", name: "Deals panel", Render: dealsPanel },
  ],
  fields: [
    { key: "heading", type: "text", translatable: true, default: "Deal of the week" },
    { key: "subheading", type: "text", translatable: true, default: "" },
    { key: "ctaLabel", type: "text", translatable: true, default: "" },
    { key: "link", type: "url", default: "" },
    { key: "endsAt", type: "datetime", default: "", width: "third" },
    // A desktop minimum, in px. The floor IS the cap: a panel cannot be told
    // to be shorter than its head and its cards, so the field starts at the
    // least height the design's own arrangement needs and only goes up.
    // The panel keeps growing with its content past whatever is set.
    {
      key: "height",
      type: "number",
      default: 360,
      min: 360,
      max: 1200,
      variants: ["deals-panel"],
      hint: "Minimum height on desktop, in pixels. The panel always grows to fit its content.",
    },
    // Artwork is the banner's whole design; the deals panel paints its own
    // field, so the control only appears for the design that reads it.
    { key: "image", type: "image", variants: ["banner"] },
    // The panel's paint. Unset keeps the design's own violet field; the
    // text colour is chosen against whatever is picked.
    {
      key: "background",
      type: "background",
      variants: ["deals-panel"],
      width: "third",
    },
    {
      key: "foreground",
      type: "color",
      default: "#ffffff",
      variants: ["deals-panel"],
    },
    // The two signals a deals panel is expected to carry, each read from the
    // products themselves so neither can be switched on to say something
    // untrue: the biggest discount on show, and how few are left.
    {
      key: "showSavings",
      type: "toggle",
      default: true,
      variants: ["deals-panel"],
    },
    {
      key: "showStock",
      type: "toggle",
      default: true,
      variants: ["deals-panel"],
    },
    // How the deals are arranged — edited through the layout picker, never
    // the bare dropdown, but it normalizes and stores as a plain select.
    {
      key: "layout",
      type: "select",
      options: DEAL_LAYOUTS.map((layout) => layout.key),
      default: DEFAULT_DEAL_LAYOUT,
      variants: ["deals-panel"],
    },
    // Which deals to feature, IN SLOT ORDER — the layout lays its picks into
    // fixed places, so the list is the arrangement. Empty means "whatever is
    // on sale", the behaviour the panel shipped with, so it works uncurated.
    {
      key: "productIds",
      type: "productList",
      variants: ["deals-panel"],
      max: MAX_DEAL_SLOTS,
      hint: "Drag to set the slot order. Leave empty to show whatever is on sale.",
    },
  ],
  Render: banner,
};
