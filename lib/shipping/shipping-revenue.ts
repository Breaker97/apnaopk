import { COD_COLLECTED_BY } from "@/config/app.config";

/**
 * Who earns a consignment's delivery charge.
 *
 * The rule is the one marketplaces run on: whoever pays to get the parcel to
 * the shopper keeps what the shopper paid for delivery. A vendor delivering
 * with their own fleet, or through their own courier account, bears that cost
 * and earns the charge. The store's courier — or a label the store bought on
 * its own carrier account — is the store bearing it, and the store keeps it.
 *
 * Until this existed the store kept every delivery charge, even on parcels a
 * vendor paid to send, while the same shipment paid a vendor differently
 * depending on how the shopper paid: a card order left them out of pocket, a
 * cash one they collected at the door let them keep it.
 *
 * Two facts decide it, both stored on the consignment so nothing is re-derived
 * from settings that may have changed since:
 *
 *  - `shippingRevenueTo`, frozen at checkout from who delivers — the same
 *    answer as who collects cash on delivery (`lib/cod-collection.ts`), which
 *    is "their own fleet" or "our courier". Absent means `platform`: every
 *    order written before this kept its delivery charge with the store, and
 *    reading it any other way would rewrite what vendors were already paid.
 *  - `platformLabelAt`, set while a label bought on the store's carrier
 *    account covers the parcel — the store paying for delivery after all.
 *
 * Deliberately free of `server-only` and of any import beyond the config
 * enums, so the payout engine and the ledger read the identical rule.
 */

export const SHIPPING_REVENUE_TO = {
  VENDOR: "vendor",
  PLATFORM: "platform",
} as const;

export type ShippingRevenueTo =
  (typeof SHIPPING_REVENUE_TO)[keyof typeof SHIPPING_REVENUE_TO];

export type ShippingRevenueSubOrder = {
  shippingRevenueTo?: string | null;
  platformLabelAt?: Date | string | null;
};

/** The stamp for a new consignment, from who was resolved to deliver it. */
export function resolveShippingRevenueTo(
  codCollectedBy: string | null | undefined,
): ShippingRevenueTo {
  return String(codCollectedBy || "") === COD_COLLECTED_BY.PLATFORM
    ? SHIPPING_REVENUE_TO.PLATFORM
    : SHIPPING_REVENUE_TO.VENDOR;
}

/** Whether this consignment's delivery charge is the vendor's. */
export function vendorEarnsShipping(
  sub: ShippingRevenueSubOrder | null | undefined,
): boolean {
  return (
    String(sub?.shippingRevenueTo || "") === SHIPPING_REVENUE_TO.VENDOR &&
    !sub?.platformLabelAt
  );
}
