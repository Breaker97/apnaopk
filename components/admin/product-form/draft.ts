/**
 * What the Add product form keeps as a local draft (hooks/use-local-draft.ts)
 * and what counts as "unsaved" beside react-hook-form's own dirty flag.
 *
 * The form's values live in react-hook-form, but the gallery, the digital
 * files, the options and variants and the per-location stock are plain React
 * state next to it. A leave guard that
 * watched only the form would let a product with ten photos and forty
 * variants go without a word, so both sets are covered here.
 */
import type { ProductOption, ProductVariant } from "@/components/admin/variants-manager";
import type { LocationInventory } from "@/types";
import type { DigitalAssetItem, DigitalPreviewItem } from "./digital-files-card";
import type { ProductFormData, ProductFormMediaItem } from "./schema";

/** Bumped when the shape of a stored draft changes; older copies are dropped. */
export const PRODUCT_DRAFT_VERSION = 1;

/** The product's state that lives outside react-hook-form. */
export interface ProductFormExtras {
  media: ProductFormMediaItem[];
  digitalAssets: DigitalAssetItem[];
  digitalDownloadLimit: number;
  digitalPreview: DigitalPreviewItem | null;
  options: ProductOption[];
  variants: ProductVariant[];
  locationInventory: LocationInventory[];
}

export interface ProductDraft {
  form: Partial<ProductFormData>;
  extras: ProductFormExtras;
}

export const EMPTY_EXTRAS: ProductFormExtras = {
  media: [],
  digitalAssets: [],
  digitalDownloadLimit: 0,
  digitalPreview: null,
  options: [],
  variants: [],
  locationInventory: [],
};

/**
 * Per-location stock without its empty rows. The form seeds a row of 0 for
 * every location on its own (and a variant keeps one per location); those are
 * not something the user entered, so a row at 0 counts as no row.
 */
function stockRows<T extends { locationId: unknown; quantity?: unknown }>(rows: T[] | undefined) {
  return (rows ?? [])
    .filter((row) => Number(row.quantity) !== 0)
    .map((row) => ({ locationId: String(row.locationId), quantity: Number(row.quantity) }))
    .sort((a, b) => a.locationId.localeCompare(b.locationId));
}

/**
 * A string that is equal for two states exactly when the user would see the
 * same product in both: compared with the state the form started from to know
 * whether anything outside react-hook-form was changed.
 */
export function extrasFingerprint(extras: ProductFormExtras): string {
  return JSON.stringify({
    ...extras,
    locationInventory: stockRows(extras.locationInventory),
    variants: extras.variants.map((variant) => ({ ...variant, locationInventory: stockRows(variant.locationInventory) })),
  });
}

export const EMPTY_EXTRAS_FINGERPRINT = extrasFingerprint(EMPTY_EXTRAS);

/** Where this person's Add product draft lives: one per signed-in user and per dashboard. */
export function productDraftKey(area: "admin" | "staff" | "vendor", userId: string): string {
  return `storify:product-draft:${area}:${userId}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const records = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);

/** A file that was still on its way (or inlined) when the copy was made can't be shown again. */
const isKeptUrl = (url: unknown): url is string => typeof url === "string" && url.length > 0 && !/^(blob|data):/i.test(url);

/**
 * The stored draft as the form can take it, or null when it can't be trusted
 * (another shape, hand-edited, cut short). Rows the form would choke on are
 * left out rather than failing the whole copy.
 */
export function validateProductDraft(data: unknown): ProductDraft | null {
  if (!isRecord(data) || !isRecord(data.form) || !isRecord(data.extras)) return null;
  const extras = data.extras;
  return {
    form: data.form as Partial<ProductFormData>,
    extras: {
      media: records(extras.media).filter(
        (item) => typeof item._id === "string" && isKeptUrl(item.url) && typeof item.position === "number",
      ) as unknown as ProductFormMediaItem[],
      digitalAssets: records(extras.digitalAssets).filter(
        (asset) => typeof asset._id === "string" && typeof asset.storageKey === "string",
      ) as unknown as DigitalAssetItem[],
      digitalDownloadLimit: typeof extras.digitalDownloadLimit === "number" ? extras.digitalDownloadLimit : 0,
      digitalPreview:
        isRecord(extras.digitalPreview) && isKeptUrl(extras.digitalPreview.url)
          ? (extras.digitalPreview as unknown as DigitalPreviewItem)
          : null,
      options: records(extras.options).filter(
        (option) => typeof option.id === "string" && typeof option.name === "string" && Array.isArray(option.values),
      ) as unknown as ProductOption[],
      variants: records(extras.variants).filter(
        (variant) => typeof variant.id === "string" && Array.isArray(variant.optionValues),
      ) as unknown as ProductVariant[],
      locationInventory: records(extras.locationInventory).filter(
        (row) => row.locationId != null && typeof row.quantity === "number",
      ) as unknown as LocationInventory[],
    },
  };
}

/**
 * The draft's values laid over the form's own defaults: a copy made before a
 * field existed still restores into a complete form. Objects merge, anything
 * else (lists included) is the draft's.
 */
export function mergeDraftForm<T extends object>(defaults: T | undefined, draft: Partial<T>): T {
  const merge = (base: unknown, over: unknown): unknown => {
    if (!isRecord(over)) return over === undefined ? base : over;
    const result: Record<string, unknown> = isRecord(base) ? { ...base } : {};
    for (const [key, value] of Object.entries(over)) result[key] = merge(result[key], value);
    return result;
  };
  return merge(defaults ?? {}, draft) as T;
}
