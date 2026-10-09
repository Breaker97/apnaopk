import "server-only";

import { auditUpdate, type AuditContext } from "@/lib/audit";
import { releaseBoostInventoryIfProductWentDark } from "@/lib/boosts/boosts";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { syncProductCategory } from "@/lib/catalog/categories";
import {
  syncProductCollections,
  updateAllCollectionProductCounts,
} from "@/lib/catalog/collections";
import { markForMetaCatalog } from "@/lib/meta-catalog/mark-later";
import { notifyPreorderWaitlistsForProduct } from "@/lib/orders/preorder-waitlist";
import { deleteRemovedProductDigitalFiles } from "@/lib/products/digital-assets";
import { moveOpenQuotesWithProduct } from "@/lib/quotes/quote-ownership";
import { syncProductAggregates } from "@/models/product.model";

/**
 * What a product save does once the product is written: the website's editor
 * (the vendor and admin product PUT) and the business app's quick edit
 * (./product-quick-edit.ts) alike, so a price changed from a phone leaves the
 * store exactly as the same change made in the editor does.
 *
 * In this order:
 * 1. the derived fields `$set` cannot keep (price and compare-at ranges, the
 *    variant stock roll-up, the stock policy, the search block), which also
 *    moves the product's `updatedAt` once more;
 * 2. the private files the save detached, removed (best-effort);
 * 3. the collections the product joined or left, and their counts;
 * 4. the old and new category's product counts, and — when the product
 *    changed sellers — its open quote requests, which go with it;
 * 5. a status change recounts the automated collections, without waiting;
 * 6. a product that just went dark gives its booked sponsored days back;
 * 7. the Activity Log's row;
 * 8. the storefront's copies of the product, under both slugs;
 * 9. the Meta catalog's live sync, when it is on;
 * 10. after the answer: shoppers waiting for a pre-order place, since a raised
 *    limit frees places that no released reservation announces.
 */

/**
 * One side of a save: the product as it was before it (what each step
 * compares against), or as the write returned it (its category may be
 * populated). The whole document either way: a list left out (the files) is
 * read as "not changed", never as "emptied".
 */
export type ProductSaveSide = Record<string, unknown> & {
  slug?: string | null;
  status?: string;
  category?: unknown;
  collectionIds?: unknown[] | null;
  digitalAssets?: { storageKey?: string }[] | null;
  publishing?: { onlineStore?: boolean } | null;
};

function categoryIdOf(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "object" && (value as { _id?: unknown })._id) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}

export async function runProductAfterSave(input: {
  productId: string;
  before: ProductSaveSide;
  after: ProductSaveSide;
  /** The status this save wrote, when it wrote one. */
  savedStatus?: unknown;
  audit: AuditContext;
  /** Runs work once the answer is sent: the web's `afterResponse`, the app's `defer`. */
  defer: (task: () => Promise<unknown>) => void;
  strictCleanup?: boolean;
}) {
  const { productId: id, before, after, savedStatus, defer } = input;

  await syncProductAggregates(id);

  // An orphaned object must never fail the merchant's save.
  await deleteRemovedProductDigitalFiles(
    before.digitalAssets,
    after.digitalAssets,
    { strict: input.strictCleanup },
  );

  await syncProductCollections(
    id,
    (before.collectionIds || []).map(String),
    (after.collectionIds || []).map(String),
  );

  await syncProductCategory(
    categoryIdOf(before.category),
    categoryIdOf(after.category),
  );

  // A product handed to another seller takes its open quote requests along,
  // so the new seller answers them and the old one stops seeing them.
  await moveOpenQuotesWithProduct(id, before.vendorId, after.vendorId);

  // Which products an automated collection matches depends on their status.
  if (savedStatus && savedStatus !== before.status) {
    updateAllCollectionProductCounts().catch((err) =>
      console.error("Failed to update collection counts:", err),
    );
  }

  // A booked position whose product just went dark burns a GLOBAL rung
  // nobody else can buy for the rest of the booking, so the future days go
  // back on the calendar now rather than at expiry. Awaited: the answer
  // carries what was released, and the caller has just been warned about it.
  const boostReleases = await releaseBoostInventoryIfProductWentDark(
    id,
    before,
    after,
  );

  await auditUpdate(input.audit, "product", id, before, after);

  revalidateProductContent({ slugs: [before.slug, after.slug] });

  await markForMetaCatalog([id]);

  // Best-effort: the daily sweep catches a miss.
  defer(() => notifyPreorderWaitlistsForProduct(String(id)));

  return { boostReleases };
}
