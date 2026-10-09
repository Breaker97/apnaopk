import "server-only";

import { ApiError, ConflictError, NotFoundError, ValidationError } from "@/lib/api/errors";
import type { AuditContext } from "@/lib/audit";
import {
  assertProductPreorderAllowed,
  type PreorderVendorAccess,
} from "@/lib/orders/preorder-gating";
import { storeCanCollectDeferredBalance } from "@/lib/payments/deferred-balance";
import { runProductAfterSave, type ProductSaveSide } from "@/lib/products/product-after-save";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import { Product } from "@/models";
import type { ISettingsData } from "@/models/settings.model";

/**
 * The business app's quick edit of a product (PATCH /products/{id}): its
 * price, compare-at price and status, or its variants' prices. A narrow save
 * beside the website's editor (the product PUT), held to the same rules for
 * what it touches and followed by the same after-save
 * (./product-after-save.ts):
 *
 * - **The version.** The write is pinned to the `updatedAt` the change was
 *   made against: when anything moved the product since (another edit, a
 *   sale, a stock edit), nothing is written and the answer is 412. Never a
 *   silent last-writer-wins between two phones.
 * - **Price on request** (./quote-pricing.ts): the product shows no price, so
 *   its prices are not changed here (409, reason PRICE_ON_REQUEST); its
 *   status still is.
 * - **Variants**: a product with variants is priced per variant (400,
 *   VARIANT_PRICES); a variant must be the product's (400, UNKNOWN_VARIANT).
 * - **Pre-orders**: a seller's new price is judged against the store's
 *   pre-order limits exactly as the seller's product PUT judges it (a fixed
 *   deposit may not pass the price); the store's own operators are not, as
 *   on the admin PUT.
 * - **Settings → Products** gates what a save switches on (price on request,
 *   pre-orders, the format); a quick edit switches none of them on.
 * - **Stock policy**: untouched; prices and status do not move stock, and the
 *   after-save rederives every stock field from the product as stored.
 */

export interface QuickEditChanges {
  price?: number;
  /** `null` clears it. */
  compareAtPrice?: number | null;
  status?: string;
  variants?: Array<{ id: string; price?: number; compareAtPrice?: number | null }>;
}

type StoredVariant = { _id?: unknown; price?: number; preorder?: unknown };
type StoredProduct = ProductSaveSide & {
  _id: unknown;
  price?: number;
  priceOnRequest?: boolean | null;
  preorder?: unknown;
  variants?: StoredVariant[];
  updatedAt?: Date | null;
};

function refusal<E extends ApiError>(error: E, reason: string): E {
  error.details = { ...error.details, reason };
  return error;
}

/** The `updatedAt` a version names: milliseconds, "0" for a product never stamped. */
function storedAtFilter(versions: readonly string[]): Record<string, unknown> | null {
  const dates: Array<Date | null> = [];
  for (const version of versions) {
    if (version === "0") dates.push(null);
    else if (/^\d{1,15}$/.test(version)) dates.push(new Date(Number(version)));
  }
  return dates.length ? { updatedAt: { $in: dates } } : null;
}

function matchesVersion(updatedAt: Date | null | undefined, versions: readonly string[]): boolean {
  const current = updatedAt ? String(new Date(updatedAt).getTime()) : "0";
  return versions.includes(current);
}

function preconditionFailed(): ApiError {
  return new ApiError(
    "This product changed since it was read. Read it again before changing it.",
    412,
    "PRECONDITION_FAILED",
  );
}

export async function quickEditProduct(input: {
  productId: string;
  /** The product's reach for this caller (`productScopeFilter`). */
  scopeFilter: Record<string, unknown>;
  /** The versions `If-Match` named; the change goes through when one is current. */
  versions: readonly string[];
  changes: QuickEditChanges;
  settings: Pick<ISettingsData, "preorder" | "payment">;
  /** The seller making the change, held to the store's pre-order limits; absent for the store's operators. */
  seller?: PreorderVendorAccess | null;
  audit: AuditContext;
  defer: (task: () => Promise<unknown>) => void;
}): Promise<void> {
  const { productId, scopeFilter, versions, changes } = input;
  const filter = { _id: productId, ...scopeFilter };

  const existing = await Product.findOne(filter).lean<StoredProduct | null>();
  if (!existing) throw new NotFoundError("Product");
  // Cheap first: most stale changes are caught before any work.
  if (!matchesVersion(existing.updatedAt, versions)) throw preconditionFailed();

  const storedVariants = existing.variants ?? [];
  const pricing =
    changes.price !== undefined || changes.compareAtPrice !== undefined || Boolean(changes.variants?.length);
  if (pricing && isQuoteOnlyProduct(existing)) {
    throw refusal(
      new ConflictError("This product's price is on request. Change that on the website first."),
      "PRICE_ON_REQUEST",
    );
  }
  if ((changes.price !== undefined || changes.compareAtPrice !== undefined) && storedVariants.length > 0) {
    throw refusal(
      new ValidationError({ price: ["This product is priced per variant: send the prices in variants."] }),
      "VARIANT_PRICES",
    );
  }

  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ""> = {};
  if (changes.price !== undefined) $set.price = changes.price;
  if (changes.compareAtPrice === null) $unset.comparePrice = "";
  else if (changes.compareAtPrice !== undefined) $set.comparePrice = changes.compareAtPrice;
  if (changes.status !== undefined) $set.status = changes.status;

  const nextVariants = storedVariants.map((variant) => ({ ...variant }));
  for (const [position, change] of (changes.variants ?? []).entries()) {
    const index = storedVariants.findIndex((variant) => String(variant._id) === change.id);
    if (index < 0) {
      throw refusal(
        new ValidationError({ [`variants.${position}.id`]: ["Not a variant of this product."] }),
        "UNKNOWN_VARIANT",
      );
    }
    // By position: the write is pinned to the version read, so the array is
    // the one these indexes were found in.
    if (change.price !== undefined) {
      $set[`variants.${index}.price`] = change.price;
      nextVariants[index].price = change.price;
    }
    if (change.compareAtPrice === null) $unset[`variants.${index}.comparePrice`] = "";
    else if (change.compareAtPrice !== undefined) $set[`variants.${index}.comparePrice`] = change.compareAtPrice;
  }

  if (input.seller !== undefined) {
    // The seller's product PUT judges a price change against a stored
    // pre-order (a fixed deposit may not pass the new price), variant by
    // variant; what the change leaves alone is not judged.
    assertProductPreorderAllowed({
      product: {
        price: changes.price ?? existing.price,
        variants: nextVariants as never,
      },
      stored: existing as never,
      policy: input.settings.preorder,
      vendor: input.seller,
      storeCanCollectBalance: storeCanCollectDeferredBalance(input.settings.payment),
    });
  }

  if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
    throw new ValidationError("Send at least one change.");
  }

  const pinned = storedAtFilter(versions);
  const product = pinned
    ? await Product.findOneAndUpdate(
        { ...filter, ...pinned },
        { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
        { returnDocument: "after", runValidators: true },
      ).lean<StoredProduct | null>()
    : null;
  if (!product) {
    // Gone, or moved by a write that landed after the read.
    if (!(await Product.exists(filter))) throw new NotFoundError("Product");
    throw preconditionFailed();
  }

  await runProductAfterSave({
    productId: String(existing._id),
    before: existing,
    after: product,
    savedStatus: changes.status,
    audit: input.audit,
    defer: input.defer,
  });
}
