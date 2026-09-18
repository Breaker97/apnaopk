import { GetTheLook } from "@/components/store/sections/get-the-look";
import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { lt } from "../localized";
import type { LocalizedText, SectionDefinition } from "../types";

/**
 * "Get the Look": one styled outfit — a Look, which is a collection with
 * `kind: "look"` — shown as its campaign image, the pieces in it, and an
 * Add All to Cart button. Any collection may be picked; the Look kind is
 * what the automatic Looks row lists, not a gate on this section.
 */
export const getTheLook: SectionDefinition = {
  type: "get-the-look",
  version: 1,
  category: "products",
  suggested: true,
  fields: [
    {
      key: "collection",
      type: "collection",
      hint: "A Look (Collections → kind: Look) or any collection.",
    },
    { key: "title", type: "text", translatable: true, default: "Get the Look" },
    {
      key: "subtitle",
      type: "text",
      translatable: true,
      default: "Curated pieces styled together for effortless elegance",
    },
    // Unset shows the Look's own picture (or its first piece's).
    { key: "image", type: "image", hint: "Overrides the Look's own image." },
    {
      key: "imagePosition",
      type: "select",
      options: ["left", "right"],
      default: "left",
    },
    { key: "limit", type: "number", default: 4, min: 2, max: 6 },
    {
      key: "ctaLabel",
      type: "text",
      translatable: true,
      default: "Add All to Cart",
    },
    // The picture's size and spacing. Defaults are the section as it
    // shipped: two fifths of the row, at least 28rem tall, a 40px gap.
    {
      key: "imageWidth",
      type: "number",
      default: 40,
      min: 20,
      max: 60,
      width: "third",
      hint: "The picture's share of the row on desktop, in percent.",
    },
    {
      key: "imageHeight",
      type: "number",
      default: 448,
      min: 240,
      max: 900,
      width: "third",
      hint: "The picture's minimum height on desktop, in pixels.",
    },
    {
      key: "gap",
      type: "number",
      default: 40,
      min: 0,
      max: 80,
      width: "third",
      hint: "Between the picture and the pieces on desktop, in pixels.",
    },
    {
      key: "cardsPerRow",
      type: "number",
      default: 0,
      min: 0,
      max: 6,
      width: "third",
      hint: "Pieces across on desktop; 0 fits them all on one row.",
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
      key: "imageRadius",
      type: "number",
      default: 16,
      min: 0,
      max: 48,
      width: "third",
      showWhen: { key: "corners", values: ["custom"] },
    },
  ],
  Render({ settings, ctx }) {
    return (
      <GetTheLook
        locale={ctx.locale}
        collectionId={settings.collection as string}
        title={lt(settings.title as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        subtitle={lt(settings.subtitle as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        image={settings.image as string}
        imagePosition={settings.imagePosition as "left" | "right"}
        limit={settings.limit as number}
        ctaLabel={lt(settings.ctaLabel as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        layout={{
          imageWidth: settings.imageWidth as number,
          imageHeight: settings.imageHeight as number,
          gap: settings.gap as number,
          cardsPerRow: settings.cardsPerRow as number,
          radius:
            settings.corners === "custom"
              ? `${settings.imageRadius as number}px`
              : "var(--store-radius-card, 16px)",
        }}
        emptyState={sectionEmptyState(ctx, {
          title: "Get the Look",
          hint: "Pick a Look — a collection with its kind set to Look — that is active and published to the online store.",
        })}
      />
    );
  },
  Skeleton: () => (
    <div className="container mx-auto px-4 py-6 lg:py-10">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-10">
        <Skeleton className="aspect-[4/5] w-full rounded-2xl lg:aspect-auto lg:min-h-[28rem]" />
        <div className="space-y-4">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="aspect-[3/4] w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-11 w-full rounded-full" />
        </div>
      </div>
    </div>
  ),
};
