import "server-only";

import { Vendor } from "@/models/vendor.model";
import { ValidationError } from "@/lib/api/errors";
import { COD_COLLECTED_BY } from "@/config/app.config";
import { resolveCodCollector } from "@/lib/payments/cod-collection";
import { quantizeToCurrency } from "@/lib/intl/money";
import { checkoutCreditAvailable } from "@/lib/store-credit/store-credit";

/**
 * How much of a checkout the shopper's store credit pays (R8).
 *
 * What they hold in the order's currency, up to what is due now. Nothing for a
 * guest, nothing when they untick it, and nothing on a pre-order — its balance
 * is charged later, on its own terms. Refused, rather than quietly dropped,
 * where the shopper was shown it and it cannot be used: the page said the rest
 * was all they would pay.
 */
export async function checkoutStoreCredit(params: {
  /** The signed-in shopper; a guest holds no credit. */
  userId?: string | null;
  /** Unticked by the shopper. On by default. */
  useStoreCredit?: boolean;
  currency: string;
  cartId: unknown;
  /** What is due now, before any credit. */
  dueNow: number;
  hasPreorder: boolean;
  paymentMethod: string;
  /** The sellers whose consignments the order will have — for cash on delivery. */
  vendorIds?: string[];
  /** `settings.shipping.codCollectedBy`. */
  codCollectedByDefault?: string;
  /**
   * `checkoutCreditAvailable` for this shopper, currency and cart, when the
   * caller started it early: the checkout reads it alongside its product and
   * seller reads instead of after them. The hold re-checks the balance when
   * it is written, so an early read only decides how much to ask for.
   */
  available?: Promise<number> | null;
}): Promise<number> {
  const payingWithCredit = params.paymentMethod === "store_credit";
  if (!params.userId) {
    if (payingWithCredit) {
      throw new ValidationError({ paymentMethod: ["Sign in to pay with store credit"] });
    }
    return 0;
  }
  if (params.useStoreCredit === false && !payingWithCredit) return 0;
  if (params.hasPreorder) {
    if (payingWithCredit) {
      throw new ValidationError({
        paymentMethod: ["Store credit can't be used on pre-orders"],
      });
    }
    return 0;
  }

  const available = await (params.available ??
    checkoutCreditAvailable({
      customerId: params.userId,
      currency: params.currency,
      cartId: String(params.cartId),
    }));
  const credit = quantizeToCurrency(
    Math.min(available, Math.max(0, Number(params.dueNow) || 0)),
    params.currency,
  );
  if (!(credit > 0)) {
    if (payingWithCredit) {
      throw new ValidationError({
        paymentMethod: ["You have no store credit to pay with. Choose another way to pay."],
      });
    }
    return 0;
  }

  // The hosted card page is built from the order's lines and cannot show a
  // credit beside them — the store's card form can.
  if (params.paymentMethod === "card") {
    throw new ValidationError({
      paymentMethod: [
        "Store credit can't be used with this card payment. Untick store credit, or choose another way to pay.",
      ],
    });
  }
  // A seller whose own van takes the cash would pocket the part the store's
  // credit paid for.
  if (
    params.paymentMethod === "cod" &&
    (await sellersCollectCash(params.vendorIds || [], params.codCollectedByDefault))
  ) {
    throw new ValidationError({
      paymentMethod: [
        "Store credit can't be used with cash on delivery from this seller. Untick store credit, or choose another way to pay.",
      ],
    });
  }
  return credit;
}

/** Whether any seller on the order takes the cash at the door themselves. */
async function sellersCollectCash(
  vendorIds: string[],
  codCollectedByDefault?: string,
): Promise<boolean> {
  const ids = [...new Set(vendorIds.filter(Boolean))];
  if (ids.length === 0) return false;
  const vendors = await Vendor.find({ _id: { $in: ids } })
    .select("isDefault shipping.codCollectedBy")
    .lean<Array<{ isDefault?: boolean; shipping?: { codCollectedBy?: string } }>>();
  return vendors.some(
    (vendor) =>
      !vendor.isDefault &&
      resolveCodCollector({
        storeDefault: codCollectedByDefault,
        vendorPreference: vendor.shipping?.codCollectedBy,
      }) === COD_COLLECTED_BY.VENDOR,
  );
}
