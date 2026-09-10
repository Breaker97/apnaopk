import { BrandList } from "@/components/store/sections/brand-list";
import {
  BRAND_LIST_WIDTHS,
  type BrandListWidth,
} from "@/components/store/sections/brand-list-view";
import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import { TileRowSkeleton } from "@/components/store/sections/section-skeletons";
import type { SectionDefinition, SectionRenderProps } from "../types";

function props({ settings, blocks, ctx }: SectionRenderProps) {
  return {
    locale: ctx.locale,
    width: settings.width as BrandListWidth,
    // Brand ids, in row order — each block is a pick from Products → Brands.
    brandIds: blocks
      .filter((block) => block.visible)
      .map((block) =>
        typeof block.settings.brand === "string" ? block.settings.brand : "",
      )
      .filter(Boolean),
    emptyState: sectionEmptyState(ctx, {
      title: "Brand list",
      hint: "Pick brands for this section, or add brands under Products → Brands and they appear here automatically.",
    }),
  };
}

/** The original bordered logo tiles. */
const cards: SectionDefinition["Render"] = (renderProps) => (
  <BrandList {...props(renderProps)} appearance="cards" />
);

/** Plain evenly spaced logos — the Electronics design's brand run. */
const strip: SectionDefinition["Render"] = (renderProps) => (
  <BrandList {...props(renderProps)} appearance="strip" />
);

const Skeleton = () => (
  <TileRowSkeleton
    tiles={6}
    aspectClassName="h-16"
    columnsClassName="grid-cols-3 sm:grid-cols-4 lg:grid-cols-6"
  />
);

export const brandList: SectionDefinition = {
  type: "brand-list",
  version: 2,
  category: "categories",
  // FIRST entry is the default every existing document falls back to — never
  // reorder this list, only append.
  variants: [
    { key: "cards", name: "Logo cards", Render: cards, Skeleton },
    { key: "strip", name: "Plain logo strip", Render: strip, Skeleton },
  ],
  // Beyond the design variant the panel carries one setting: how wide the
  // row runs. The strip still renders untitled — no heading, no copy.
  fields: [
    {
      key: "width",
      type: "select",
      options: [...BRAND_LIST_WIDTHS],
      default: "fixed",
    },
  ],
  blocks: [
    {
      type: "brand",
      max: 20,
      // A pick from Products → Brands, stored as the Brand id so slug and
      // name edits never orphan the row.
      fields: [{ key: "brand", type: "text" }],
    },
  ],
  // v1 → v2: the strip moved from an auto Brands-DB query (source/limit
  // settings) to merchant-curated brand picks. Nothing to rewrite — the old
  // settings just drop out on normalize, and a section with no picked brands
  // keeps rendering the auto list (the component's fallback), so published
  // stores look exactly the same until someone curates.
  migrate: (instance) => instance,
  Render: cards,
  Skeleton,
};
