import { ValidationError } from "@/lib/api/errors";
import { canApplyPosDiscount } from "@/lib/access/rbac";
import {
  posSaleHasDiscount,
  type POSOrderDiscountInput,
  type POSOrderItemInput,
} from "@/lib/pos/order-totals";

/**
 * Refuse a till discount the seat may not give, or one given without a reason.
 *
 * Run by both routes that price a POS sale — the card intent and the order —
 * and before either takes money: a discount refused only at order creation
 * would leave a card already charged at the discounted price with no sale.
 */
export async function assertPosDiscountAllowed(
  user: Parameters<typeof canApplyPosDiscount>[0],
  sale: {
    items: Array<Pick<POSOrderItemInput, "lineDiscount">>;
    discount?: Pick<POSOrderDiscountInput, "value" | "reason"> | null;
  },
): Promise<void> {
  if (!posSaleHasDiscount(sale)) return;
  // A refusal of the sale, not of the session: a 403 stops the offline queue
  // from syncing anything behind this sale, where a 400 parks it for review.
  if (!(await canApplyPosDiscount(user))) {
    throw new ValidationError(
      "Only a seat that manages the POS can give a discount at the till",
    );
  }
  // What the audit trail and the finance reports will say this markdown was.
  if (
    Number(sale.discount?.value || 0) > 0 &&
    !String(sale.discount?.reason || "").trim()
  ) {
    throw new ValidationError("Choose a reason for the discount");
  }
}
