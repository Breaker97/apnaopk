import { CouponBanner } from "@/components/store/sections/coupon-banner";
import { normalizeBackground } from "@/lib/sliders/types";
import { lt } from "../localized";
import type {
  LocalizedText,
  SectionDefinition,
  SectionInstance,
} from "../types";

/**
 * Up to v3, in one shape-driven step so a document at any older version
 * lands in the same place:
 *
 * - the background image became the full background control (a colour, a
 *   gradient or an image), the same one the sliders use;
 * - `heading`/`subheading` became `offer`/`condition` — they no longer carry
 *   the banner, they OVERRIDE what the chosen discount says, so an empty one
 *   is now the normal state rather than a blank strip.
 *
 * The old copy carries across as an override, which is what keeps a banner
 * that was reading "Get 20% off" reading exactly that.
 */
function migrateCouponBanner(instance: SectionInstance): SectionInstance {
  const settings = { ...(instance.settings ?? {}) };

  if (!settings.background || typeof settings.background !== "object") {
    const image = settings.image;
    settings.background =
      typeof image === "string" && image
        ? { type: "image", image }
        : { type: "solid" };
  }
  delete settings.image;

  if (settings.offer === undefined && settings.heading !== undefined) {
    settings.offer = settings.heading;
  }
  if (settings.condition === undefined && settings.subheading !== undefined) {
    settings.condition = settings.subheading;
  }
  delete settings.heading;
  delete settings.subheading;

  return { ...instance, version: 3, settings };
}

export const couponBanner: SectionDefinition = {
  type: "coupon-banner",
  version: 3,
  category: "promotions",
  fields: [
    // Paired deliberately: each row holds two controls of the same height,
    // so a hinted field never sits beside a bare one and leaves a gap. The
    // discount comes first because everything below is derived from it.
    //
    // Picked from Discounts, never typed: a code that checkout rejects is
    // worse than no banner at all, and the offer below is read off it.
    { key: "code", type: "coupon", default: "" },
    { key: "showExpiry", type: "toggle", default: true, width: "half" },
    // Both blank by default: the discount says what it is worth and what it
    // needs, so a merchant only fills these in to say it differently.
    {
      key: "offer",
      type: "text",
      translatable: true,
      default: "",
      hint: "Leave empty to show what the discount is worth.",
    },
    {
      key: "condition",
      type: "text",
      translatable: true,
      default: "",
      hint: "Leave empty to show the discount's own minimum spend.",
    },
    { key: "ctaLabel", type: "text", translatable: true, default: "Shop now" },
    { key: "link", type: "url", default: "" },
    // Unset paints the theme's dark plate, the strip's own look.
    { key: "background", type: "background", width: "half", video: true },
  ],
  migrate: migrateCouponBanner,
  Render({ settings, ctx }) {
    return (
      <CouponBanner
        locale={ctx.locale}
        code={typeof settings.code === "string" ? settings.code : ""}
        heading={lt(settings.offer as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        subheading={lt(settings.condition as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        showExpiry={settings.showExpiry !== false}
        ctaLabel={lt(settings.ctaLabel as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        href={settings.link as string}
        background={normalizeBackground(settings.background)}
        ctx={ctx}
      />
    );
  },
};
