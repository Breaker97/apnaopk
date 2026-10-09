import { ValidationError } from "@/lib/api/errors";

/**
 * What the product editor offers on this store — which formats a new product
 * may take, pre-orders, and "Price on request". Set in Settings → Products.
 *
 * Switching a feature off stops it being STARTED: the editor stops offering
 * it and the product APIs refuse to switch it on. It never changes a product
 * already using it. A pre-order that is selling keeps selling (shoppers have
 * paid deposits against it), a quote-only product keeps its quote button
 * (dropping it would put the placeholder price on sale), and a digital
 * product stays digital, since the format is fixed at creation. Such a product
 * can still switch the feature off; it just cannot switch it back on.
 *
 * Every flag defaults to on: an upgrade must not take a feature away from a
 * store that was using it.
 */
export interface ProductFeatures {
  /** A new product may be physical — shipped to the customer. */
  physical: boolean;
  /** A new product may be digital — a download or a service. */
  digital: boolean;
  /** Products may open a pre-order. Stored as `settings.preorder.enabled`. */
  preorders: boolean;
  /** Products may hide their price behind "Request a quote". */
  priceOnRequest: boolean;
}

type ProductFeatureSettings =
  | {
      catalog?: {
        physicalProducts?: boolean | null;
        digitalProducts?: boolean | null;
        priceOnRequest?: boolean | null;
      } | null;
      preorder?: { enabled?: boolean | null } | null;
    }
  | null
  | undefined;

export function resolveProductFeatures(
  settings: ProductFeatureSettings,
): ProductFeatures {
  const catalog = settings?.catalog;
  const digital = catalog?.digitalProducts !== false;
  return {
    // With both formats off no product could be created at all. The settings
    // save refuses that, and a document holding it anyway is read as
    // physical-only — the one format every store had before this setting.
    physical: catalog?.physicalProducts !== false || !digital,
    digital,
    preorders: settings?.preorder?.enabled !== false,
    priceOnRequest: catalog?.priceOnRequest !== false,
  };
}

/**
 * Refuse a catalog save that would leave no product format on. A save may send
 * only the keys it changes, so a key it leaves out keeps its stored value.
 */
export function assertCatalogKeepsAFormat(
  incoming: Record<string, unknown>,
  stored?: { physicalProducts?: boolean | null; digitalProducts?: boolean | null } | null,
): void {
  const isOn = (key: "physicalProducts" | "digitalProducts") =>
    key in incoming ? incoming[key] !== false : stored?.[key] !== false;
  if (!isOn("physicalProducts") && !isOn("digitalProducts")) {
    throw new ValidationError(
      "Keep at least one product type on — with neither physical nor digital products, no product could be created.",
    );
  }
}

type PreorderFlag = { enabled?: boolean | null } | null | undefined;
type VariantWithPreorder = { _id?: unknown; preorder?: PreorderFlag };

const switchesOn = (next: PreorderFlag, before: PreorderFlag) =>
  next?.enabled === true && before?.enabled !== true;

/**
 * Throw when a product save starts something this store has switched off.
 *
 * Judges only what the save switches ON. On an update, `product` holds the
 * fields being written and `stored` the product as it is: keeping a feature
 * that is already on, or switching it off, always passes — that is how a store
 * winds a feature down without breaking the listings still using it.
 */
export function assertProductFeaturesAllowed(params: {
  features: ProductFeatures;
  product: {
    shipping?: { isPhysicalProduct?: boolean | null } | null;
    priceOnRequest?: boolean | null;
    preorder?: PreorderFlag;
    variants?: VariantWithPreorder[] | null;
  };
  /** The product as stored. Omitted on create, where everything is new. */
  stored?: {
    priceOnRequest?: boolean | null;
    preorder?: PreorderFlag;
    variants?: VariantWithPreorder[] | null;
  } | null;
}): void {
  const { features, product, stored } = params;
  const errors: Record<string, string[]> = {};

  // The format is chosen once, at creation; an update that tries to change it
  // is refused separately (isProductFormatChange).
  if (!stored) {
    const physical = product.shipping?.isPhysicalProduct !== false;
    if (physical && !features.physical) {
      errors.shipping = [
        "Physical products are switched off for this store. Create a digital product, or turn physical products on in Settings → Products.",
      ];
    } else if (!physical && !features.digital) {
      errors.shipping = [
        "Digital products are switched off for this store. Create a physical product, or turn digital products on in Settings → Products.",
      ];
    }
  }

  if (
    !features.priceOnRequest &&
    product.priceOnRequest === true &&
    stored?.priceOnRequest !== true
  ) {
    errors.priceOnRequest = [
      "Price on request is switched off for this store. Turn it on in Settings → Products to hide a price behind a quote.",
    ];
  }

  if (!features.preorders) {
    const storedVariants = new Map(
      (stored?.variants ?? [])
        .filter((variant) => variant?._id)
        .map((variant) => [String(variant._id), variant]),
    );
    // A variant with no id is new, so it has nothing stored to keep.
    const variantStarts = (product.variants ?? []).some((variant) =>
      switchesOn(
        variant?.preorder,
        variant?._id ? storedVariants.get(String(variant._id))?.preorder : undefined,
      ),
    );
    if (switchesOn(product.preorder, stored?.preorder) || variantStarts) {
      errors[variantStarts ? "variants" : "preorder"] = [
        "Pre-orders are switched off for this store. Turn them on in Settings → Products to open a new one.",
      ];
    }
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
}
