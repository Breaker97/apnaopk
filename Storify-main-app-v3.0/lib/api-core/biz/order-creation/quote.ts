import { createHash } from "node:crypto";
import type { ManualOrderDraftRequest, ManualOrderQuote } from "@/contracts/mobile/biz/v1/order-creation";
import { createBizQuote } from "@/lib/api-next/biz-quote";
import { bizOperationBinding } from "@/lib/api-core/biz/durable-operation";
import { staffLocationIds } from "@/lib/api-core/biz/scope";
import { toMoney } from "@/lib/api-core/shop/money";
import { countryCodeForValue, isCountryAllowed } from "@/lib/intl/country-availability";
import { productTracksStock, productAllowsOversell } from "@/lib/products/stock-policy";
import { priceAdminOrder, type ResolvedAdminOrderLine } from "@/lib/orders/create-admin-order";
import { resolveOrderItemCost } from "@/lib/products/item-cost";
import { creationProductOwner, loadCreationOptions } from "./options";
import { resolveCreationCustomer } from "./customers";
import { creationAvailability, loadCreationProducts, orderability } from "./products";
import { storedOrderAddress, creationRefusal, type CreationContext, type CreationSession } from "./policy";

export function draftQuoteBinding(context: CreationContext, draft: ManualOrderDraftRequest) {
  return bizOperationBinding({ actorId: context.actorId, workspace: context.workspace, key: draft.draftId,
    routeId: "orders.creation.quote", target: draft.draftId, payload: draft });
}

/** Recomputed both at review and inside the creation transaction. */
export async function prepareManualOrder(context: CreationContext, draft: ManualOrderDraftRequest, session: CreationSession = null) {
  const policy = await loadCreationOptions(context, session);
  const { options, settings, locations, vendors } = policy;
  if (!draft.locationId && staffLocationIds(context.scope).length > 0) creationRefusal("LOCATION_NOT_ALLOWED", "Select an assigned fulfillment location.", 403);
  const customer = await resolveCreationCustomer(context, draft.customer, session);
  const delivery = options.delivery.find((option) => option.id === draft.deliveryId);
  const payment = options.payments.find((option) => option.id === draft.paymentMethod);
  if (!delivery) creationRefusal("DELIVERY_NOT_ALLOWED", "Choose an available delivery method.");
  if (!payment) creationRefusal("PAYMENT_METHOD_NOT_ALLOWED", "Choose an available manual payment method.");
  if (delivery.kind === "pickup" && draft.locationId !== delivery.locationId) creationRefusal("LOCATION_NOT_ALLOWED", "Collection and stock must use the same location.");
  const location = draft.locationId ? locations.find((row) => String(row._id) === draft.locationId) : undefined;
  if (draft.locationId && !location) creationRefusal("LOCATION_NOT_ALLOWED", "Location is outside this workspace.", 403);
  if (delivery.kind === "shipping" && location?.fulfillsOnlineOrders === false) creationRefusal("DELIVERY_NOT_ALLOWED", "This location does not dispatch delivery orders.");
  if (delivery.addressRequired && !draft.shippingAddress) creationRefusal("DELIVERY_NOT_ALLOWED", "A delivery address is required.");
  for (const address of [draft.shippingAddress, draft.billingAddress]) {
    if (address && (!countryCodeForValue(address.country) || !isCountryAllowed(address.country, settings.general?.countryAvailability))) {
      creationRefusal("DELIVERY_NOT_ALLOWED", "The address country is not available.");
    }
  }
  const pickupVendor = vendors.find((vendor) => String(vendor._id) === String(location?.vendorId));
  const address = draft.shippingAddress || (location && pickupVendor ? {
    name: customer.customer.name || location.name, street: location.address || location.name,
    city: pickupVendor.address?.city || location.pickupArea || location.name,
    state: pickupVendor.address?.state, postalCode: pickupVendor.address?.pincode,
    country: countryCodeForValue(pickupVendor.address?.country) || "", phone: customer.customer.phone,
  } : undefined);
  if (!address?.country) creationRefusal("DELIVERY_NOT_ALLOWED", "This collection location has no valid address.");
  if (!isCountryAllowed(address.country, settings.general?.countryAvailability)) creationRefusal("DELIVERY_NOT_ALLOWED", "The collection country is not available.");
  const products = await loadCreationProducts(context, [...new Set(draft.items.map((item) => item.productId))], session);
  const aggregated = new Map<string, ManualOrderDraftRequest["items"][number]>();
  for (const item of draft.items) {
    const key = `${item.productId}:${item.variantId || ""}`;
    const current = aggregated.get(key);
    aggregated.set(key, { ...item, quantity: item.quantity + (current?.quantity || 0) });
  }
  const lines = [...aggregated.values()].map((item) => {
    if (item.quantity > options.limits.quantity) creationRefusal("PRODUCT_NOT_ORDERABLE", "The selected quantity exceeds the manual order limit.");
    const product = products.find((row) => String(row._id) === item.productId);
    if (!product) creationRefusal("PRODUCT_NOT_ORDERABLE", "Product is outside this workspace.", 403);
    const variant = item.variantId ? product.variants?.find((row) => String(row._id) === item.variantId) : undefined;
    if ((product.variants?.length && !variant) || (item.variantId && !variant)) creationRefusal("PRODUCT_NOT_ORDERABLE", "Select a valid product variant.");
    const reason = orderability(product, variant);
    if (reason) creationRefusal(reason, "This product is not available for manual ordering.");
    const owner = creationProductOwner(product, settings, vendors);
    if (!owner) creationRefusal("PRODUCT_NOT_ORDERABLE", "The product's store is not open for orders.", 403);
    if (location?.vendorId && String(location.vendorId) !== String(owner._id)) creationRefusal("LOCATION_NOT_ALLOWED", "Stock must come from the product owner's location.", 403);
    const available = creationAvailability(product, variant, draft.locationId);
    if (available.reason === "LOCATION_NOT_ALLOWED") creationRefusal(available.reason, "Select the exact stock location.");
    if (productTracksStock(product) && !productAllowsOversell(product) && item.quantity > available.available) creationRefusal("INSUFFICIENT_STOCK", "There is not enough stock at this location.");
    const name = product.title || product.name || "Product";
    const variantName = variant?.name && variant.name !== "Default Title" ? variant.name : undefined;
    const resolved = { ...item, product, variant,
      name: variantName ? `${name} - ${variantName}` : name, sku: variant?.sku || product.sku || "",
      price: Number(variant?.price ?? product.price), image: variant?.image || product.images?.[0] } satisfies ResolvedAdminOrderLine;
    return { ...resolved, owner, variantName, tracksStock: productTracksStock(product), allowOversell: productAllowsOversell(product),
      cost: resolveOrderItemCost({ product, variant }) };
  });
  if (delivery.kind === "pickup" && lines.some((line) => String(line.owner._id) !== String(location?.vendorId))) creationRefusal("DELIVERY_NOT_ALLOWED", "All collection items must belong to this location's store.");
  const totals = priceAdminOrder({ lines, currency: options.currency, shippingCost: draft.shippingCost ?? 0,
    discount: draft.discount ?? 0, taxRate: draft.taxRate ?? 0 });
  if (delivery.kind === "pickup" && totals.shippingCost !== 0) creationRefusal("DELIVERY_NOT_ALLOWED", "Collection orders do not have a delivery charge.");
  const signature = createHash("sha256").update(JSON.stringify({
    scope: context.scope, options, totals, customer, address,
    settingsVersion: settings.updatedAt,
    lines: lines.map((line) => ({ productId: line.productId, variantId: line.variantId, quantity: line.quantity, price: line.price,
      cost: line.cost, productVersion: line.product.updatedAt, owner: String(line.owner._id), commission: line.owner.commission,
      isDefault: line.owner.isDefault, codCollectedBy: line.owner.shipping?.codCollectedBy })),
    commissionDefault: settings.orders?.commission?.vendorRate, codDefault: settings.shipping?.codCollectedBy,
    location: location ? { id: String(location._id), owner: String(location.vendorId || ""), updatedAt: location.updatedAt } : null,
  })).digest("hex");
  return { ...policy, lines, totals, customer, delivery, payment, location, signature,
    shippingAddress: storedOrderAddress(address), billingAddress: storedOrderAddress(draft.billingAddress || address) };
}
export async function quoteManualOrder(context: CreationContext, draft: ManualOrderDraftRequest): Promise<ManualOrderQuote> {
  const prepared = await prepareManualOrder(context, draft);
  const quote = await createBizQuote({ binding: draftQuoteBinding(context, draft), purpose: "manual_order",
    snapshot: { signature: prepared.signature }, expiresAt: new Date(Date.now() + prepared.options.limits.quoteLifetimeSeconds * 1000) });
  const money = (amount: number) => toMoney(amount, prepared.options.currency);
  return { ...quote, draftId: draft.draftId,
    lines: prepared.lines.map((line) => ({ productId: line.productId, variantId: line.variantId,
      name: line.name, variantName: line.variantName, quantity: line.quantity,
      unitPrice: money(line.price), total: money(line.price * line.quantity), vendorName: line.owner.storeName })),
    totals: { subtotal: money(prepared.totals.subtotal), shipping: money(prepared.totals.shippingCost),
      tax: money(prepared.totals.tax), discount: money(prepared.totals.discount), total: money(prepared.totals.total) },
    customer: prepared.customer.customer, delivery: { id: prepared.delivery.id, kind: prepared.delivery.kind, label: prepared.delivery.label },
    payment: { method: prepared.payment.id, label: prepared.payment.label, custody: prepared.payment.custody, canRecordPayment: prepared.payment.canRecordPayment }, warnings: [] };
}
