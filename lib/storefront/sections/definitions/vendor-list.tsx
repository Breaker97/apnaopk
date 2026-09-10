import { HomeTopVendors } from "@/components/store/home-top-vendors";
import { TopVendorsSkeleton } from "@/components/store/home-section-skeletons";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

export const vendorList: SectionDefinition = {
  type: "vendor-list",
  version: 1,
  category: "more",
  fields: [
    { key: "title", type: "text", translatable: true, default: "Top Vendors" },
    { key: "limit", type: "number", default: 8, min: 1, max: 20 },
  ],
  available: (ctx) => ctx.isMultiVendorEnabled,
  Render({ settings, ctx }) {
    return (
      <HomeTopVendors
        locale={ctx.locale}
        title={lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        limit={settings.limit as number}
      />
    );
  },
  Skeleton: TopVendorsSkeleton,
};
