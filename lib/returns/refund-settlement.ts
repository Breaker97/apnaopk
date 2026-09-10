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
 * Store credit is deliberately absent. It is the obvious fourth destination
 * and every marketplace offers it, but it needs a balance the shopper owns and
 * a way to spend it at checkout — neither exists in Storify yet, and an enum
 * value nothing can honour is worse than one that is missing.
 */

/**
 * Payment methods whose refunds no gateway can carry out.
 *
 * Orange Money is here for a different reason than COD: money genuinely moved,
 * but `om-webpay` publishes no refund API at all. Reversing one needs Orange's
 * separate Cashin / Money Transfer contract, which a web-payment merchant does
 * not automatically hold. So an Orange Money refund is pushed back from
 * Orange's merchant portal and recorded here — and because the destination is
 * a wallet, `mobile_money` below is exactly the shape the return form needs.
 */
const OUT_OF_BAND_METHODS = [
  "cod",
  "cash",
  "manual",
  "iotec",
  "orange_money",
  // MTN's Disbursements product does carry a programmatic refund, but it is a
  // separate subscription with separate credentials and production IP
  // whitelisting — none of which a Collections merchant automatically holds.
  // Out-of-band for v1; a Disbursements-backed branch in order-refund can
  // replace this entry later.
  "mtn_momo",
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
}): boolean {
  const method = String(order.paymentMethod || "").toLowerCase().trim();
  const channel = String(order.channel || "").toLowerCase().trim();
  if (channel === "pos") return true;
  return (OUT_OF_BAND_METHODS as readonly string[]).includes(method);
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
  if (account) {
    // Short numbers would be revealed rather than masked by showing four.
    parts.push(account.length > 4 ? `••••${account.slice(-4)}` : "••••");
  }

  return parts.length > 0 ? `${label} — ${parts.join(" ")}` : label;
}
