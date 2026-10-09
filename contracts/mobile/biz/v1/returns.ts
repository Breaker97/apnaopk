import * as z from "zod";
import { ImageSet, ListQuery, Money, listOf } from "./common";
import { OrderDetail } from "./orders";
import { OperationStatus, OPERATION_REASONS } from "./operations";
import { BizUpload, UploadPolicy } from "./uploads";

const Id = z.string().min(1).max(64);
const Count = z.number().int().min(0).max(100_000_000);
export const RETURN_ACTIONS = ["approve", "reject", "cancel", "record_receipt", "restock", "record_disposition", "record_tracking", "close", "record_settlement"] as const;
export const RETURN_METHODS = ["customer_ships", "label", "no_shipping"] as const;
export const RETURN_CONDITIONS = ["new", "opened", "damaged", "missing_parts", "unusable"] as const;
export const ReturnListQuery = ListQuery.extend({ tab: z.enum(["actionable", "pending", "completed", "all", "open"]).optional(), search: z.string().trim().min(1).max(100).optional(), orderId: Id.optional() });
export type ReturnListQuery = z.infer<typeof ReturnListQuery>;
export const ReturnListItem = z.object({
  id: Id, number: z.string(), orderId: Id, orderNumber: z.string(), status: z.string(), refundStatus: z.string(),
  customerName: z.string().optional(), vendorName: z.string().optional(), itemCount: z.number().int(),
  estimatedRefund: Money.optional(), createdAt: z.string(), actions: z.array(z.enum(RETURN_ACTIONS)),
});
export const ReturnList = listOf(ReturnListItem);
export type ReturnList = z.infer<typeof ReturnList>;
export const ReturnRefundBreakdown = z.object({ subtotal: Money, discount: Money, tax: Money, shipping: Money, restockingFee: Money, returnShippingFee: Money, total: Money });
export const ReturnCase = ReturnListItem.extend({
  version: z.string(), reason: z.string(), customerNote: z.string().optional(), adminNote: z.string().optional(), vendorNote: z.string().optional(),
  rejectionReason: z.string().optional(), returnMethod: z.string().optional(), refundPayer: z.enum(["platform", "vendor"]),
  items: z.array(z.object({ orderItemIndex: z.number().int(), productId: Id, variantId: Id.optional(), name: z.string(), image: ImageSet.optional(), quantityRequested: Count, quantityApproved: Count, quantityReceived: Count.optional(), quantityRestocked: Count, quantityHeld: Count.optional(), quantityWrittenOff: Count.optional(), condition: z.string().optional() })),
  evidence: z.array(BizUpload), estimate: ReturnRefundBreakdown, refunded: Money,
  destination: z.object({ method: z.string(), accountName: z.string().optional(), accountNumber: z.string().optional(), provider: z.string().optional() }).optional(),
  returnTo: z.object({ name: z.string(), address: z.string(), locationId: Id.optional() }).optional(),
  shipment: z.object({ carrier: z.string().optional(), trackingNumber: z.string().optional(), trackingUrl: z.string().optional(), labelAvailable: z.boolean() }).optional(),
  timeline: z.array(z.object({ at: z.string(), kind: z.string(), message: z.string(), by: z.string().optional() })),
  settlement: z.object({ method: z.string().optional(), reference: z.string().optional(), settledAt: z.string().optional(), transactionId: Id.optional() }).optional(),
  canPreviewRefund: z.boolean(), canOverrideEligibility: z.boolean(),
});
export type ReturnCase = z.infer<typeof ReturnCase>;
export const ReturnOptionsQuery = z.object({ orderId: Id });
export type ReturnOptionsQuery = z.infer<typeof ReturnOptionsQuery>;
export const ReturnOptions = z.object({
  orderId: Id, orderNumber: z.string(), version: z.string(), canOverride: z.boolean(),
  reasons: z.array(z.object({ code: z.string(), label: z.string(), noteRequired: z.boolean(), evidenceRequired: z.boolean() })),
  resolutions: z.array(z.literal("refund")), methods: z.array(z.object({ id: z.enum(RETURN_METHODS), label: z.string() })),
  lines: z.array(z.object({ index: z.number().int(), name: z.string(), image: ImageSet.optional(), ordered: Count, eligible: Count, reason: z.string().optional(), returnWindowEndsAt: z.string().optional(), finalSale: z.boolean() })),
  locations: z.array(z.object({ id: Id, name: z.string() })), uploads: z.array(UploadPolicy),
});
export type ReturnOptions = z.infer<typeof ReturnOptions>;
export const ReturnCreateRequest = z.object({
  orderId: Id, version: z.string(), items: z.array(z.object({ index: z.number().int().nonnegative(), quantity: Count.refine((value) => value > 0) })).min(1).max(250),
  reason: z.string().min(1).max(100), note: z.string().max(1000).optional(), evidenceIds: z.array(Id).max(20).optional(),
  resolution: z.literal("refund"), returnMethod: z.enum(RETURN_METHODS), labelUploadId: Id.optional(), labelUrl: z.string().max(1000).optional(),
  eligibilityOverride: z.object({ note: z.string().trim().min(3).max(500) }).optional(),
  refundDestination: z.object({ method: z.string(), accountName: z.string().max(200).optional(), accountNumber: z.string().max(200).optional(), provider: z.string().max(200).optional() }).optional(),
});
export type ReturnCreateRequest = z.infer<typeof ReturnCreateRequest>;
export const ReturnPreviewRequest = ReturnCreateRequest.omit({ version: true, evidenceIds: true });
export type ReturnPreviewRequest = z.infer<typeof ReturnPreviewRequest>;
export const ReturnPreview = z.object({ parcels: z.array(z.object({ ownerName: z.string().optional(), items: z.array(z.object({ index: z.number().int(), quantity: Count })), refund: ReturnRefundBreakdown })), total: Money, warnings: z.array(z.string()) });
export const ReturnCreateResult = z.object({ operation: OperationStatus, returns: z.array(ReturnCase) });
export type ReturnCreateResult = z.infer<typeof ReturnCreateResult>;
/** If-Match/version plus a keyed tap; server advertises and rechecks every action. */
export const ReturnActionRequest = z.object({
  action: z.enum(RETURN_ACTIONS), version: z.string(), note: z.string().max(2000).optional(), reason: z.string().max(1000).optional(), declineReason: z.string().max(100).optional(),
  approvedItems: z.array(z.object({ index: z.number().int().nonnegative(), quantity: Count })).max(250).optional(),
  receivedItems: z.array(z.object({ index: z.number().int().nonnegative(), quantity: Count, condition: z.enum(RETURN_CONDITIONS) })).max(250).optional(),
  restockItems: z.array(z.object({ index: z.number().int().nonnegative(), quantity: Count.refine((value) => value > 0) })).min(1).max(250).optional(),
  dispositions: z.array(z.object({ index: z.number().int().nonnegative(), quantity: Count.refine((value) => value > 0), action: z.enum(["restocked", "written_off"]) })).min(1).max(250).optional(),
  locationId: Id.optional(), returnMethod: z.enum(RETURN_METHODS).optional(), labelUploadId: Id.optional(), labelUrl: z.string().max(1000).optional(),
  carrier: z.string().max(100).optional(), trackingNumber: z.string().max(100).optional(),
  settlement: z.object({ method: z.string().trim().min(1).max(40), reference: z.string().trim().max(200).optional() }).optional(),
});
export type ReturnActionRequest = z.infer<typeof ReturnActionRequest>;
export const ReturnActionResult = z.object({ operation: OperationStatus, return: ReturnCase });
export type ReturnActionResult = z.infer<typeof ReturnActionResult>;
export const RefundTarget = z.discriminatedUnion("kind", [z.object({ kind: z.literal("order"), id: Id }), z.object({ kind: z.literal("return"), id: Id })]);
export const RefundPreviewRequest = z.object({
  target: RefundTarget, amount: z.number().finite().positive().optional(),
  items: z.array(z.object({ index: z.number().int().nonnegative(), quantity: Count.refine((value) => value > 0) })).max(250).optional(),
  reason: z.string().max(500).optional(),
  feeOverride: z.object({ restockingFee: z.number().finite().min(0).nullable().optional(), returnShippingFee: z.number().finite().min(0).nullable().optional() }).optional(),
  deliveryRefund: z.number().finite().min(0).nullable().optional(),
  faultOverride: z.object({ merchantAtFault: z.boolean(), note: z.string().max(500).optional() }).optional(),
  restoreInventory: z.boolean().optional(), locationId: Id.optional(),
  /** Recording already-sent money is an explicit administrator choice. No exchange/new credit destination. */
  manual: z.boolean().optional(), settlement: z.object({ method: z.string().trim().min(1).max(40), reference: z.string().max(200).optional() }).optional(),
});
export type RefundPreviewRequest = z.infer<typeof RefundPreviewRequest>;
export const RefundPreview = z.object({
  token: z.string(), expiresAt: z.string(), target: RefundTarget, version: z.string(),
  amount: Money, maximum: Money, previouslyRefunded: Money, collected: Money, breakdown: ReturnRefundBreakdown,
  destination: z.object({ kind: z.enum(["original", "manual", "existing_credit"]), label: z.string(), payer: z.enum(["platform", "vendor"]), settlementRequired: z.boolean() }),
  resultingPaymentStatus: z.string(), resultingReturnStatus: z.string().optional(),
  stock: z.array(z.object({ index: z.number().int(), quantity: Count, locationId: Id.optional(), effect: z.enum(["restock", "none"]) })),
  warnings: z.array(z.string()),
});
export type RefundPreview = z.infer<typeof RefundPreview>;
export const RefundExecuteRequest = z.object({ preview: RefundPreviewRequest, previewToken: z.string().min(1).max(4000) });
export type RefundExecuteRequest = z.infer<typeof RefundExecuteRequest>;
export const RefundResult = z.object({
  operation: OperationStatus, refundId: Id, settlementStatus: z.enum(["processing", "succeeded", "failed", "manual_required"]),
  amount: Money, order: OrderDetail.optional(), return: ReturnCase.optional(), warnings: z.array(z.string()),
});
export type RefundResult = z.infer<typeof RefundResult>;
export type ReturnListItem = z.infer<typeof ReturnListItem>;
export type ReturnRefundBreakdown = z.infer<typeof ReturnRefundBreakdown>;
export type ReturnPreview = z.infer<typeof ReturnPreview>;
export type RefundTarget = z.infer<typeof RefundTarget>;
export const RETURN_REASONS = ["RETURN_NOT_ELIGIBLE", "RETURN_WINDOW_CLOSED", "FINAL_SALE", "RETURN_QUANTITY_CHANGED", "RETURN_STATE_CHANGED", "RETURN_ITEM_LISTED_TWICE", "RETURN_ACTION_NOT_ALLOWED", "EVIDENCE_REQUIRED", "RETURN_LOCATION_NOT_ALLOWED", "REFUND_PREVIEW_EXPIRED", "REFUND_PREVIEW_CHANGED", "REFUND_NOT_ALLOWED", "REFUND_AMOUNT_EXCEEDED", "REFUND_OUTCOME_UNKNOWN", "REFUND_PENDING", "SETTLEMENT_NOT_ALLOWED", ...OPERATION_REASONS] as const;
