import {
  CollectionRows,
  type CollectionRowEntry,
} from "@/components/store/sections/collection-rows";
import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import type { SectionDefinition, SectionInstance } from "../types";

/** A collection block's settings, read leniently into one row. */
function readRow(settings: Record<string, unknown>): CollectionRowEntry {
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    collection: str(settings.collection),
    limit:
      typeof settings.limit === "number" && Number.isFinite(settings.limit)
        ? settings.limit
        : 4,
    kind: settings.kind === "slider" ? "slider" : "image",
    image: str(settings.image),
    slider: str(settings.slider),
  };
}

/**
 * v1 → v2: one `collectionId` setting became a LIST of collection blocks
 * (each row: promo panel + shelf), the localized title flattened to plain
 * text, and the carousel/promo-row designs collapsed into the single "Top
 * Collections" row layout. Guarded like the slideshow's migration: a payload
 * already carrying collection blocks (an editor save of an old doc) keeps
 * them, only the version stamp changes.
 */
function migrateFeaturedCollectionV1(
  instance: SectionInstance,
): SectionInstance {
  const s = instance.settings ?? {};
  // Localized titles lose their variants: keep the first non-empty value.
  const flatTitle = (() => {
    const value = s.title;
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const entry of Object.values(value)) {
        if (typeof entry === "string" && entry) return entry;
      }
    }
    return "";
  })();

  if ((instance.blocks ?? []).some((block) => block.type === "collection")) {
    return { ...instance, version: 2, settings: { title: flatTitle } };
  }

  const collectionId =
    typeof s.collectionId === "string" ? s.collectionId : "";
  // The carousel's shelf size carries over as the row's card count, clamped
  // to what fits beside the panel.
  const limit =
    typeof s.limit === "number" && Number.isFinite(s.limit)
      ? Math.min(6, Math.max(4, Math.floor(s.limit)))
      : 4;
  return {
    ...instance,
    version: 2,
    settings: { title: flatTitle },
    blocks: collectionId
      ? [
          {
            // Deterministic id keeps the migration idempotent across reads.
            id: `${instance.id}-collection-1`,
            type: "collection",
            visible: true,
            settings: {
              collection: collectionId,
              limit,
              kind: "image",
              image: "",
              slider: "",
            },
          },
        ]
      : [],
  };
}

/**
 * The Figma "Top Collections" section: an editable heading, then one row per
 * collection block — a feature panel on the left (an image, a saved slider,
 * or the collection's own promo) with a shelf of product cards beside it.
 */
export const featuredCollection: SectionDefinition = {
  type: "featured-collection",
  version: 2,
  category: "products",
  suggested: true,
  fields: [{ key: "title", type: "text", default: "Top Collections" }],
  blocks: [
    {
      type: "collection",
      max: 6,
      fields: [
        { key: "collection", type: "collection" },
        // Cards beside the panel — the row's shelf size.
        { key: "limit", type: "number", default: 4, min: 4, max: 6 },
        // The feature slot: a static image OR a saved slider, like a hero
        // grid cell. The dedicated editor drives these three as one control.
        {
          key: "kind",
          type: "select",
          options: ["image", "slider"],
          default: "image",
        },
        { key: "image", type: "image" },
        { key: "slider", type: "slider", default: "" },
      ],
    },
  ],
  starter: { blocks: [{ type: "collection" }, { type: "collection" }] },
  migrate: migrateFeaturedCollectionV1,
  Render: ({ settings, blocks, ctx }) => (
    <CollectionRows
      locale={ctx.locale}
      title={settings.title as string}
      rows={blocks
        .filter((block) => block.visible)
        .map((block) => readRow(block.settings))}
      emptyState={sectionEmptyState(ctx, {
        title: "Featured Collection",
        hint: "Add a collection block and pick a collection for each row — one that is active and published to the online store.",
      })}
    />
  ),
  Skeleton: () => (
    <section className="py-6 lg:py-10" aria-hidden>
      <div className="container mx-auto space-y-10 px-4 lg:space-y-14">
        <div className="mx-auto h-8 w-56 animate-pulse rounded-md bg-accent" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_repeat(4,minmax(0,2fr))]">
          <div className="min-h-[18rem] animate-pulse rounded-2xl bg-accent lg:min-h-0 lg:h-full" />
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="hidden animate-pulse rounded-2xl bg-accent lg:block lg:aspect-[2/3]"
            />
          ))}
        </div>
      </div>
    </section>
  ),
};
