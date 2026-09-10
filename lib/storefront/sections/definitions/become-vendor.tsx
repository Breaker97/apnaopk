import { HomeBecomeVendorSection } from "@/components/store/home-become-vendor-section";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

export const becomeVendor: SectionDefinition = {
  type: "become-vendor",
  version: 1,
  category: "more",
  fields: [
    { key: "image", type: "image" },
    { key: "title", type: "text", translatable: true, default: "Start Selling With Us Today" },
    {
      key: "subtitle",
      type: "text",
      translatable: true,
      default:
        "Join our marketplace, manage products easily, accept secure payments, and grow your business faster.",
    },
    { key: "buttonLabel", type: "text", translatable: true, default: "Become a Vendor" },
    { key: "buttonHref", type: "url", default: "/become-vendor" },
  ],
  available: (ctx) => ctx.isMultiVendorEnabled,
  // Synchronous — no data fetch, so no Skeleton, matching the boundary the
  // home page drew for it.
  Render({ settings, ctx }) {
    return (
      <HomeBecomeVendorSection
        locale={ctx.locale}
        imageSrc={settings.image as string}
        title={lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        subtitle={lt(settings.subtitle as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        buttonLabel={lt(settings.buttonLabel as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        buttonHref={settings.buttonHref as string}
      />
    );
  },
};
