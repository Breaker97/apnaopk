import "server-only";

import { getTranslations } from "next-intl/server";

/**
 * The words of returns for the shopper app, from the store's message
 * catalogue: the website's own labels for reasons, statuses and refund
 * destinations (`orders.returns.*`), each falling back to English where a
 * language lacks the key.
 */
export interface ReturnCopy {
  reason(code: string): string;
  status(status: string): string;
  refundStatus(status: string): string;
  method(method: string): string;
  field(method: string, key: string): { label: string; placeholder?: string };
  cashNote(): string;
  /** Why the shopper is asked where the refund goes, by how the order was paid. */
  whyDestination(paidWith: "cod" | "bank_transfer" | "counter" | "other"): string;
  /** Why an order cannot be returned now. */
  blocked(reason: "RETURN_WINDOW_CLOSED" | "FINAL_SALE" | "NOT_RETURNABLE" | "RETURNS_THROUGH_STORE"): string;
}

const REASONS: Record<string, string> = {
  wrong_size_or_variant: "Wrong size or variant",
  damaged_or_defective: "Damaged or defective",
  not_as_described: "Not as described",
  wrong_item_received: "Wrong item received",
  arrived_late: "Arrived late",
  changed_mind: "Changed my mind",
  other: "Other",
};

const STATUSES: Record<string, string> = {
  requested: "Requested",
  approved: "Approved",
  rejected: "Rejected",
  awaiting_shipment: "Awaiting shipment",
  in_transit: "In transit",
  received: "Received",
  inspected: "Inspected",
  refund_pending: "Refund pending",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
  closed: "Closed",
  cancelled: "Cancelled",
};

const REFUND_STATUSES: Record<string, string> = {
  not_required: "No refund due",
  pending: "Refund pending",
  processing: "Refund requested",
  succeeded: "Refunded",
  failed: "Refund failed",
  manual_required: "Refund being sent",
};

const METHODS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  mobile_money: "Mobile money",
  cash: "Cash in person",
};

const BLOCKED = {
  RETURN_WINDOW_CLOSED: "The return window for this order has closed.",
  FINAL_SALE: "These items were sold as final sale and cannot be returned.",
  NOT_RETURNABLE: "Nothing on this order can be returned right now.",
  RETURNS_THROUGH_STORE: "This store takes returns through its team. Contact the store to return an item.",
} as const;

const WHY = {
  cod: ["whyCod", "You paid on delivery, so there is no card to refund. Tell us where to send the money."],
  bank_transfer: ["whyBankTransfer", "You paid by bank transfer, so the refund is sent back by hand. Tell us where to send it."],
  counter: ["whyCounter", "You paid at the store's counter, so the refund is handed back the same way. Tell us where to send it."],
  other: ["whyOther", "This payment cannot be refunded automatically, so the refund is sent back by hand. Tell us where to send it."],
} as const;

export async function getReturnCopy(locale: string): Promise<ReturnCopy> {
  const t = await getTranslations({ locale });
  const say = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
  const known = (key: string, table: Record<string, string>, value: string) =>
    say(key, table[value] ?? value);
  return {
    reason: (code) => known(`orders.returns.reasons.${code}`, REASONS, code),
    status: (status) => known(`orders.returns.status.${status}`, STATUSES, status),
    refundStatus: (status) => known(`orders.returns.refundStatus.${status}`, REFUND_STATUSES, status),
    method: (method) => known(`orders.returns.destination.methods.${method}`, METHODS, method),
    field: (method, key) => {
      const mobile = method === "mobile_money";
      if (key === "provider") {
        return mobile
          ? {
              label: say("orders.returns.destination.mobileProvider", "Mobile money provider"),
              placeholder: say("orders.returns.destination.mobileProviderPlaceholder", "bKash, Nagad, …"),
            }
          : {
              label: say("orders.returns.destination.bankName", "Bank name"),
              placeholder: say("orders.returns.destination.bankNamePlaceholder", "Your bank"),
            };
      }
      if (key === "accountNumber") {
        return {
          label: mobile
            ? say("orders.returns.destination.mobileNumber", "Mobile money number")
            : say("orders.returns.destination.accountNumber", "Account number"),
        };
      }
      return {
        label: say("orders.returns.destination.accountName", "Account holder's name"),
        placeholder: say("orders.returns.destination.accountNamePlaceholder", "Exactly as it appears on the account"),
      };
    },
    cashNote: () => say("orders.returns.destination.cashNote", "The store will arrange handing the refund to you in person."),
    whyDestination: (paidWith) => say(`orders.returns.destination.${WHY[paidWith][0]}`, WHY[paidWith][1]),
    blocked: (reason) => say(`orders.returns.blocked.${reason}`, BLOCKED[reason]),
  };
}
