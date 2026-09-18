import { LooksList, type LooksShape } from "@/components/store/sections/looks-list";
import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getStorefrontLooks } from "@/lib/storefront/storefront-looks";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

/**
 * "More Looks to Love": a scrolling row of Looks. Automatic by default —
 * every collection marked as a Look, in collection order — or hand-picked
 * through the blocks, which may name any collection.
 */
export const looksList: SectionDefinition = {
  type: "looks-list",
  version: 1,
  category: "products",
  suggested: true,
  fields: [
    {
      key: "title",
      type: "text",
      translatable: true,
      default: "More Looks to Love",
    },
    {
      key: "source",
      type: "select",
      options: ["looks", "manual"],
      default: "looks",
      hint: "Hand-picked shows the Look blocks below, in order.",
    },
    { key: "limit", type: "number", default: 8, min: 2, max: 12 },
    // The row's geometry. Defaults are the row as it shipped: four across,
    // 16px apart, 4:5 pictures with the theme's card corners.
    {
      key: "columns",
      type: "number",
      default: 4,
      min: 2,
      max: 6,
      width: "third",
      hint: "Looks across on desktop; the row scrolls past them.",
    },
    {
      key: "gap",
      type: "number",
      default: 16,
      min: 0,
      max: 48,
      width: "third",
      hint: "Between the Looks, in pixels.",
    },
    {
      key: "shape",
      type: "select",
      options: ["portrait", "square", "tall", "landscape"],
      default: "portrait",
      width: "third",
    },
    {
      key: "corners",
      type: "select",
      options: ["theme", "custom"],
      default: "theme",
      width: "third",
      hint: "Theme default: the card radius from Themes → Shapes.",
    },
    {
      key: "radius",
      type: "number",
      default: 16,
      min: 0,
      max: 48,
      width: "third",
      showWhen: { key: "corners", values: ["custom"] },
    },
  ],
  blocks: [
    {
      type: "look",
      max: 12,
      fields: [{ key: "collection", type: "collection" }],
    },
  ],
  starter: { blocks: [] },
  async Render({ settings, blocks, ctx }) {
    const limit = settings.limit as number;
    const ids =
      settings.source === "manual"
        ? blocks
            .filter((block) => block.visible)
            .map((block) => block.settings.collection)
            .filter((id): id is string => typeof id === "string" && id !== "")
        : undefined;
    // A hand-pick with nothing picked is an empty row, not the automatic one.
    const looks =
      ids && ids.length === 0 ? [] : await getStorefrontLooks({ limit, ids });

    if (looks.length === 0) {
      return sectionEmptyState(ctx, {
        title: "Looks",
        hint: "Mark collections as Looks (Collections → kind: Look), or add Look blocks here and pick collections by hand.",
      });
    }

    return (
      <LooksList
        locale={ctx.locale}
        title={lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        looks={looks}
        layout={{
          columns: settings.columns as number,
          gap: settings.gap as number,
          shape: settings.shape as LooksShape,
          radius:
            settings.corners === "custom"
              ? `${settings.radius as number}px`
              : "var(--store-radius-card, 16px)",
        }}
      />
    );
  },
  Skeleton: () => (
    <div className="container mx-auto px-4 py-5 lg:py-8">
      <Skeleton className="h-7 w-52" />
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-3">
            <Skeleton className="aspect-[4/5] w-full rounded-2xl" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  ),
};
