import { CollectionList } from "@/components/store/sections/collection-list";
import { TileRowSkeleton } from "@/components/store/sections/section-skeletons";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

export const collectionList: SectionDefinition = {
  type: "collection-list",
  version: 1,
  category: "categories",
  fields: [
    { key: "title", type: "text", translatable: true, default: "Top Collections" },
    { key: "limit", type: "number", default: 4, min: 2, max: 12 },
  ],
  Render({ settings, ctx }) {
    return (
      <CollectionList
        locale={ctx.locale}
        title={lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        limit={settings.limit as number}
      />
    );
  },
  Skeleton: () => <TileRowSkeleton tiles={4} />,
};
