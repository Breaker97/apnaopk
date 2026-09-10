import { Testimonials } from "@/components/store/sections/testimonials";
import { TileRowSkeleton } from "@/components/store/sections/section-skeletons";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

export const testimonials: SectionDefinition = {
  type: "testimonials",
  version: 1,
  category: "content",
  fields: [
    { key: "title", type: "text", translatable: true, default: "What Our Customers Say" },
    { key: "minRating", type: "number", default: 4, min: 1, max: 5 },
    { key: "limit", type: "number", default: 6, min: 3, max: 12 },
  ],
  Render({ settings, ctx }) {
    return (
      <Testimonials
        locale={ctx.locale}
        title={lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        minRating={settings.minRating as number}
        limit={settings.limit as number}
      />
    );
  },
  Skeleton: () => (
    <TileRowSkeleton
      tiles={3}
      aspectClassName="h-40"
      columnsClassName="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
    />
  ),
};
