/**
 * Returns: asking the store to take items of an order back, and following
 * the return until the money is back.
 *
 * Whether an order can be returned, until when, and how many of each line,
 * is on the order itself (`OrderDetail.canReturn`, `returnWindowEndsAt`,
 * `OrderLine.returnableQuantity`). Then:
 *
 * 1. GET /orders/{id}/returns/options (auth user, private): the reasons to
 *    choose from, and whether (and how) the shopper must say where the
 *    refund goes: an order paid in cash on delivery, by bank transfer or at
 *    a counter has no card to refund.
 * 2. POST /orders/{id}/returns/preview (auth user; nothing is written): the
 *    lines and quantities chosen and the reason (the reason decides whether
 *    delivery is refunded and whether fees apply); answers the refund as the
 *    store would pay it. Ask again whenever the selection changes.
 * 3. POST /orders/{id}/returns (auth user; `Idempotency-Key` required;
 *    refused on a demo store): submit. Answers 201 with the returns made:
 *    usually one; an order several sellers shipped gives one per seller, each
 *    with its own parcel and its own refund. A retry with the same key answers
 *    the same returns, never new ones.
 * 4. GET /me/returns (paged, newest first) and GET /me/returns/{id}: where
 *    each stands, its refund and when each step happened.
 *
 * Every figure is the server's: the app never adds up a refund.
 *
 * Statuses and reasons mirror the store's own words, passed through as they
 * are (`requested`, `approved`, `refunded`, …; `damaged_or_defective`, …),
 * each with its label in the path's locale; show the label.
 *
 * Refusals of the preview and the submission, with `reason`
 * (`RETURN_REFUSALS`):
 * - 409 CONFLICT `RETURN_WINDOW_CLOSED`: the window of a chosen line (or of
 *   the whole order) has closed.
 * - 409 CONFLICT `FINAL_SALE`: a chosen line was sold as final sale.
 * - 409 CONFLICT `QUANTITY_EXCEEDS`: more of a line than can still be
 *   returned; `details` is `ReturnQuantityDetails`.
 * - 409 CONFLICT `NOT_RETURNABLE`: the order or a line cannot be returned
 *   (not delivered or not paid yet, a balance still owed, a digital item, a
 *   cancelled consignment, already refunded, …); `message` says which.
 * - 409 CONFLICT `RETURNS_THROUGH_STORE`: the store takes returns only
 *   through its team; show "Contact the store".
 * - 400 VALIDATION_ERROR `NOTE_REQUIRED` (on `errors.note`): the reason
 *   `other` needs a note.
 * - 400 VALIDATION_ERROR `REFUND_DESTINATION_REQUIRED` (on
 *   `errors.refundDestination…`): the order needs a refund destination and
 *   it is missing or incomplete.
 * - 404 NOT_FOUND: not the shopper's order (or return).
 */
import * as z from "zod";

import { ImageSet, ListQuery, Money, listOf } from "./common";

export const RETURN_REFUSALS = [
  "RETURN_WINDOW_CLOSED",
  "FINAL_SALE",
  "QUANTITY_EXCEEDS",
  "NOT_RETURNABLE",
  "RETURNS_THROUGH_STORE",
  "NOTE_REQUIRED",
  "REFUND_DESTINATION_REQUIRED",
] as const;
export type ReturnRefusal = (typeof RETURN_REFUSALS)[number];

/** The `details` of QUANTITY_EXCEEDS. */
export const ReturnQuantityDetails = z.object({
  /** `OrderLine.index`. */
  index: z.number().int(),
  /** How many of it can still be returned. */
  returnable: z.number().int(),
});
export type ReturnQuantityDetails = z.infer<typeof ReturnQuantityDetails>;

/** A reason to choose. Send `code` back as it is. */
export const ReturnReasonOption = z.object({
  code: z.string(),
  label: z.string(),
  /** A note must come with it (`CreateReturnRequest.note`). */
  noteRequired: z.boolean(),
});
export type ReturnReasonOption = z.infer<typeof ReturnReasonOption>;

/** One thing a refund destination asks for. */
export const RefundDestinationField = z.object({
  /** `accountName`, `accountNumber` or `provider`: the key in `RefundDestinationBody`. */
  key: z.string(),
  label: z.string(),
  placeholder: z.string().optional(),
  required: z.boolean(),
});
export type RefundDestinationField = z.infer<typeof RefundDestinationField>;

/** A way the store can send a refund by hand. */
export const RefundDestinationMethod = z.object({
  /** `bank_transfer`, `mobile_money`, `cash`: send it as `RefundDestinationBody.method`. */
  method: z.string(),
  label: z.string(),
  /** What to ask for; empty for cash, handed over in person. */
  fields: z.array(RefundDestinationField),
  /** A line to show under it ("The store will arrange…"). */
  note: z.string().optional(),
});
export type RefundDestinationMethod = z.infer<typeof RefundDestinationMethod>;

/** GET /orders/{id}/returns/options */
export const ReturnOptions = z.object({
  reasons: z.array(ReturnReasonOption),
  refundDestination: z.object({
    /**
     * The order's money cannot go back by itself (cash on delivery, bank
     * transfer, a counter sale): the shopper must choose one of `methods`
     * and fill its fields. False: the refund goes back the way it was paid,
     * and `methods` is empty.
     */
    required: z.boolean(),
    /** Why it is asked, in the store's words, when it is. */
    message: z.string().optional(),
    methods: z.array(RefundDestinationMethod),
  }),
});
export type ReturnOptions = z.infer<typeof ReturnOptions>;

/** The lines to return: `OrderLine.index` and how many. Each line once. */
const ReturnLinesBody = z
  .array(
    z.object({
      index: z.number().int().min(0),
      quantity: z.number().int().min(1).max(999),
    }),
  )
  .min(1)
  .max(200);

/** POST /orders/{id}/returns/preview */
export const ReturnPreviewRequest = z.object({
  lines: ReturnLinesBody,
  /** `ReturnReasonOption.code`. */
  reason: z.string().min(1).max(100),
});
export type ReturnPreviewRequest = z.infer<typeof ReturnPreviewRequest>;

/** Where a refund paid by hand goes. The fields its method asks for (`RefundDestinationMethod.fields`). */
export const RefundDestinationBody = z.object({
  method: z.string().min(1).max(40),
  accountName: z.string().max(120).optional(),
  accountNumber: z.string().max(64).optional(),
  provider: z.string().max(120).optional(),
});
export type RefundDestinationBody = z.infer<typeof RefundDestinationBody>;

/** POST /orders/{id}/returns. Send `Idempotency-Key`. */
export const CreateReturnRequest = ReturnPreviewRequest.extend({
  /** Required with the reason `other`. */
  note: z.string().max(1000).optional(),
  /** Required when `ReturnOptions.refundDestination.required`. */
  refundDestination: RefundDestinationBody.optional(),
});
export type CreateReturnRequest = z.infer<typeof CreateReturnRequest>;

/**
 * A refund as the store pays it: the goods, less their share of the
 * discount, plus their tax and (when the reason refunds it) the delivery,
 * less the store's fees. `total` is what comes back.
 */
export const ReturnRefund = z.object({
  items: Money,
  /** The order's discount on these goods, taken off. */
  discount: Money,
  tax: Money,
  /** The delivery, refunded when the reason is the store's fault (or the store always refunds it). */
  shipping: Money,
  /** Taken off. Zero when the store charges none, or the fault is the store's. */
  restockingFee: Money,
  /** Taken off: the return parcel's cost, when the shopper pays it. */
  returnShippingFee: Money,
  total: Money,
});
export type ReturnRefund = z.infer<typeof ReturnRefund>;

/** POST /orders/{id}/returns/preview */
export const ReturnPreview = z.object({
  /** One per parcel to send back; one per seller on an order several sellers shipped. */
  parcels: z.array(
    z.object({
      lines: z.array(z.object({ index: z.number().int(), name: z.string(), quantity: z.number().int() })),
      refund: ReturnRefund,
    }),
  ),
  /** Every parcel's refund added up, by the store. */
  total: Money,
  /** The reason is the store's fault: delivery and fees are on the store. */
  storeAtFault: z.boolean(),
  /**
   * Whether the store hands the original delivery back for this return. False
   * with a zero `refund.shipping`: say "Delivery: not refunded" rather than
   * leave the shopper expecting it.
   */
  refundsShipping: z.boolean().optional(),
  /** The submission must say where the refund goes (`ReturnOptions.refundDestination`). */
  refundDestinationRequired: z.boolean(),
});
export type ReturnPreview = z.infer<typeof ReturnPreview>;

export const ReturnLine = z.object({
  /** `OrderLine.index`. */
  index: z.number().int(),
  /** The product's page: GET /products/{slug}. Left out when the product has been deleted since. */
  slug: z.string().optional(),
  name: z.string(),
  image: ImageSet.optional(),
  quantityRequested: z.number().int(),
  /** How many the store accepted, once it has decided. */
  quantityApproved: z.number().int().optional(),
  unitPrice: Money,
});
export type ReturnLine = z.infer<typeof ReturnLine>;

/** When each step happened. A step not reached is left out. */
export const ReturnTimes = z.object({
  requestedAt: z.string(),
  approvedAt: z.string().optional(),
  rejectedAt: z.string().optional(),
  receivedAt: z.string().optional(),
  refundedAt: z.string().optional(),
  closedAt: z.string().optional(),
});
export type ReturnTimes = z.infer<typeof ReturnTimes>;

/** GET /me/returns/{id}, an item of GET /me/returns, and of the submission's answer. */
export const ShopperReturn = z.object({
  id: z.string(),
  /** The number the shopper quotes to the store. */
  number: z.string(),
  orderId: z.string(),
  orderNumber: z.string(),
  /** The store's word: requested, approved, rejected, awaiting_shipment, in_transit, received, inspected, refund_pending, refunded, partially_refunded, closed, cancelled. */
  status: z.string(),
  statusLabel: z.string(),
  /** The store's word: not_required, pending, processing, succeeded, failed, manual_required. */
  refundStatus: z.string(),
  refundStatusLabel: z.string(),
  reason: z.string(),
  reasonLabel: z.string(),
  note: z.string().optional(),
  /** Why the store said no, in its words. */
  rejectionReason: z.string().optional(),
  lines: z.array(ReturnLine),
  /** What the store expects to pay back, as it stands. */
  refund: ReturnRefund,
  /** What has been paid back so far. */
  refunded: Money.optional(),
  /** Where a refund paid by hand goes, the account number masked. */
  refundDestination: z
    .object({
      method: z.string(),
      label: z.string(),
      provider: z.string().optional(),
      accountName: z.string().optional(),
      accountNumber: z.string().optional(),
    })
    .optional(),
  /** How to send the parcel, in the store's words. */
  instructions: z.string().optional(),
  times: ReturnTimes,
});
export type ShopperReturn = z.infer<typeof ShopperReturn>;

/** POST /orders/{id}/returns (201) */
export const CreatedReturns = z.object({
  returns: z.array(ShopperReturn),
});
export type CreatedReturns = z.infer<typeof CreatedReturns>;

/** GET /me/returns. Newest first. */
export const ShopperReturnListQuery = ListQuery.extend({});
export type ShopperReturnListQuery = z.infer<typeof ShopperReturnListQuery>;

export const ShopperReturnList = listOf(ShopperReturn);
export type ShopperReturnList = z.infer<typeof ShopperReturnList>;
