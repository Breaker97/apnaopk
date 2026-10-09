import * as z from "zod";
import { ImageSet, ListQuery, Money, listOf } from "./common";
import { OrderDetail, OrderAddress, OrderTotals } from "./orders";
import { OperationStatus, OPERATION_REASONS } from "./operations";

const Id = z.string().min(1).max(64);
export const ManualOrderAddressRequest = z.object({
  name: z.string().trim().min(1).max(200), street: z.string().trim().min(1).max(500),
  apartment: z.string().trim().max(200).optional(), city: z.string().trim().min(1).max(200),
  state: z.string().trim().max(200).optional(), postalCode: z.string().trim().max(50).optional(),
  country: z.string().trim().length(2), phone: z.string().trim().max(50).optional(),
});
export const OrderContactRequest = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), id: Id }),
  z.object({ kind: z.literal("guest"), name: z.string().trim().min(1).max(200), email: z.string().trim().email().max(254), phone: z.string().max(50).optional() }),
]);
export const OrderContactCreateRequest = z.object({ name: z.string().trim().min(1).max(200), email: z.string().trim().email().max(254), phone: z.string().max(50).optional(), shippingAddress: ManualOrderAddressRequest.optional() });
export type OrderContactCreateRequest = z.infer<typeof OrderContactCreateRequest>;
export const OrderCustomerSelector = z.object({
  id: Id, kind: z.enum(["account", "guest"]), name: z.string(), email: z.string().optional(), phone: z.string().optional(),
  addresses: z.array(OrderAddress),
});
export const OrderCustomerSelectorQuery = ListQuery.extend({ search: z.string().trim().min(1).max(100).optional() });
export type OrderCustomerSelectorQuery = z.infer<typeof OrderCustomerSelectorQuery>;
export const OrderCustomerSelectors = listOf(OrderCustomerSelector);
export type ManualOrderAddressRequest = z.infer<typeof ManualOrderAddressRequest>;
export type OrderContactRequest = z.infer<typeof OrderContactRequest>;
export type OrderCustomerSelector = z.infer<typeof OrderCustomerSelector>;
export type OrderCustomerSelectors = z.infer<typeof OrderCustomerSelectors>;
export const OrderContactCreateResult = z.object({ operation: OperationStatus, customer: OrderCustomerSelector });
export type OrderContactCreateResult = z.infer<typeof OrderContactCreateResult>;
export const OrderProductSelectorQuery = ListQuery.extend({ search: z.string().trim().min(1).max(100).optional(), barcode: z.string().trim().max(64).optional(), locationId: Id.optional() });
export type OrderProductSelectorQuery = z.infer<typeof OrderProductSelectorQuery>;
export const OrderProductSelector = z.object({
  id: Id, name: z.string(), image: ImageSet.optional(), sku: z.string().optional(), vendorName: z.string().optional(),
  selectable: z.boolean(), reason: z.string().optional(), price: Money.optional(), available: z.number().int(), untracked: z.boolean(),
  variants: z.array(z.object({ id: Id, name: z.string(), sku: z.string().optional(), barcode: z.string().optional(), price: Money.optional(), available: z.number().int(), image: ImageSet.optional(), selectable: z.boolean(), reason: z.string().optional() })),
});
export const OrderProductSelectors = listOf(OrderProductSelector);
export type OrderProductSelector = z.infer<typeof OrderProductSelector>;
export type OrderProductSelectors = z.infer<typeof OrderProductSelectors>;
/** Existing manual creation accepts self-collected labels only. No COD/gateway methods are implied. */
export const ManualOrderFormOptions = z.object({
  currency: z.string(), countries: z.array(z.object({ code: z.string(), name: z.string() })),
  locations: z.array(z.object({ id: Id, name: z.string(), isDefault: z.boolean() })),
  delivery: z.array(z.object({ id: z.string(), kind: z.enum(["shipping", "pickup"]), label: z.string(), locationId: Id.optional(), addressRequired: z.boolean() })),
  payments: z.array(z.object({ id: z.string(), label: z.string(), custody: z.enum(["platform", "vendor"]), canRecordPayment: z.boolean() })),
  customerModes: z.array(z.enum(["existing", "guest", "create_contact"])),
  adjustableFields: z.array(z.enum(["shippingCost", "discount", "taxRate"])),
  limits: z.object({ lines: z.number().int().positive(), quantity: z.number().int().positive(), quoteLifetimeSeconds: z.number().int().positive() }),
});
export type ManualOrderFormOptions = z.infer<typeof ManualOrderFormOptions>;
export const ManualOrderDraftRequest = z.object({
  draftId: z.string().uuid(), customer: OrderContactRequest,
  items: z.array(z.object({ productId: Id, variantId: Id.optional(), quantity: z.number().int().min(1).max(999) })).min(1).max(250),
  locationId: Id.optional(), deliveryId: z.string().min(1).max(100), shippingAddress: ManualOrderAddressRequest.optional(), billingAddress: ManualOrderAddressRequest.optional(),
  paymentMethod: z.string().min(1).max(50),
  shippingCost: z.number().finite().min(0).max(100_000).optional(), discount: z.number().finite().min(0).max(100_000).optional(), taxRate: z.number().finite().min(0).max(100).optional(),
  notes: z.string().max(1000).optional(),
});
export type ManualOrderDraftRequest = z.infer<typeof ManualOrderDraftRequest>;
export const ManualOrderQuoteRequest = ManualOrderDraftRequest;
export type ManualOrderQuoteRequest = z.infer<typeof ManualOrderQuoteRequest>;
export const ManualOrderQuote = z.object({
  token: z.string(), expiresAt: z.string(), draftId: z.string().uuid(),
  lines: z.array(z.object({ productId: Id, variantId: Id.optional(), name: z.string(), variantName: z.string().optional(), quantity: z.number().int(), unitPrice: Money, total: Money, vendorName: z.string().optional() })),
  totals: OrderTotals, customer: z.object({ name: z.string().optional(), email: z.string().optional(), phone: z.string().optional() }),
  delivery: z.object({ id: z.string(), label: z.string(), kind: z.enum(["shipping", "pickup"]) }),
  payment: z.object({ method: z.string(), label: z.string(), custody: z.enum(["platform", "vendor"]), canRecordPayment: z.boolean() }),
  warnings: z.array(z.string()),
});
export type ManualOrderQuote = z.infer<typeof ManualOrderQuote>;
/** The quote binds the complete draft, actor/workspace, prices/options and expiry. Changing any draft field needs a fresh review. */
export const ManualOrderCreateRequest = z.object({
  draft: ManualOrderDraftRequest, quoteToken: z.string().min(1).max(4000),
  /** Explicit authorized recording; merely selecting a method never makes the order paid. */
  recordPayment: z.object({ reference: z.string().trim().max(200).optional() }).optional(),
});
export type ManualOrderCreateRequest = z.infer<typeof ManualOrderCreateRequest>;
export const ManualOrderCreateResult = z.object({ operation: OperationStatus, order: OrderDetail });
export type ManualOrderCreateResult = z.infer<typeof ManualOrderCreateResult>;
export const MANUAL_ORDER_REASONS = ["QUOTE_EXPIRED", "QUOTE_CHANGED", "PRODUCT_NOT_ORDERABLE", "INSUFFICIENT_STOCK", "CUSTOMER_NOT_ALLOWED", "CONTACT_CREATE_NOT_ALLOWED", "DELIVERY_NOT_ALLOWED", "PAYMENT_METHOD_NOT_ALLOWED", "PAYMENT_RECORDING_NOT_ALLOWED", "LOCATION_NOT_ALLOWED", "TRANSACTIONS_UNAVAILABLE", ...OPERATION_REASONS] as const;
