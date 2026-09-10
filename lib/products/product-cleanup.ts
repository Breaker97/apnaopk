import { BoostCampaign, Cart, Coupon, Review, Wishlist } from "@/models";
import { NON_TERMINAL_BOOST_CAMPAIGN_STATUSES } from "@/models/boostCampaign.model";
import { cancelBoostCampaign } from "@/lib/boosts/boosts";
import { BOOST_CANCEL_REASON } from "@/config/app.config";

/**
 * A deleted product cannot render, so any booking still open for it is dead
 * money. Cancelling here releases every future day back onto the ladder and
 * notifies the vendor immediately; the cron sweep is only the belt-and-braces
 * for products removed some other way (a direct DB delete, a bulk script).
 *
 * `scheduled` is in the list because it is now the common case: a booking made
 * six weeks out has consumed no day yet, and leaving it behind would hold the
 * rung against a product that no longer exists — inventory nothing can resell.
 */
async function cancelBoostsForDeletedProduct(productId: string) {
  const live = await BoostCampaign.find({
    productId,
    status: { $in: NON_TERMINAL_BOOST_CAMPAIGN_STATUSES },
  })
    .select("_id")
    .lean<Array<{ _id: unknown }>>();
  for (const row of live) {
    await cancelBoostCampaign(
      String(row._id),
      BOOST_CANCEL_REASON.PRODUCT_DELETED,
    );
  }
}

/**
 * Remove every cross-collection reference to a hard-deleted product.
 *
 * Without this, deleting a product leaves orphaned reviews (admin review list
 * populates a null product), dead wishlist/cart entries, and coupons whose
 * applicable/excluded lists point at a nonexistent ObjectId. Orders are
 * intentionally untouched — they are historical snapshots.
 *
 * Best-effort by design: each cleanup runs independently so one failure never
 * blocks the delete or the other cleanups; failures are logged for follow-up.
 */
export async function cleanupDeletedProductReferences(
  productId: string,
): Promise<void> {
  const results = await Promise.allSettled([
    Review.deleteMany({ productId }),
    Wishlist.updateMany({}, { $pull: { items: { productId } } }),
    Cart.updateMany({}, { $pull: { items: { productId } } }),
    Coupon.updateMany(
      {},
      {
        $pull: {
          applicableProducts: productId,
          excludedProducts: productId,
        },
      },
    ),
    cancelBoostsForDeletedProduct(productId),
  ]);

  const labels = ["reviews", "wishlists", "carts", "coupons", "boosts"];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(
        `Failed to clean up ${labels[index]} for deleted product ${productId}:`,
        result.reason,
      );
    }
  });
}
