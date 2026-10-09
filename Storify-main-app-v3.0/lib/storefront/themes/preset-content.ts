import "server-only";

import { getStorefrontProductCards } from "@/lib/products/storefront-product-cards";
import { getStorefrontCategories } from "@/lib/storefront/storefront-categories";
import { getStorefrontCollections } from "@/lib/storefront/storefront-collections";
import {
  createPresetBinder,
  TAG_POOL,
  type PresetCategory,
  type PresetContent,
  type PresetProduct,
} from "./preset-binding";

/**
 * Bind a theme's starter layout to the store it is being applied to.
 *
 * Presets can only describe SHAPE — which sections, in which order, wearing
 * which variant. The slots that carry content (a collection shelf's
 * collection, a promo tile's artwork, a hero slide's product) have to come
 * from the store, and a preset that leaves them empty applies as a
 * half-built page: three collection shelves that render nothing, a bento of
 * blank tiles, a hero placeholder.
 *
 * This module is the SERVER half: it gathers the pools through the cached
 * storefront fetchers and hands them to the pure binder
 * (`preset-binding.ts`), which the seed script also uses with pools of its
 * own — the rules live in one place either way.
 */

/** Enough to cover the richest starter without over-fetching. */
const COLLECTION_POOL = 6;
const PRODUCT_POOL = 24;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function resolvePresetContent(): Promise<PresetContent> {
  const [collectionsResult, cards, categoriesResult] = await Promise.all([
    getStorefrontCollections({ page: 1, limit: COLLECTION_POOL }).catch(
      () => null,
    ),
    getStorefrontProductCards({ limit: PRODUCT_POOL }).catch(() => []),
    getStorefrontCategories({ flat: true, page: 1, limit: TAG_POOL }).catch(
      () => null,
    ),
  ]);

  const categories: PresetCategory[] = (
    (categoriesResult?.categories ?? []) as { name?: string; slug?: string }[]
  ).flatMap((category) => {
    const name = text(category.name);
    const slug = text(category.slug);
    return name && slug ? [{ name, slug }] : [];
  });

  const collectionIds = ((collectionsResult?.data ?? []) as { _id?: string }[])
    .map((collection) => text(collection._id))
    .filter(Boolean);

  const products: PresetProduct[] = cards.flatMap((card) => {
    const image = Array.isArray(card.images)
      ? text(card.images.find((entry) => typeof entry === "string" && entry))
      : "";
    const id = text(card._id);
    if (!image || !id) return [];
    return [{ id, image, slug: text(card.slug) }];
  });

  return createPresetBinder({ collectionIds, products, categories });
}
