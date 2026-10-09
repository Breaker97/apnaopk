import { CategoryMosaic } from "@/components/store/sections/category-mosaic";
import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import { TileRowSkeleton } from "@/components/store/sections/section-skeletons";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

export const categoryMosaic: SectionDefinition = {
  type: "category-mosaic",
  version: 1,
  category: "categories",
  fields: [
    { key: "title", type: "text", translatable: true, default: "" },
    {
      key: "source",
      type: "select",
      options: ["featured", "topLevel", "manual"],
      default: "featured",
    },
    // 1 lead tile + up to 6 grid tiles.
    { key: "limit", type: "number", default: 5, min: 3, max: 7 },
    { key: "categoryIds", type: "categoryList" },
  ],
  Render({ settings, ctx }) {
    return (
      <CategoryMosaic

        title={lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        source={settings.source as "featured" | "topLevel" | "manual"}
        limit={settings.limit as number}
        categoryIds={settings.categoryIds as string[]}
        // A vendor's landing page: the same sources, read among the store's
        // own categories, each opening its Products tab filtered to it.
        vendor={ctx.vendor}
        emptyState={
          ctx.vendor
            ? sectionEmptyState(ctx, {
                title: "Category mosaic",
                hint: "The mosaic needs at least three categories from its source — Featured, Top-level, or picked by hand among the categories your products are in.",
              })
            : null
        }
      />
    );
  },
  Skeleton: () => <TileRowSkeleton tiles={5} />,
};
