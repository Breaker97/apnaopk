import { isCustomerAccount } from "@/lib/access/customer-account";
import { Order, Product, User } from "@/models";
import { Types } from "mongoose";
import { getNextPosOrderNumber } from "@/lib/orders/order-number";
import { DEFAULT_VENDOR_COMMISSION_RATE } from "@/lib/orders/order-settings";
import { createdResponse, successResponse } from "@/lib/api/response";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { USER_ROLES, ORDER_STATUS } from "@/config/app.config";
import { isStaffRole } from "@/lib/access/staff-role";
import { getSettingsLean } from "@/models";
import {
  decrementInventory,
  restoreInventory,
  InsufficientStockError,
} from "@/lib/inventory/inventory";
import { markOrderInventoryReserved } from "@/lib/orders/order-inventory";
import { resolvePOSLocationId } from "@/lib/pos/resolve-location";
import { canAccessPOS } from "@/lib/access/rbac";
import { assertPosDiscountAllowed } from "@/lib/pos/pos-discount-guard";
import { findOversoldLines } from "@/lib/pos/oversold";
import { notifyPOSOversold } from "@/lib/pos/notify-oversold";
import { ensureChargeTransaction } from "@/lib/payments/payment-transactions";
import { createAuditContext } from "@/lib/audit";
import { auditOrderPaid, auditOrderPlaced } from "@/lib/orders/audit-order";
import {
  buildVendorSubOrders,
  getOrderItemVendorId,
  groupItemsByOrderVendor,
  resolveOrderVendorContextForItems,
} from "@/lib/orders/order-vendors";
import { notifyOrderCreatedParticipants } from "@/lib/notifications/notifications";
import { resolvePOSSalePayment } from "@/lib/pos/sale-payment";
import { POS_TENDER_METHODS, POS_CARD_SUB_METHODS } from "@/lib/pos/tenders";
import {
  linkStoreCreditHold,
  settleOrderStoreCredit,
} from "@/lib/store-credit/store-credit";
import {
  calculatePOSOrderTotals,
  posStoredSale,
  type POSOrderDiscountInput,
  type POSOrderItemInput,
} from "@/lib/pos/order-totals";
import { resolveLocationScope } from "@/lib/inventory/inventory-location-scope";
import { resolveOfflineSoldAt } from "@/lib/pos/offline-sold-at";
import { resolveOfflineCashier } from "@/lib/pos/offline-cashier";
import { resolvePosOperator } from "@/lib/pos/operator";
import { posTaxRates, resolvePOSTaxExemption } from "@/lib/pos/sale-tax";
import { splitTax } from "@/lib/tax/tax-parts";
import { storeTaxRateAt, type StoredTaxSettings } from "@/lib/tax/tax-settings";
import { resolveSaleSession } from "@/lib/pos/register-session";
import { loadPOSGuestCustomer } from "@/lib/pos/pos-customers";
import { searchPOSSales } from "@/lib/pos/pos-order-search";
import { resolveOrderItemCost } from "@/lib/products/item-cost";
import { DELIVERY_ATTESTED_BY } from "@/lib/orders/delivery-attestation";
import { netOfTaxVariantSnapshot, orderLineVariantSnapshot } from "@/lib/orders/order-line-variant";
import * as z from "zod";
import { validateBody } from "@/lib/api/validate";

const PosLineDiscountSchema = z.object({
  type: z.enum(["percent", "amount"]),
  value: z.number(),
  amount: z.number().optional(),
});
const PosOrderItemSchema = z.object({
  productId: z.string().max(64),
  variantId: z.string().max(64).optional(),
  name: z.string().max(500),
  sku: z.string().max(200),
  price: z.number(),
  quantity: z.number(),
  image: z.string().max(2048).optional(),
  vendorId: z.string().max(64),
  lineTotal: z.number().optional(),
  lineDiscount: PosLineDiscountSchema.optional(),
  lineNote: z.string().max(1000).optional(),
});
// Shape check; presence ("Items are required", "Payment method is required")
// and every business rule stay below so the terminal's messages do not change.
const PosOrderSchema = z.object({
  items: z.array(PosOrderItemSchema).max(500).optional(),
  paymentMethod: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
  posLocationId: z.string().max(64).optional(),
  customerId: z.string().max(64).optional(),
  /**
   * A guest customer (no account): a phone-only shopper, or a guest checkout
   * record. Never together with `customerId` — see lib/pos/pos-customers.ts.
   */
  customerProfileId: z.string().max(64).optional(),
  /** The counter's "they agreed to news and offers", for an attached customer. */
  marketingOptIn: z.boolean().optional(),
  cashTendered: z.union([z.number(), z.string().max(40)]).optional(),
  paymentReference: z.string().max(200).optional(),
  paymentNote: z.string().max(1000).optional(),
  stripePaymentIntentId: z.string().max(200).optional(),
  /**
   * How the sale was paid, tender by tender (lib/pos/tenders.ts). Replaces
   * `paymentMethod` + `cashTendered` + `paymentReference`, which a sale queued
   * by an older till still sends and is still read.
   */
  tenders: z
    .array(
      z.object({
        method: z.enum(POS_TENDER_METHODS),
        amount: z.number(),
        tendered: z.number().optional(),
        reference: z.string().max(200).optional(),
        cardSubMethod: z.enum(POS_CARD_SUB_METHODS).optional(),
        stripePaymentIntentId: z.string().max(200).optional(),
      }),
    )
    .max(10)
    .optional(),
  /** Take part of the sale now and the rest later (needs a customer). */
  deposit: z.boolean().optional(),
  /** The register session (drawer) the money goes into. */
  registerSessionId: z.string().max(64).optional(),
  /** Sold without tax, and why (lib/pos/sale-tax.ts). */
  taxExempt: z
    .object({ reason: z.string().max(200), reference: z.string().max(120).optional() })
    .optional(),
  discount: z
    .object({
      type: z.enum(["percent", "amount"]),
      value: z.number(),
      amount: z.number(),
      reason: z.string().max(500).optional(),
      note: z.string().max(1000).optional(),
    })
    .optional(),
  clientRequestId: z.string().max(100).optional(),
  localReceiptNumber: z.string().max(100).optional(),
  /** Offline replay only: when the counter took the money (ISO 8601). */
  soldAt: z.string().max(40).optional(),
  /** Offline replay only: the account that rang the sale up. */
  cashierId: z.string().max(64).optional(),
});

async function generatePosOrderNumber(prefix?: string) {
  return getNextPosOrderNumber(prefix || "POS");
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === 11000
  );
}

/**
 * POST /api/pos/orders — ring up a sale at the register.
 *
 * Through `withApi` like every other POS route: the session, the demo policy
 * (a demo visitor may ring up sales, as they may create everything else) and
 * the rate limit are the shared ones rather than this route's own copies.
 *
 * `lenient` is per cashier and a till's account is always a store role, which
 * gets the preset twenty times over (`STORE_ROLE_ALLOWANCE`): 2,000 sales per
 * quarter hour. That is far past a busy counter, and past a full offline
 * outbox (500 sales, `MAX_QUEUED_SALES`) replayed in one drain — which is
 * the case that sizes it, since a drain sends back to back. A refusal still
 * keeps the sale: the drain reads 429 as "try later" and stops sending.
 */
export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "pos:orders", preset: "lenient" },
  },
  async ({ request, session }) => {
    const role = session.user.role;
    if (
      role !== USER_ROLES.ADMIN &&
      role !== USER_ROLES.VENDOR &&
      !isStaffRole(role)
    ) {
      throw new AuthorizationError();
    }

    const settings = await getSettingsLean();
    if (!(await canAccessPOS(session.user))) {
      throw new AuthorizationError();
    }
    // Who is working the till: a colleague switched in with their PIN sells,
    // and gives discounts, as themselves (lib/pos/operator.ts).
    const operator = await resolvePosOperator(session.user, request.cookies);

    const body = await validateBody(request, PosOrderSchema);
    const {
      items,
      paymentMethod,
      marketingOptIn: posMarketingOptIn,
      notes,
      posLocationId: requestedPosLocationId,
      customerId,
      customerProfileId,
      cashTendered,
      paymentReference,
      paymentNote,
      stripePaymentIntentId,
      discount,
      clientRequestId,
      localReceiptNumber,
      tenders: tenderInput,
      deposit: depositInput,
      registerSessionId,
      taxExempt: taxExemptInput,
      soldAt: soldAtInput,
      cashierId: cashierIdInput,
    }: {
      items?: POSOrderItemInput[];
      paymentMethod?: string;
      notes?: string;
      posLocationId?: string;
      customerId?: string;
      customerProfileId?: string;
      marketingOptIn?: boolean;
      cashTendered?: number | string;
      paymentReference?: string;
      paymentNote?: string;
      stripePaymentIntentId?: string;
      discount?: POSOrderDiscountInput;
      clientRequestId?: string;
      localReceiptNumber?: string;
      tenders?: import("@/lib/pos/tenders").POSTenderInput[];
      deposit?: boolean;
      registerSessionId?: string;
      taxExempt?: { reason: string; reference?: string };
      soldAt?: string;
      cashierId?: string;
    } = body;

    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError("Items are required");
    }
    if (!paymentMethod && !(Array.isArray(tenderInput) && tenderInput.length > 0)) {
      throw new ValidationError("Payment method is required");
    }
    // The sale, its loyalty points and a "yes" to news are filed under this
    // account, so it has to be a shopper's. Unchecked, a terminal could put
    // them on any account id it named — an admin's included.
    if (customerId && customerProfileId) {
      throw new ValidationError("Choose one customer for the sale");
    }
    // A guest has no account, so the sale stays filed under its cashier and
    // carries the guest alongside — checked here, so a crafted id cannot name
    // anything but a guest record.
    const guestCustomer = customerProfileId
      ? await loadPOSGuestCustomer(customerProfileId)
      : null;
    if (customerId) {
      const customer = Types.ObjectId.isValid(customerId)
        ? await User.findById(customerId)
            .select("role roles")
            .lean<{ role?: string; roles?: string[] } | null>()
        : null;
      if (!isCustomerAccount(customer)) {
        throw new ValidationError("Customer not found");
      }
    }

    // Idempotency: a cashier retry after a network blip must return the order
    // the first attempt already committed, not ring up a second sale.
    const normalizedClientRequestId =
      typeof clientRequestId === "string" &&
      /^[A-Za-z0-9_-]{8,64}$/.test(clientRequestId.trim())
        ? clientRequestId.trim()
        : undefined;
    // Same shape as the idempotency key: terminal prefix plus a counter, from
    // `lib/pos/offline-receipt.ts`. Validated rather than trusted so a crafted
    // body cannot write arbitrary text onto a customer-facing record.
    const normalizedLocalReceiptNumber =
      typeof localReceiptNumber === "string" &&
      /^[A-Za-z0-9-]{3,32}$/.test(localReceiptNumber.trim())
        ? localReceiptNumber.trim()
        : undefined;

    if (normalizedClientRequestId) {
      // By the key alone, which is what the unique index holds. Scoped to the
      // signed-in cashier, a sale replayed from the outbox after a shift
      // change missed its own committed order, hit the index, and failed on
      // every sync.
      const existingSale = await Order.findOne({
        posClientRequestId: normalizedClientRequestId,
        channel: "pos",
      }).lean();
      if (existingSale) {
        return createdResponse(existingSale);
      }
    }

    // Validate item shape before pricing. Quantity must be a positive whole
    // number: fractional/negative quantities would skew the client-computed
    // total while inventory only ever decrements positive lines.
    for (const item of items) {
      if (!item || !String(item.productId || "").trim()) {
        throw new ValidationError("Each item must reference a product");
      }
      if (
        typeof item.quantity !== "number" ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1
      ) {
        throw new ValidationError(
          "Item quantity must be a positive whole number",
        );
      }
      if (
        item.lineDiscount &&
        (typeof item.lineDiscount.value !== "number" ||
          item.lineDiscount.value < 0)
      ) {
        throw new ValidationError("Line discount must not be negative");
      }
    }
    if (discount && (typeof discount.value !== "number" || discount.value < 0)) {
      throw new ValidationError("Discount must not be negative");
    }
    await assertPosDiscountAllowed(operator, { items, discount });

    const productIds = Array.from(
      new Set(
        items.map((item) => String(item.productId || "").trim()).filter(Boolean),
      ),
    );
    if (productIds.length === 0) {
      throw new ValidationError("Items are required");
    }

    // Load authoritative product/variant prices. POS clients MUST NOT be
    // trusted for the price — resolving it server-side is the only thing
    // preventing a $0.01 "sale" that still decrements real stock.
    // `cost` rides along for the margin snapshot on each line — the register is
    // the one channel where the seller is always the principal, so its gross
    // profit is the figure a shop owner asks for first.
    // `stock`, `locationInventory` and the two stock-policy blocks ride along
    // for `findOversoldLines`: without them every non-variant product reads as
    // `available: 0`, so an offline replay would report a shortfall that never
    // happened — and a digital or untracked line would lose the exemption that
    // keeps it out of the report entirely. Mirrors PRODUCT_FIELDS in
    // lib/pos/list-products.ts, which exists for the same reason.
    const affectedProducts = await Product.find({ _id: { $in: productIds } })
      .select(
        // `name` too: without it a genuine oversell alert reads "Product: sold
        // 3, 0 on hand", which tells the merchant nothing about which shelf to
        // recount — the one thing the alert exists to say. `comparePrice` and
        // `options` complete each line's variant snapshot.
        "_id name slug price comparePrice cost vendorId variants options stock locationInventory " +
          "taxRate taxClass category chargeTax " +
          "shipping.isPhysicalProduct inventory.tracked " +
          "inventory.continueSellingWhenOutOfStock",
      )
      .lean();
    const productById = new Map(
      affectedProducts.map((product) => [String(product._id), product]),
    );

    // A register may only ring up its own merchant's catalogue. This used to run
    // for vendors alone, which left the higher-privilege sessions unchecked: an
    // admin or staff POST could name any product id at all and complete a real,
    // inventory-decrementing sale against another merchant's stock. The read
    // path is scoped the same way — see `lib/pos/list-products.ts`.
    const scope = await resolveLocationScope(session.user, "write");
    const vendorScopeId = scope.vendorId;
    for (const productId of productIds) {
      const product = productById.get(productId);
      // Told apart from the ownership refusal below: a product deleted while a
      // register was offline is a fact about that sale, and the reviewer
      // reading the refusal on the queued sale needs to know which it was.
      if (!product) {
        throw new ValidationError("A selected product no longer exists");
      }
      if (String(product.vendorId) !== vendorScopeId) {
        throw new AuthorizationError(
          "This register can only sell its own products",
        );
      }
    }

    const resolvePosItemPrice = (item: POSOrderItemInput): number => {
      const product = productById.get(String(item.productId).trim());
      if (!product) {
        throw new ValidationError("A selected product no longer exists");
      }
      const variants = (product.variants || []) as Array<{
        _id: unknown;
        price?: number;
      }>;
      if (item.variantId) {
        const variant = variants.find(
          (candidate) => String(candidate._id) === String(item.variantId),
        );
        if (!variant) {
          throw new ValidationError("A selected variant no longer exists");
        }
        if (typeof variant.price === "number") return variant.price;
      }
      if (typeof product.price === "number") return product.price;
      throw new ValidationError("A selected product has no price");
    };

    // Each line's own tax rate, from its product or category — never the
    // till's word for it.
    // A sale replayed from a terminal's offline queue is taxed at the rates in
    // effect when it was rung up — the tax the customer was charged — not at
    // those of the day it reaches the server. Settings → Tax keeps a rate's
    // start date, so a change scheduled in between is read as of the sale.
    const soldAtMs = normalizedLocalReceiptNumber
      ? resolveOfflineSoldAt(soldAtInput)?.getTime()
      : undefined;
    const taxRateOf = await posTaxRates(affectedProducts, { at: soldAtMs });
    const normalizedItems: Array<POSOrderItemInput & { taxRate: number | null }> = items.map((item) => ({
      ...item,
      price: resolvePosItemPrice(item),
      ...(vendorScopeId ? { vendorId: vendorScopeId } : {}),
      taxRate: taxRateOf(item.productId),
    }));

    const taxRate =
      soldAtMs === undefined
        ? (settings.orders?.taxRate ?? 0)
        : storeTaxRateAt(settings.tax as StoredTaxSettings, soldAtMs, settings.orders?.taxRate ?? 0);
    const currency = settings.general?.defaultCurrency || "USD";
    const taxExemption = await resolvePOSTaxExemption(taxExemptInput, operator);
    const pricesIncludeTax = settings.pos?.checkout?.pricesIncludeTax === true;
    const saleTotals = calculatePOSOrderTotals({
      items: normalizedItems,
      discount,
      taxRate,
      pricesIncludeTax,
      taxExempt: Boolean(taxExemption),
      currency,
    });
    const { tax, shippingCost, total } = saleTotals;
    // As the order stores it: net of tax when shelf prices include it.
    const stored = posStoredSale(normalizedItems, saleTotals, currency);
    const subtotal = stored.subtotal;
    const totalDiscount = stored.discount;
    const storedLineOf = new Map(normalizedItems.map((item, index) => [item, stored.lines[index]!]));
    // The variant as it was rung up, read from the product here rather than
    // taken from the till. Stored net of tax like the price when the shelf
    // prices include it, so the "was" price compares with the price.
    const variantSnapshotOf = new Map(
      normalizedItems.map((item, index) => {
        const snapshot = orderLineVariantSnapshot(productById.get(String(item.productId).trim()), item.variantId);
        return [
          item,
          saleTotals.inclusive ? netOfTaxVariantSnapshot(snapshot, saleTotals.lineRates[index] ?? 0) : snapshot,
        ] as const;
      }),
    );
    // Each line's rate and tax, written where lines differ from the store's
    // one rate or carry the tax inside their price — so a return of one hands
    // back exactly its tax.
    const recordLineTax = saleTotals.hasOwnRates || saleTotals.inclusive;
    const lineTaxOf = new Map(
      normalizedItems.map((item, index) => [
        item,
        {
          taxRate: Math.round((saleTotals.lineRates[index] ?? 0) * 100 * 10_000) / 10_000,
          tax: saleTotals.lineTaxes[index] ?? 0,
        },
      ]),
    );
    // Each line's tax by part (VAT, SD), whenever it carried tax — for the
    // VAT invoice and the tax report (lib/tax/tax-parts.ts).
    const taxPartsOf = new Map(
      normalizedItems.map((item, index) => {
        const rate = saleTotals.lineRates[index] ?? 0;
        const components =
          taxRateOf.partsOf(item.productId) ?? [{ name: "", rate: Math.round(rate * 100 * 10_000) / 10_000 }];
        const parts = splitTax(saleTotals.lineTaxes[index] ?? 0, components, currency);
        return [item, parts.length ? parts : undefined] as const;
      }),
    );
    // Which drawer the money goes into — checked before any money is held,
    // so a refusal here (a closed register, an open one required) leaves
    // nothing behind. A replayed offline sale is never refused for it.
    const replayingFromOutbox = Boolean(normalizedLocalReceiptNumber);
    const registerSession = await resolveSaleSession({
      vendorId: vendorScopeId,
      registerSessionId,
      required: settings.pos?.checkout?.requireOpenRegister === true,
      isReplay: replayingFromOutbox,
      soldAt: replayingFromOutbox ? resolveOfflineSoldAt(soldAtInput) : undefined,
    });
    const payment = await resolvePOSSalePayment({
      input: {
        tenders: tenderInput,
        paymentMethod,
        cashTendered,
        paymentReference,
        paymentNote,
        stripePaymentIntentId,
        deposit: depositInput,
      },
      total,
      currency,
      settings,
      cashierId: operator.id,
      posLocationId: requestedPosLocationId,
      customerAccountId: customerId || undefined,
      hasCustomer: Boolean(customerId || guestCustomer),
      clientRequestId: normalizedClientRequestId,
    });
    // A deposit sale owes the rest: the goods are reserved, not handed over,
    // and nothing is booked as paid until the balance is in.
    const isDeposit = payment.balanceDue > 0;
    const saleStatus = isDeposit ? ORDER_STATUS.PROCESSING : ORDER_STATUS.DELIVERED;

    // Order number generated below with retry
    const vendorContext = await resolveOrderVendorContextForItems({
      isMultiVendorEnabled: Boolean(settings.multiVendorMode?.enabled),
      items: normalizedItems,
      getVendorId: (item) => item.vendorId,
      defaultVendorOwnerUserId:
        role === USER_ROLES.ADMIN ? session.user.id : undefined,
    });
    const vendorItems = groupItemsByOrderVendor(
      normalizedItems,
      vendorContext,
      (item) => item.vendorId,
    );
    const subOrders = await buildVendorSubOrders(vendorItems, {
      codCollectedByDefault: settings.shipping?.codCollectedBy,
      currency: settings.general?.defaultCurrency || "USD",
      getProductId: (item) => item.productId,
      getVariantId: (item) => item.variantId,
      getName: (item) => item.name,
      getSku: (item) => item.sku,
      getQuantity: (item) => item.quantity,
      getPrice: (item) => storedLineOf.get(item)?.price ?? item.price,
      getCost: (item) =>
        resolveOrderItemCost({
          product: productById.get(String(item.productId).trim()),
          variantId: item.variantId,
        }),
      getImage: (item) => item.image,
      getLineDiscount: (item) => storedLineOf.get(item)?.lineDiscount ?? null,
      ...(recordLineTax
        ? {
            getTaxRate: (item: (typeof normalizedItems)[number]) => lineTaxOf.get(item)?.taxRate,
            getTax: (item: (typeof normalizedItems)[number]) => lineTaxOf.get(item)?.tax,
          }
        : {}),
      getTaxParts: (item) => taxPartsOf.get(item),
      getLineNote: (item) =>
        typeof item.lineNote === "string" && item.lineNote.trim().length > 0
          ? item.lineNote.trim()
          : undefined,
      getVariantSnapshot: (item) => variantSnapshotOf.get(item) ?? {},
      fallbackCommissionPercent:
        settings.orders?.commission?.vendorRate ?? DEFAULT_VENDOR_COMMISSION_RATE,
      status: saleStatus,
    });

    // The register sends back the location the page resolved for it, but a
    // location id is a bare string with no ownership of its own — re-resolve it
    // here so a crafted body cannot draw stock from (or stamp a sale onto)
    // another merchant's counter, and so the decrement below scopes itself
    // exactly the way the grid the cashier was looking at did.
    const posLocationId = await resolvePOSLocationId(
      session.user,
      requestedPosLocationId,
    );

    // POS placeholder address (not applicable for in-store sales)
    const posAddress = {
      street: "In-store POS",
      city: "POS",
      state: "POS",
      postalCode: "00000",
      country: "POS",
    };

    /**
     * A sale replayed from a terminal's offline outbox.
     *
     * Only such a sale carries a provisional receipt number: it was printed at
     * the counter while the register had no connection, which is precisely the
     * window in which another terminal can have sold the last unit. The goods
     * are already gone and the money is already taken, so this sale is accepted
     * and the stock is allowed to go negative — refusing it would not recover
     * the goods, it would only leave no record of where they went.
     *
     * The marker is client-supplied, and deliberately so: this endpoint already
     * trusts an authenticated POS session to create orders and move this
     * merchant's stock. Driving one's own shelf count negative is a bookkeeping
     * outcome, not a new capability — which is exactly why it is recorded and
     * reported rather than merely permitted.
     */
    const isOfflineReplay = Boolean(normalizedLocalReceiptNumber);

    // When the counter took the money, and who was standing at it — both only
    // meaningful for a replay, where the arrival time and the replaying session
    // can be hours and a shift change away from the sale.
    const soldAt = isOfflineReplay
      ? resolveOfflineSoldAt(soldAtInput)
      : undefined;
    const sellerId = isOfflineReplay
      ? await resolveOfflineCashier({
          cashierId: cashierIdInput,
          sessionUserId: session.user.id,
          vendorScopeId,
        })
      : operator.id;

    // Measured BEFORE the decrement, against the stock this register was
    // scoped to, so the report says what the shelf was actually short.
    const oversoldLines = isOfflineReplay
      ? findOversoldLines(normalizedItems, productById, posLocationId)
      : [];

    // A sale paid in full is handed over at the counter, so that is when it
    // was delivered. Without the stamp a payout read the sale as delivered
    // long ago and paid the seller before the return window had even started.
    const handedOverAt = isDeposit ? undefined : (soldAt ?? new Date());

    const orderData = {
      inventoryReservationSourceId: new Types.ObjectId().toString(),
      // A walk-in is filed under its cashier (`lib/orders/pos-walk-in.ts`
      // reads `customerId === staffId`), so both name the same account.
      customerId: customerId || sellerId,
      ...(guestCustomer
        ? {
            posCustomerProfileId: guestCustomer._id,
            posCustomerName: guestCustomer.name || undefined,
            contactPhone: guestCustomer.phone,
            // An email guest is a guest checkout's own record: the sale joins
            // their history (stats, and the claim when they register) by it.
            guestEmail: guestCustomer.email,
          }
        : {}),
      currency: settings.general?.defaultCurrency || "USD",
      posClientRequestId: normalizedClientRequestId,
      // Only set for a sale replayed from a terminal's offline outbox. The
      // customer left with this number, so it has to be findable even though
      // `orderNumber` is only assigned here, on arrival.
      posLocalReceiptNumber: normalizedLocalReceiptNumber,
      // Empty for the overwhelming majority of replays — a queue usually syncs
      // against stock that is still there. A non-empty list is the merchant's
      // signal that a shelf count needs correcting.
      posOversoldLines: oversoldLines.length > 0 ? oversoldLines : undefined,
      items: normalizedItems.map((item) => {
        const storedLine = storedLineOf.get(item);
        return {
          productId: item.productId,
          name: item.name,
          sku: item.sku,
          price: storedLine?.price ?? item.price,
          cost: resolveOrderItemCost({
            product: productById.get(String(item.productId).trim()),
            variantId: item.variantId,
          }),
          quantity: item.quantity,
          image: item.image,
          variantId: item.variantId,
          vendorId: getOrderItemVendorId(item.vendorId, vendorContext),
          lineDiscount: storedLine?.lineDiscount,
          lineNote:
            typeof item.lineNote === "string" && item.lineNote.trim().length > 0
              ? item.lineNote.trim()
              : undefined,
          ...(recordLineTax ? lineTaxOf.get(item) : {}),
          ...(taxPartsOf.get(item) ? { taxParts: taxPartsOf.get(item) } : {}),
          ...variantSnapshotOf.get(item),
        };
      }),
      subOrders: handedOverAt
        ? subOrders.map((sub) => ({
            ...sub,
            shippedAt: handedOverAt,
            deliveredAt: handedOverAt,
            deliveryAttestedBy: DELIVERY_ATTESTED_BY.COUNTER,
          }))
        : subOrders,
      ...(handedOverAt ? { shippedAt: handedOverAt, deliveredAt: handedOverAt } : {}),
      shippingAddress: posAddress,
      billingAddress: posAddress,
      paymentMethod: payment.method,
      paymentStatus: isDeposit ? "partially_paid" : "paid",
      // A deposit is not yet a paid sale: `paidAt` is stamped when the balance
      // lands, which is when the sale reaches the books.
      ...(isDeposit ? {} : { paidAt: soldAt ?? new Date() }),
      posTenders: payment.tenders.map((tender) => ({
        ...tender,
        kind: "sale" as const,
        collectedAt: soldAt ?? new Date(),
        collectedBy: sellerId,
        ...(registerSession ? { sessionId: registerSession } : {}),
      })),
      ...(registerSession ? { posRegisterSessionId: registerSession } : {}),
      ...(isDeposit ? { posBalanceDue: payment.balanceDue } : {}),
      ...(payment.storeCredit ? { storeCredit: payment.storeCredit } : {}),
      // Mongoose only fills `createdAt` when it is absent, so a believed sale
      // time dates the order where the sale happened; `posSyncedAt` keeps the
      // arrival. Both absent for an online sale.
      ...(soldAt ? { createdAt: soldAt, posSyncedAt: new Date() } : {}),
      paymentId: payment.paymentId,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      subtotal,
      shippingCost,
      tax,
      // Store the TOTAL discount (line + order-level) so finance reports,
      // sales ledger, and analytics all reflect the full markdown.
      discount: totalDiscount,
      ...(saleTotals.inclusive ? { pricesIncludeTax: true } : {}),
      ...(taxExemption ? { taxExemption: { ...taxExemption, by: operator.id, at: new Date() } } : {}),
      discountMeta: discount
        ? {
            type: discount.type,
            value: discount.value,
            reason: discount.reason,
            note: discount.note,
          }
        : undefined,
      total,
      status: saleStatus,
      notes,
      channel: "pos",
      posLocationId,
      staffId: sellerId,
    };

    const inventoryLines = normalizedItems.map((item) => ({
      productId: String(item.productId),
      variantId: item.variantId ? String(item.variantId) : undefined,
      quantity: item.quantity,
    }));

    // Decrement inventory first so we never end up with a phantom order
    // referencing stock we couldn't actually reserve.
    try {
      await decrementInventory(inventoryLines, {
        financeSource: { kind: "order_reservation", id: orderData.inventoryReservationSourceId },
        channel: "pos",
        locationId: posLocationId,
        allowOversell: isOfflineReplay,
      });
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        throw new ValidationError("Insufficient stock for one or more items");
      }
      throw err;
    }

    let order;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          order = await Order.create({
            ...orderData,
            orderNumber: await generatePosOrderNumber(
              settings.pos?.orders?.orderNumberPrefix,
            ),
          });
          break;
        } catch (err) {
          // A duplicate on the idempotency key means a concurrent retry of the
          // SAME sale already committed — hand back that order (after undoing
          // this attempt's decrement) instead of retrying with a new number.
          if (
            isDuplicateKeyError(err) &&
            normalizedClientRequestId &&
            String((err as Error).message || "").includes("posClientRequestId")
          ) {
            const committed = await Order.findOne({
              posClientRequestId: normalizedClientRequestId,
              channel: "pos",
            }).lean();
            if (committed) {
              await restoreInventory(inventoryLines, {
                financeSource: { kind: "order_reservation", id: orderData.inventoryReservationSourceId },
                channel: "pos",
                locationId: posLocationId,
              }).catch((restoreErr) =>
                console.error(
                  "Failed to restore duplicate POS attempt inventory:",
                  restoreErr,
                ),
              );
              return createdResponse(committed);
            }
          }
          if (isDuplicateKeyError(err) && attempt < 2) continue;
          throw err;
        }
      }
    } catch (err) {
      await restoreInventory(inventoryLines, {
        financeSource: { kind: "order_reservation", id: orderData.inventoryReservationSourceId },
        channel: "pos",
        locationId: posLocationId,
      }).catch((restoreErr) =>
        console.error("Failed to restore inventory after POS order failure:", restoreErr),
      );
      throw err;
    }

    if (!order) {
      await restoreInventory(inventoryLines, {
        financeSource: { kind: "order_reservation", id: orderData.inventoryReservationSourceId },
        channel: "pos",
        locationId: posLocationId,
      }).catch((restoreErr) =>
        console.error("Failed to restore inventory after POS order failure:", restoreErr),
      );
      throw new Error("Failed to create POS order after retries");
    }

    // Inventory was decremented before the order was created, so the
    // sub-orders should be marked reserved now that we have the order ID.
    await markOrderInventoryReserved(String(order._id)).catch((err) =>
      console.error("Failed to mark inventory reserved on POS order:", err),
    );

    // Store credit held for the sale is now the order's, and spent: the goods
    // (or the deposit's share of them) went over the counter on it.
    if (payment.storeCredit) {
      await linkStoreCreditHold({ holdKey: payment.storeCredit.holdKey, orderId: order._id });
      await settleOrderStoreCredit(order).catch((err) =>
        console.error("Failed to spend the store credit on a POS sale:", err),
      );
    }

    // The charge row (and through it the ledger) waits for the whole sale to
    // be paid: a deposit is money held against a sale not yet made.
    if (!isDeposit) await ensureChargeTransaction({
      _id: String(order._id),
      orderNumber: order.orderNumber,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      paymentId: order.paymentId,
      stripePaymentIntentId: order.stripePaymentIntentId,
      paypalCaptureId: order.paypalCaptureId,
      subtotal: order.subtotal,
      shippingCost: order.shippingCost,
      tax: order.tax,
      discount: order.discount,
      total: order.total,
      paymentFee: order.paymentFee,
      paymentFeeCurrency: order.paymentFeeCurrency,
      paymentFeeRate: order.paymentFeeRate,
      currency: order.currency || settings.general?.defaultCurrency,
      channel: order.channel,
      posLocationId: order.posLocationId ? String(order.posLocationId) : undefined,
      paymentMetadata: payment.metadata,
      createdAt: order.createdAt,
    });

    await notifyOrderCreatedParticipants(order).catch((err) =>
      console.error("Failed to create POS order notifications:", err),
    );

    // Raised after the order is safely committed: the sale is never held up by
    // a notification, and nothing is reported that did not actually happen.
    await notifyPOSOversold({
      orderNumber: order.orderNumber,
      localReceiptNumber: normalizedLocalReceiptNumber,
      lines: oversoldLines,
    });

    // A POS sale is born paid and delivered, so it never passes through an
    // admin status transition — which is why every POS order's timeline used
    // to read "No events yet" for its entire life. Record both facts here.
    const posAuditContext = createAuditContext(request, session);
    await auditOrderPlaced(posAuditContext, order, {
      source: "pos",
      total: order.total,
      currency: order.currency,
      itemCount: order.items.length,
      paymentMethod: order.paymentMethod,
    });
    if (!isDeposit) await auditOrderPaid(posAuditContext, order, {
      gateway: order.paymentMethod,
      amount: order.total,
      currency: order.currency,
      transactionId: order.paymentId,
    });

    // Refresh the buyer's denormalized stats (only when a real customer was
    // attached — walk-in sales fall back to the staff user, which isn't a
    // customer profile worth counting).
    // Consent given at the counter, on the customer the sale was attached to.
    // Only ever a subscribe: a shopper leaves the list from the link in the
    // email, not by a cashier forgetting to tick a box.
    if (customerId && posMarketingOptIn === true) {
      const { setMarketingConsent } = await import(
        "@/lib/customers/marketing-consent"
      );
      const { MARKETING_CONSENT_SOURCE, MARKETING_CONSENT_STATE, MARKETING_OPT_IN_LEVEL } =
        await import("@/config/app.config");
      await setMarketingConsent({
        state: MARKETING_CONSENT_STATE.SUBSCRIBED,
        // Nobody recorded how the shopper said yes at a counter, and claiming
        // a single opt-in would say more than the till knows.
        optInLevel: MARKETING_OPT_IN_LEVEL.UNKNOWN,
        source: MARKETING_CONSENT_SOURCE.POS,
        userId: String(customerId),
        createIfMissing: true,
      }).catch((err) =>
        console.error("Failed to record POS marketing consent:", err),
      );
    }

    if (guestCustomer) {
      const { refreshCustomerStatsForOrder } = await import("@/lib/customers/customer");
      refreshCustomerStatsForOrder(order).catch((err) =>
        console.error("Failed to refresh guest customer stats:", err),
      );
    }

    if (customerId) {
      const { awardOrderLoyaltyPoints, refreshCustomerStats } = await import(
        "@/lib/customers/customer"
      );
      // Points follow the money: a deposit sale earns them when it is paid off.
      if (!isDeposit) {
        await awardOrderLoyaltyPoints(String(order._id)).catch((err) =>
          console.error("Failed to award loyalty points:", err),
        );
      }
      refreshCustomerStats(String(customerId))
        .catch((err) =>
          console.error("Failed to refresh customer stats:", err),
        );
    }

    return createdResponse(order);
  },
);

/**
 * GET /api/pos/orders?search=&due=1&locationId= — the register's own counter
 * sales, for collecting a balance, a return, or a receipt sent again. See
 * lib/pos/pos-order-search.ts.
 */
export const GET = withApi(
  { auth: "user", rateLimit: { action: "pos:orders:search", preset: "lenient" } },
  async ({ request, session }) => {
    const { searchParams } = new URL(request.url);
    const settings = await getSettingsLean();
    return successResponse(
      await searchPOSSales({
        user: session.user,
        search: searchParams.get("search") || undefined,
        dueOnly: searchParams.get("due") === "1",
        locationId: searchParams.get("locationId") || undefined,
        settings,
      }),
    );
  },
);
