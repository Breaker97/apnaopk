import type {
  BlockInstance,
  SectionInstance,
} from "@/lib/storefront/sections/types";

/**
 * The PURE half of preset binding: given pools of catalogue content, fill a
 * starter layout's empty slots. Split from `preset-content.ts` (which
 * gathers the pools through the server-only cached fetchers) so the SAME
 * binding rules run everywhere a starter is applied:
 *
 * - theme activation (pools from the storefront fetchers), and
 * - the seed script (pools from the demo data it just created — the cached
 *   fetchers don't run outside the Next.js runtime).
 *
 * The rules themselves are unchanged: only EMPTY slots are filled; a preset
 * that ships an explicit value, and anything the admin configured, is left
 * exactly as it is. Never mutates the input.
 */

/** Chips in the header's tag row — the design shows about half a dozen. */
export const TAG_POOL = 6;
/** How long a seeded deal strip runs before the merchant sets its own date. */
const STARTER_DEAL_WINDOW_DAYS = 7;

export interface PresetProduct {
  id: string;
  image: string;
  slug: string;
}

export interface PresetCategory {
  name: string;
  slug: string;
}

/** Catalogue content available for binding, however it was gathered. */
interface PresetPools {
  collectionIds: string[];
  products: PresetProduct[];
  categories: PresetCategory[];
}

export interface PresetContent {
  /** Applies the bindings to one preset's sections. Never mutates the input. */
  fill: (sections: SectionInstance[]) => SectionInstance[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A store with nothing to bind still activates — every slot stays empty. */
const EMPTY_PRESET_CONTENT: PresetContent = {
  fill: (sections) => sections,
};

export function createPresetBinder({
  collectionIds,
  products,
  categories,
}: PresetPools): PresetContent {
  if (
    collectionIds.length === 0 &&
    products.length === 0 &&
    categories.length === 0
  ) {
    return EMPTY_PRESET_CONTENT;
  }

  return {
    fill: (sections) => {
      // Cursors, not indexes into the section list: each shelf takes the
      // NEXT unused collection so three shelves show three different ones,
      // and image slots walk the catalogue instead of repeating one photo.
      let collectionCursor = 0;
      let productCursor = 0;
      const nextCollection = () =>
        collectionIds.length === 0
          ? ""
          : (collectionIds[collectionCursor++ % collectionIds.length] ?? "");
      const nextProduct = (): PresetProduct | null =>
        products.length === 0
          ? null
          : (products[productCursor++ % products.length] ?? null);

      /** Fill a block's image slot, and link it to the product it shows. */
      const fillImageBlock = (block: BlockInstance): BlockInstance => {
        if (text(block.settings.image)) return block;
        const product = nextProduct();
        if (!product) return block;
        return {
          ...block,
          settings: {
            ...block.settings,
            image: product.image,
            ...(text(block.settings.link) || !product.slug
              ? {}
              : { link: `/products/${product.slug}` }),
          },
        };
      };

      return sections.map((section) => {
        switch (section.type) {
          case "featured-collection": {
            if (text(section.settings.collectionId)) return section;
            const collectionId = nextCollection();
            if (!collectionId) return section;
            return {
              ...section,
              settings: { ...section.settings, collectionId },
            };
          }

          case "slideshow": {
            // A slide gets artwork AND the product binding behind it, so the
            // hero's price element has something real to resolve.
            const blocks = (section.blocks ?? []).map((block) => {
              if (text(block.settings.image)) return block;
              const product = nextProduct();
              if (!product) return block;
              return {
                ...block,
                settings: {
                  ...block.settings,
                  image: product.image,
                  ...(text(block.settings.productId)
                    ? {}
                    : { productId: product.id, showPrice: true }),
                },
              };
            });
            const sideCards = ["One", "Two"].reduce<Record<string, unknown>>(
              (acc, slot) => {
                const key = `sideCard${slot}Image`;
                if (text(section.settings[key])) return acc;
                const product = nextProduct();
                if (!product) return acc;
                acc[key] = product.image;
                if (
                  !text(section.settings[`sideCard${slot}Link`]) &&
                  product.slug
                ) {
                  acc[`sideCard${slot}Link`] = `/products/${product.slug}`;
                }
                return acc;
              },
              {},
            );
            return {
              ...section,
              settings: { ...section.settings, ...sideCards },
              blocks,
            };
          }

          case "top-tags": {
            // The header's tag row is chrome, not catalogue: seed it from the
            // store's own departments so a themed header arrives populated
            // rather than as an empty strip the merchant has to discover.
            const blocks = section.blocks ?? [];
            if (categories.length === 0) return section;
            if (blocks.some((block) => text(block.settings.label))) {
              return section;
            }
            return {
              ...section,
              blocks: categories.slice(0, TAG_POOL).map((category, index) => ({
                id: blocks[index]?.id ?? `${section.id}-tag-${index + 1}`,
                type: "tag",
                visible: true,
                settings: {
                  label: category.name,
                  url: `/categories/${category.slug}`,
                },
              })),
            };
          }

          case "promotion-grid":
          case "image-gallery":
            return {
              ...section,
              blocks: (section.blocks ?? []).map(fillImageBlock),
            };

          case "countdown-offer": {
            // A deadline strip with no deadline renders NOTHING, so a
            // starter that ships one unset applies as a missing section.
            // A preset cannot name a date at authoring time; binding can.
            const next: Record<string, unknown> = {};
            if (!text(section.settings.endsAt)) {
              next.endsAt = new Date(
                Date.now() + STARTER_DEAL_WINDOW_DAYS * 86_400_000,
              ).toISOString();
            }
            if (!text(section.settings.image)) {
              const product = nextProduct();
              if (product) next.image = product.image;
            }
            if (Object.keys(next).length === 0) return section;
            return { ...section, settings: { ...section.settings, ...next } };
          }

          // The coupon strip is already the dark image-backed design; an
          // unfilled image just leaves it a flat panel, so it binds like the
          // promo banner does.
          case "coupon-banner":
          case "promotion-banner": {
            if (text(section.settings.image)) return section;
            const product = nextProduct();
            if (!product) return section;
            return {
              ...section,
              settings: { ...section.settings, image: product.image },
            };
          }

          default:
            return section;
        }
      });
    },
  };
}
