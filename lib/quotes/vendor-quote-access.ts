import "server-only";

import type { Types } from "mongoose";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { vendorQuoteMoves } from "@/lib/quotes/quote-status";
import type { AdminQuoteDetail, VendorQuoteView } from "@/lib/quotes/quotes";

/**
 * Who a vendor quote route is acting for, and what the vendor may see.
 *
 * The vendor always comes from the signed-in account, never from the request,
 * so no id in a URL or a body can point a route at another seller's quotes.
 */

/**
 * The store's switch (Vendors → Configuration): may vendors see the email and
 * phone of the shopper who asked? On unless the store turned it off — the
 * setting is read straight off the document, where an older store has none.
 */
function vendorsSeeQuoteContact(
  settings:
    | { vendorConfig?: { showQuoteContactToVendors?: boolean | null } | null }
    | null
    | undefined,
): boolean {
  return settings?.vendorConfig?.showQuoteContactToVendors !== false;
}

/**
 * The signed-in vendor's view of its quotes. Refuses a store with the
 * marketplace switched off (as every vendor route does) and a vendor that is
 * not approved.
 */
export async function requireVendorQuoteView(
  userId: string,
): Promise<VendorQuoteView & { vendorId: Types.ObjectId }> {
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
  const vendor = await requireApprovedVendorByUserId(userId);
  return {
    vendorId: vendor._id as Types.ObjectId,
    showContact: vendorsSeeQuoteContact(settings),
  };
}

type VendorMove = "canSendPrice" | "canWithdraw" | "canMarkLost" | "canReopen";

/**
 * Throw unless the vendor may make this move on this quote — the server half
 * of `vendorQuoteMoves`, which the screens read to decide what to offer.
 */
export function assertVendorQuoteMove(detail: AdminQuoteDetail, move: VendorMove) {
  const moves = vendorQuoteMoves(detail);
  if (moves[move]) return;

  if (moves.lockedByStore) {
    throw new ValidationError(
      "The store has taken over this quote, so only the store can change its price or close it.",
    );
  }
  const onOrder = detail.stage === "ordered" || detail.stage === "won";
  if (onOrder && move !== "canReopen") {
    throw new ValidationError(
      `This quote became order ${detail.order?.orderNumber ?? ""}. It can't change while that order stands.`,
    );
  }
  switch (move) {
    case "canSendPrice":
      throw new ValidationError("Reopen this quote before sending it a price.");
    case "canWithdraw":
      throw new ValidationError("There is no open price to withdraw.");
    case "canMarkLost":
      throw new ValidationError("This quote is already closed.");
    default:
      throw new ValidationError("Only a quote you closed can be reopened.");
  }
}
