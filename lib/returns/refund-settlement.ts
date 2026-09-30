/**
 * Where a refund goes when it cannot go back the way it came.
 *
 * A card refund has an obvious destination: the card. Cash on delivery has
 * none — nobody took a payment instrument, so there is nothing to reverse. Up
 * to now Storify answered that by returning `{ gatewayCalled: false }` and
 * marking the return `manual_required`, which is a note to a human that reads
 * "you sort it out". Nowhere did it record WHERE the money should go, and
 * nothing ever moved the return off `manual_required`, so a shop could not
 * answer the only question that matters afterwards: have we actually paid this
 * person, and if not, to what account?
 *
 * These are the rules for that, kept pure and dependency-free so the return
 * form, the API and the admin screen all read the same ones.
 *
 * Store credit is not one of these destinations. It is chosen per refund, on
 * the refund itself (R8, `lib/store-credit/refund-to-credit.ts`), and is on
 * the shopper's account the moment it is given — nothing is left to send.
 */

import {
  isPlatformSettled,
  type PaymentCustodyOrder,
} from "@/lib/payments/payment-custody";
import type { CodCustodySubOrder } from "@/lib/payments/cod-collection";

/**
 * The payment methods a gateway can refund: each has its own branch in
 * `refundOrderPayment` (lib/orders/order-refund.ts). An ALLOWLIST on purpose.
 *
 * It used to be the other way round, a list of the methods that must be paid
 * back by hand (cod, cash, manual, the mobile-money ones). Any other name fell
 * through to the gateway code and threw, so an admin-created order recorded
 * as "bank_transfer" could not be refunded at all, and cancelling a paid
 * consignment on one recorded no refund.
 *
 * Everything else is paid back by hand, including:
 * - Orange Money and ioTec, whose collection APIs have no refund call;
 * - MTN MoMo, whose refund lives in the separate Disbursements product, a
 *   separate subscription a Collections merchant does not automatically hold.
 *
 * Adding a gateway branch there means adding its method here.
 */
export const GATEWAY_REFUND_METHODS = [
  "card",
  "stripe",
  "paypal",
  "razorpay",
  "paystack",
  "pesapal",
] as const;

/**
 * Does a refund on this order have to be paid by hand?
 *
 * The same test `refundOrderPayment` applies before it decides not to call a
 * gateway — kept here so the return form can ask it too, without importing
 * every payment SDK to find out.
 */
export function refundSettlesOutOfBand(order: {
  paymentMethod?: string | null;
  channel?: string | null;
  stripePaymentIntentId?: string | null;
}): boolean {
  const method = String(order.paymentMethod || "").toLowerCase().trim();
  const channel = String(order.channel || "").toLowerCase().trim();
  // A register sale is paid by hand — except a card taken through the store's
  // Stripe account, which Stripe can give back. Treating that one as cash
  // recorded the refund and sent nothing, and a refund then made from the
  // Stripe dashboard was booked a second time.
  if (channel === "pos") {
    return !(
      method === "card" && String(order.stripePaymentIntentId || "").trim()
    );
  }
  // No method at all is not "paid by hand": it is an order nobody can say
  // anything about, and the gateway path refuses it loudly rather than
  // recording a refund no one will send.
  if (!method) return false;
  return !(GATEWAY_REFUND_METHODS as readonly string[]).includes(method);
}

/**
 * Who actually has to hand the money back.
 *
 * On nearly every order it is the store: the shopper paid a gateway the store
 * owns, and the store refunds it. On a cash-on-delivery sale the vendor
 * delivered with their own van and took the notes at the door — the store
 * never held a penny of it. The ledger has always known this and posts such a
 * refund accordingly: it reverses the COMMISSION the vendor owes and posts no
 * cash out, because no cash of the store's is going anywhere.
 *
 * What nothing said was the other half of it — that the vendor is the one who
 * has to pay the shopper. The return sat on `manual_required` addressed to an
 * admin who was never holding the money, and a store that dutifully sent the
 * transfer was out of pocket for a sale it had only ever taken commission on.
 *
 * Decided per consignment, and narrowly: `vendor` only where the money is
 * KNOWN to have gone to them — a cash-on-delivery sale their own van
 * collected, which the order records as a fact (`codCollectedBy`). Custody is
 * asked of `isPlatformSettled`, the rule the ledger posts by, so the two can
 * never disagree about whose money it was.
 *
 * Deliberately not every order that rule calls self-collected. It answers "did
 * the money reach the platform", and it is an allowlist that treats an
 * unrecognised method as the seller's — right for a payout, where the failure
 * is withholding money until someone asks. Here the failure runs the other
 * way: an admin-recorded bank transfer is money the STORE banked, and reading
 * the allowlist's silence as "the seller has it" would tell that seller to
 * refund a shopper out of their own pocket. So anything short of cash in their
 * hand stays the store's to send, exactly as it is today.
 */
export const REFUND_PAYERS = ["platform", "vendor"] as const;

export type RefundPayer = (typeof REFUND_PAYERS)[number];

/** The order fields the payer question reads — loose, so a lean doc fits. */
type RefundPayerOrder = PaymentCustodyOrder & {
  subOrders?: Array<CodCustodySubOrder & { vendorId?: unknown }> | null;
};

/**
 * Whose money a return's refund comes out of.
 *
 * `platform` for everything that is not one seller's own cash sale — including
 * an order with no consignment for the vendor, which is an order this cannot
 * answer for and must not guess about. Absent or unrecognised, every caller
 * treats it as `platform`, which is exactly what the whole system did before
 * this existed.
 */
export function resolveRefundPayer(params: {
  order: RefundPayerOrder;
  /** The vendor whose goods are coming back; absent for the store's own. */
  vendorId?: unknown;
}): RefundPayer {
  const vendorId = String(params.vendorId || "").trim();
  if (!vendorId) return "platform";

  const subOrder = (params.order.subOrders || []).find(
    (candidate) => String(candidate?.vendorId || "") === vendorId,
  );
  if (!subOrder) return "platform";

  // Cash at the door, and this consignment's own door: a split order can have
  // the platform's courier on one parcel and the seller's van on another.
  if (String(params.order.paymentMethod || "").toLowerCase().trim() !== "cod") {
    return "platform";
  }
  return isPlatformSettled(params.order, subOrder) ? "platform" : "vendor";
}

/**
 * A return as a seller may see it.
 *
 * The shopper's refund account — holder name and full account number — only
 * when the seller is the one sending the refund. The vendor screens used to
 * receive it for every return in their queue, including the ones the store
 * pays, where the seller has no use for a shopper's bank details at all.
 */
export function withoutRefundDestinationUnlessPayer<
  T extends { refundPayer?: unknown; refundDestination?: unknown },
>(returnRequest: T): T {
  if (String(returnRequest.refundPayer || "") === "vendor") return returnRequest;
  if (!returnRequest.refundDestination) return returnRequest;
  const { refundDestination: _hidden, ...rest } = returnRequest;
  void _hidden;
  return rest as T;
}

/** One seller's part of a refund they hold the cash for. */
export type VendorHeldRefundShare = { vendorId: string; amount: number };

/**
 * The part of an order-screen refund each seller holds the cash for.
 *
 * A return asks `resolveRefundPayer` when it is opened; a refund sent from the
 * order screen never asked at all. On a cash-on-delivery sale the seller's own
 * van collected, it went on the store's "to send by hand" list while the books
 * posted it as the seller's refund — commission reversed, no cash out — and
 * the seller was never told. The store paid the shopper from its own bank, the
 * seller kept the cash, and their commission bill went down as well.
 *
 * Read off the refund's own split, consignment by consignment, by the same
 * rule a return uses. The store's own goods are never a seller's, however
 * their cash was taken. Empty when the store holds all of it.
 */
export function vendorHeldRefundShares(params: {
  order: RefundPayerOrder;
  allocation?: ReadonlyArray<{
    vendorId?: unknown;
    merchandise?: number | null;
    shipping?: number | null;
    tax?: number | null;
    duty?: number | null;
  }> | null;
  /** The store's own vendor records — see `getDefaultVendorIds`. */
  ownVendorIds?: ReadonlySet<string>;
}): VendorHeldRefundShare[] {
  const owed = new Map<string, number>();
  for (const share of params.allocation || []) {
    const vendorId = String(share?.vendorId || "").trim();
    if (!vendorId || params.ownVendorIds?.has(vendorId)) continue;
    if (resolveRefundPayer({ order: params.order, vendorId }) !== "vendor") continue;
    const amount = [share.merchandise, share.shipping, share.tax, share.duty].reduce<number>(
      (sum, part) => sum + Math.max(0, Number(part) || 0),
      0,
    );
    if (amount > 0) owed.set(vendorId, (owed.get(vendorId) || 0) + amount);
  }
  // The parts were each quantized when the split was made, so their sum is.
  return Array.from(owed, ([vendorId, amount]) => ({
    vendorId,
    amount: Number(amount.toFixed(6)),
  }));
}

export const REFUND_DESTINATION_METHODS = [
  "bank_transfer",
  "mobile_money",
  "cash",
] as const;

type RefundDestinationMethod =
  (typeof REFUND_DESTINATION_METHODS)[number];

export interface RefundDestination {
  method: RefundDestinationMethod;
  /** Whose account it is — banks reject transfers that do not match. */
  accountName?: string;
  /** Account or wallet number. */
  accountNumber?: string;
  /** The bank, or the mobile money operator. */
  provider?: string;
  note?: string;
}

/**
 * A destination as it arrives — from a form, a request body, a stored document.
 *
 * `method` is a plain string here because narrowing it is what the validator
 * below is FOR; demanding the narrow type at the door would mean every caller
 * casting an unvalidated value into it first.
 */
export type RefundDestinationInput = Omit<Partial<RefundDestination>, "method"> & {
  method?: string;
};

/** What each destination needs before anyone can actually send money to it. */
const REQUIRED_FIELDS: Record<
  RefundDestinationMethod,
  Array<keyof RefundDestination>
> = {
  bank_transfer: ["accountName", "accountNumber", "provider"],
  mobile_money: ["accountNumber", "provider"],
  // Handed over in person, so there is nothing to collect in advance.
  cash: [],
};

export function getRefundDestinationLabel(method: string): string {
  const labels: Record<string, string> = {
    bank_transfer: "Bank transfer",
    mobile_money: "Mobile money",
    cash: "Cash in person",
  };
  return labels[method] || method;
}

export function getRefundDestinationRequiredFields(
  method: string,
): Array<keyof RefundDestination> {
  return REQUIRED_FIELDS[method as RefundDestinationMethod] ?? [];
}

/**
 * The problems with a destination, as messages a shopper can act on.
 *
 * Returns an empty array when it is usable. Collected rather than thrown on
 * the first failure so a form can mark every missing field at once instead of
 * revealing them one submission at a time.
 */
export function validateRefundDestination(
  destination: RefundDestinationInput | null | undefined,
): string[] {
  if (!destination || !destination.method) {
    return ["Choose where the refund should be sent"];
  }

  const method = String(destination.method).trim() as RefundDestinationMethod;
  if (!(REFUND_DESTINATION_METHODS as readonly string[]).includes(method)) {
    return ["Choose where the refund should be sent"];
  }

  const labels: Record<string, string> = {
    accountName: "account holder's name",
    accountNumber: method === "mobile_money" ? "mobile money number" : "account number",
    provider: method === "mobile_money" ? "mobile money provider" : "bank name",
  };

  return REQUIRED_FIELDS[method]
    .filter((field) => !String(destination[field] || "").trim())
    .map((field) => `Enter the ${labels[field] || String(field)}`);
}

/**
 * Whether a hand-paid refund can be recorded against this return right now.
 *
 * Returns the reason it cannot, or null when it can. Two things make the claim
 * meaningless: there is no refund to have paid, or the refund that exists was
 * carried by a gateway and so was never anybody's to send. Recording a payment
 * against either would put a settlement reference on money that moved by
 * itself, and the shop would have no way to tell the two apart later.
 */
export function checkManualSettlement(params: {
  /** Amount being refunded in this same request; 0 when none. */
  refundingNow: number;
  /** What this return had already refunded before this request. */
  alreadyRefunded: number;
  /**
   * Whether the refund issued in THIS request went through a gateway.
   * Undefined when no refund is being issued now.
   */
  gatewayCalledNow?: boolean;
  /** The return's refund status before this request. */
  refundStatus?: string | null;
}): string | null {
  const refundingNow = Number(params.refundingNow) || 0;
  const alreadyRefunded = Number(params.alreadyRefunded) || 0;

  if (refundingNow <= 0 && alreadyRefunded <= 0) {
    return "There is no refund on this return to record a payment for";
  }

  const settlingNow =
    refundingNow > 0
      ? params.gatewayCalledNow === false
      : String(params.refundStatus || "") === "manual_required";

  if (!settlingNow) {
    return "This refund was sent by the payment provider, so there is no manual payment to record";
  }
  return null;
}

/**
 * The destination as it is safe to show back — the account number reduced to
 * its last four digits.
 *
 * Shown to the shopper so they can confirm the money is going somewhere they
 * recognise, and to the admin so they can tell two returns apart, without
 * either screen carrying the full number around.
 */
export function describeRefundDestination(
  destination: RefundDestinationInput | null | undefined,
): string {
  if (!destination?.method) return "Not provided";

  const label = getRefundDestinationLabel(String(destination.method));
  if (destination.method === "cash") return label;

  const parts: string[] = [];
  if (destination.provider) parts.push(String(destination.provider).trim());

  const account = String(destination.accountNumber || "").trim();
  if (account) parts.push(maskAccountNumber(account));

  return parts.length > 0 ? `${label} — ${parts.join(" ")}` : label;
}

export function maskAccountNumber(account: string): string {
  // Short numbers would be revealed rather than masked by showing four.
  return account.length > 4 ? `••••${account.slice(-4)}` : "••••";
}

/**
 * A return as the people who do not send its refund see it: the shopper's
 * account number cut to its last four digits. Money no gateway can carry back
 * is sent by the store's admin; a vendor or a staff member only needs to
 * recognise the account, and every screen already shows it that way.
 */
export function withMaskedRefundAccount<
  T extends { refundDestination?: RefundDestinationInput | null },
>(returnRequest: T): T {
  const destination = returnRequest.refundDestination;
  const account = String(destination?.accountNumber || "").trim();
  if (!destination || !account) return returnRequest;
  return {
    ...returnRequest,
    refundDestination: { ...destination, accountNumber: maskAccountNumber(account) },
  };
}
