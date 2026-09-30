import { mongoose } from "@/lib/db";
import {
  COD_COLLECTED_BY,
  ORDER_STATUS,
  PAYMENT_STATUS,
} from "@/config/app.config";
import type {
  IOrder,
  OrderItem,
  SubOrder,
  Address,
  OrderLoyaltyState,
} from "@/types";
import {
  MAX_RETURN_WINDOW_DAYS,
  MIN_RETURN_WINDOW_DAYS,
  RETURN_SHIPPING_REFUND_MODES,
  RETURN_WINDOW_STARTS,
  returnTermsForNewOrder,
} from "@/lib/returns/return-policy";

const { Schema, models, model } = mongoose;

/**
 * Address Sub-Schema
 */
const AddressSchema = new Schema<Address>(
  {
    fullName: { type: String },
    firstName: { type: String },
    lastName: { type: String },
    street: { type: String, required: true },
    apartment: { type: String },
    city: { type: String, required: true },
    state: { type: String, required: true },
    // Not required: the checkout settings can leave the postcode optional or
    // hidden, for countries that have none.
    postalCode: { type: String },
    country: { type: String, required: true },
    phone: { type: String },
  },
  { _id: false }
);

/**
 * Order Item Sub-Schema
 */
const OrderItemSchema = new Schema<OrderItem>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    variantId: {
      type: Schema.Types.ObjectId,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    sku: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    /**
     * What this unit cost the seller, snapshotted at the sale — the basis for
     * every margin figure finance reports.
     *
     * Deliberately optional and WITHOUT a default: a missing cost means the
     * seller does not track one, and defaulting it to 0 would report the whole
     * sale price as profit. Orders placed before this field existed keep it
     * absent, which is what lets a report name that period instead of printing
     * a false margin for it. See lib/products/item-cost.ts.
     */
    cost: {
      type: Number,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    image: {
      type: String,
    },
    purchaseType: {
      type: String,
      enum: ["standard", "preorder"],
      default: "standard",
    },
    // The quote whose offer priced this line. Kept on the order so the sale
    // can be traced back to the negotiation that produced it, and so settling
    // the payment can close the quote out.
    quoteId: {
      type: Schema.Types.ObjectId,
      ref: "QuoteRequest",
    },
    // Sold as final sale: the shopper cannot return it. Written when the order
    // is placed (see `stampFinalSaleLines`) and deliberately without a
    // default — an older line has none and stays returnable.
    finalSale: {
      type: Boolean,
    },
    // This line's own return window, from its product or a collection — the
    // smallest that applied when the order was placed. Absent, the order's
    // window applies (see lib/returns/return-window.ts).
    returnWindowDays: {
      type: Number,
      min: MIN_RETURN_WINDOW_DAYS,
      max: MAX_RETURN_WINDOW_DAYS,
    },
    preorderReleaseDate: {
      type: Date,
    },
    preorderMessage: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    preorderStatus: {
      type: String,
      enum: [
        "reserved",
        "payment_due",
        "delayed",
        "partially_ready",
        "ready",
        "fulfilled",
        "cancelled",
        "expired",
      ],
    },
    preorderPaymentMode: {
      type: String,
      enum: ["full", "deposit", "pay_later"],
    },
    preorderDepositAmount: {
      type: Number,
      min: 0,
    },
    preorderOutstandingAmount: {
      type: Number,
      min: 0,
    },
    preorderSupplierEta: {
      type: Date,
    },
    preorderBatchName: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    customs: {
      countryOfOrigin: { type: String, trim: true },
      hsCode: { type: String, trim: true },
      description: { type: String, trim: true, maxlength: 500 },
      weight: { type: Number, min: 0 },
      weightUnit: { type: String, enum: ["g", "kg", "lb", "oz"] },
    },
    /**
     * This line's share of the order's coupon discount on goods, recorded at
     * checkout (see `splitCouponAcrossLines`). A return of the line gives back
     * what it actually sold for; without it a coupon on one product was spread
     * over every line. Absent on orders from before it was recorded, and on
     * orders with no goods coupon — which keep the order-wide share.
     */
    couponDiscount: {
      type: Number,
      min: 0,
    },
    // Per-line discount (applied before any order-level discount)
    lineDiscount: {
      type: {
        type: String,
        enum: ["percent", "amount"],
      },
      value: { type: Number, min: 0 },
      amount: { type: Number, min: 0, default: 0 },
    },
    // Per-line note attached by the cashier
    lineNote: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  { _id: false }
);

const PickupFulfillmentSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor" },
    // Historical only: orders booked under the removed slot system. Nothing
    // writes these now, and no reader may assume they are present.
    reservationId: { type: Schema.Types.ObjectId },
    pickupLocationId: String,
    pickupLocationName: String,
    pickupArea: String,
    pickupAddress: String,
    instructions: String,
    timeZone: String,
    startAt: Date,
    endAt: Date,
    status: { type: String, enum: ["scheduled", "ready", "collected"] },
    readyAt: Date,
    collectedAt: Date,
  },
  { _id: false },
);

const FulfillmentSchema = new Schema(
  {
    method: { type: String, enum: ["delivery", "pickup"], default: "delivery" },
    pickup: PickupFulfillmentSchema,
    /**
     * Which branch a DELIVERY order is dispatched from.
     *
     * Pickup needs no equivalent: `pickup.pickupLocationId` already names the
     * counter the shopper chose, and that is by definition where the goods have
     * to be. Delivery had nothing at all — the stock decrement quietly drew from
     * whichever branch happened to hold the most, so a two-branch merchant could
     * not tell which of their shops had just sold something.
     *
     * Stamped by `markOrderInventoryReserved` from the merchant's configured
     * dispatch order (`lib/locations/fulfillment-location.ts`), and changeable
     * per order afterwards — the assignment is a starting answer, not a verdict.
     */
    fulfillmentLocationId: { type: Schema.Types.ObjectId, ref: "InventoryLocation" },
    /**
     * Snapshotted alongside the id, exactly as the pickup branch's name is: an
     * order is a historical record, and a branch that is later renamed or
     * deleted must not blank the paperwork of everything it ever shipped.
     */
    fulfillmentLocationName: String,
  },
  { _id: false },
);

/**
 * Sub-Order Schema (for multi-vendor order splitting)
 */
const SubOrderSchema = new Schema<SubOrder>({
  vendorId: {
    type: Schema.Types.ObjectId,
    ref: "Vendor",
    required: true,
  },
  items: {
    type: [OrderItemSchema],
    default: [],
  },
  subtotal: {
    type: Number,
    required: true,
    min: 0,
  },
  commission: {
    type: Number,
    required: true,
    min: 0,
  },
  vendorEarnings: {
    type: Number,
    required: true,
    min: 0,
  },
  // Shipping charged for this vendor's shipment. In multi-vendor carts each
  // sub-order is rated independently and the order-level shippingCost is the
  // sum of these.
  shippingCost: {
    type: Number,
    default: 0,
    min: 0,
  },
  shippingMethod: {
    name: { type: String },
    optionId: { type: String },
    minDays: { type: Number },
    maxDays: { type: Number },
  },
  fulfillment: { type: FulfillmentSchema },
  status: {
    type: String,
    enum: Object.values(ORDER_STATUS),
    default: ORDER_STATUS.PENDING,
  },
  /**
   * Whether THIS vendor's share of the order has been collected.
   *
   * The order-level `paymentStatus` is a single field, so on a split order one
   * vendor marking their cash collected used to declare the whole order paid:
   * the courier stopped collecting COD on everybody else's parcels
   * (`lib/shipping/carriers/build-request.ts` reads the order-level flag),
   * siblings' digital files unlocked, and payouts opened on money that had
   * never arrived. Payment is per consignment because custody is.
   *
   * No default, deliberately: absence means "written before the split" and is
   * resolved against the order-level value by
   * `resolveSubOrderPaymentStatus` — a default of `pending` would tell every
   * existing paid order that none of its vendors had been paid.
   * `scripts/backfill-suborder-payment-status.ts` seeds it; readers must stay
   * correct whether or not it has been run.
   */
  paymentStatus: {
    type: String,
    enum: Object.values(PAYMENT_STATUS),
  },
  paidAt: {
    type: Date,
  },
  /**
   * This consignment's slice of a coupon that was limited to some of the cart
   * — one vendor's own coupon, or a product or category list. Absent on an
   * order whose coupon covered everything (or that had none), which shares
   * `Order.discount` by sales exactly as every order before this field did.
   * The ledger, the payout and a return estimate read it, so a vendor's
   * coupon comes out of that vendor's goods and nobody else's.
   */
  couponDiscount: {
    type: Number,
    min: 0,
  },
  /**
   * What a free-shipping coupon took off THIS consignment's delivery.
   *
   * Absent on an order placed before this field (or rated as one shipment
   * without a coupon), where the ledger and the payout share the order's
   * discount over every parcel by its rated cost — which is how those orders
   * were paid out. Stamped, one seller's free-shipping coupon stops costing
   * the other sellers their delivery charge. See `shippingShares` on the
   * validated coupon.
   */
  shippingDiscount: {
    type: Number,
    min: 0,
  },
  /**
   * Stamped when this consignment's share was sent back on its cancellation.
   * The claim that makes that refund happen once, whichever route cancelled
   * it and however many times the request arrived — see
   * `refundOrderCancellation` in lib/orders/preorder-cancel-refund.ts.
   */
  cancelRefundClaimedAt: {
    type: Date,
  },
  /**
   * Whose hands this consignment's cash lands in, frozen at checkout.
   *
   * Only meaningful on a COD order, and stamped regardless so nothing has to
   * re-derive it. Absent means `vendor`, which is what every order written
   * before this behaved as — so no backfill is needed and a store that never
   * touches the setting sees no change. See `lib/cod-collection.ts` for why
   * this is frozen rather than looked up from settings at read time.
   */
  codCollectedBy: {
    type: String,
    enum: Object.values(COD_COLLECTED_BY),
  },
  /**
   * Who earns this consignment's delivery charge, frozen at checkout: the
   * vendor when they deliver it, the store when its courier does. See
   * `lib/shipping/shipping-revenue.ts`.
   *
   * No default, deliberately: absence means "written before this existed",
   * when the store kept every delivery charge, and that is how such an order
   * is still read — a default would hand vendors delivery money on orders
   * they were already paid out for without it.
   */
  shippingRevenueTo: {
    type: String,
    enum: ["vendor", "platform"],
  },
  /**
   * Set while a label bought on the STORE's carrier account covers this
   * parcel: the store paid for delivery, so the store keeps the charge even
   * where the vendor otherwise would. Cleared when that label is voided and
   * refunded. Never touched once the consignment is on a payout — what a
   * payout paid is not taken back by a label bought afterwards.
   */
  platformLabelAt: {
    type: Date,
  },
  /**
   * Who marked it collected. Unset when a gateway settled it — there is no
   * person to name, and the transaction ledger already holds that trail.
   */
  paymentCollectedBy: {
    type: String,
    trim: true,
  },
  trackingNumber: {
    type: String,
  },
  // Whose van this vendor's parcel left on. The order-level `carrier` is a
  // single string, so on a split order the second vendor to ship used to
  // overwrite the first's — each sub-order is its own consignment and owns its
  // own carrier.
  carrier: {
    type: String,
    trim: true,
    maxlength: 100,
  },
  shippedAt: {
    type: Date,
  },
  deliveredAt: {
    type: Date,
  },
  // True while this sub-order's items currently hold a reservation against
  // product stock. Set to true after a successful decrement, flipped back to
  // false (atomically) when its inventory has been restored. Cancel/refund
  // paths use this to avoid double-restoring or restoring a sub-order that
  // never decremented in the first place (e.g., abandoned PayPal orders).
  inventoryReserved: {
    type: Boolean,
    default: false,
  },
  preorderReserved: {
    type: Boolean,
    default: false,
  },
  payoutStatus: {
    type: String,
    enum: ["unpaid", "scheduled", "paid"],
    default: "unpaid",
    index: true,
  },
  payoutId: {
    type: Schema.Types.ObjectId,
    ref: "Payout",
  },
  // When this consignment was CLAIMED onto a payout, which is when its
  // amount stopped moving. The clawback measures refunds against this rather
  // than against `payoutDate`: a refund arriving while a payout sat scheduled
  // was deducted from neither side.
  payoutClaimedAt: {
    type: Date,
  },
  payoutDate: {
    type: Date,
  },
  /**
   * When the platform collected its commission on a sale the merchant settled
   * themselves — cash at the counter, COD, a card on their own terminal.
   *
   * `payoutStatus` above tracks money moving platform → vendor. For a
   * self-collected sale the vendor is already holding all of it, so the only
   * movement left is the opposite one, and it needs its own marker: netting it
   * off a payout that never happens is not an option.
   *
   * Absence means "not collected", which is the state every existing row is
   * already in — so nothing has to be backfilled, and no order-creation path
   * has to remember to stamp it. Whether an order owes commission at all is
   * derived from custody (`lib/payment-custody.ts`), never stored, because a
   * stored copy is one more thing that can disagree with the order it describes.
   */
  commissionSettledAt: {
    type: Date,
    index: true,
  },
  /** The invoice that claimed, and then settled, this consignment. */
  commissionSettlementId: {
    type: Schema.Types.ObjectId,
    ref: "CommissionInvoice",
  },
  /**
   * When that invoice froze its amount — the moment a later refund is measured
   * against, the way `payoutClaimedAt` is for a payout. Absent on consignments
   * invoiced before it existed, which fall back to `commissionSettledAt`.
   */
  commissionClaimedAt: {
    type: Date,
  },
});

/**
 * Order Schema
 */
const OrderLoyaltySchema = new Schema<OrderLoyaltyState>(
  {
    pointsAwarded: { type: Number, min: 0 },
    pointsReversed: { type: Number, min: 0 },
    spendPerPoint: { type: Number, min: 0 },
    awardedAt: { type: Date },
    lastReversedAt: { type: Date },
  },
  { _id: false },
);

const OrderSchema = new Schema<IOrder>(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Guest checkouts point customerId at the guest's cart, not a User, so
    // populating it yields nothing. This snapshot of the email the guest
    // entered at checkout is the only durable contact the public tracking and
    // invoice lookups can match a guest order against.
    guestEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    items: {
      type: [OrderItemSchema],
      required: true,
    },
    subOrders: {
      type: [SubOrderSchema],
      default: [],
    },
    // Per-file download counters for digital deliverables, keyed by the
    // product's digitalAssets._id. Written atomically by the order-gated
    // download route; entitlements themselves are derived from the ordered
    // products, so this only tracks usage against a product's downloadLimit.
    digitalDownloads: {
      type: [
        new Schema(
          {
            assetId: { type: String, required: true },
            count: { type: Number, default: 0 },
            lastDownloadedAt: { type: Date },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    shippingAddress: {
      type: AddressSchema,
      required: true,
    },
    // True when no item on the order needs physical shipping. Digital-only
    // checkouts collect billing only; shippingAddress then holds a copy of
    // the billing address so downstream consumers always have an address —
    // this flag lets displays label it correctly.
    digitalOnly: {
      type: Boolean,
      default: false,
    },
    billingAddress: {
      type: AddressSchema,
    },
    paymentMethod: {
      type: String,
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
    },
    /**
     * When the order's payment was recorded — the first money that arrived,
     * a pre-order's deposit included. The ledger dates the sale by it.
     *
     * Before this the sale was dated by `createdAt`, so a cash order placed on
     * 30 June and paid at the door on 20 July was June's revenue, and a closed
     * June moved it into whatever month happened to be open. A consignment
     * collected on its own carries its own `subOrders[].paidAt`; a balance
     * carries `preorderBalancePaidAt`.
     *
     * Absent on orders recorded before it existed, and on orders nothing has
     * been collected on — the ledger then falls back to the charge row's time.
     */
    paidAt: {
      type: Date,
    },
    // Currency the order was charged in, frozen at creation. Refunds and the
    // ledger must use this — resolving from the CURRENT default currency
    // mislabels historical orders whenever the store currency changes.
    currency: {
      type: String,
      trim: true,
      uppercase: true,
    },
    // Denormalized running total of succeeded refunds. Written via an atomic
    // guarded update so two concurrent refunds cannot both pass the cap check.
    // Null on legacy orders — refund handlers seed it from the historical
    // PaymentTransaction aggregate on first touch.
    refundedTotal: {
      type: Number,
    },
    // Store credit that paid part or all of this order, its hold, and the
    // credit given back on its refunds (R8) — see lib/store-credit/order-credit.ts.
    storeCredit: {
      type: new Schema(
        {
          applied: { type: Number, min: 0 },
          holdKey: { type: String, trim: true },
          state: { type: String, enum: ["held", "spent", "released"] },
          refunded: { type: Number, min: 0 },
        },
        { _id: false },
      ),
      default: undefined,
    },
    // The return this order is the exchange for (R7) — see
    // lib/returns/exchange.ts. What the return was worth pays for it, as
    // `storeCredit` with no hold behind it.
    exchangeOf: {
      type: new Schema(
        {
          returnId: { type: Schema.Types.ObjectId, ref: "ReturnRequest", required: true },
          returnNumber: { type: String, trim: true },
          orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
          orderNumber: { type: String, trim: true },
          undoneAt: { type: Date },
        },
        { _id: false },
      ),
      default: undefined,
    },
    // When everything the shopper can have back has gone back but the
    // delivery a delivered order keeps: the payment reads `partially_refunded`
    // (the store kept the carrier's fee), and the sale is over all the same —
    // stock back when asked, coupon released, digital files closed.
    goodsRefundedAt: {
      type: Date,
    },
    loyalty: {
      type: OrderLoyaltySchema,
    },
    // The return rules this order was sold under — see `returnTermsForNewOrder`.
    // No defaults, deliberately: Mongoose applies a schema default when it
    // hydrates an existing document too, and an order from before this field
    // has to read as carrying none until the store first changes its rules.
    returnTerms: {
      type: new Schema(
        {
          windowDays: {
            type: Number,
            min: MIN_RETURN_WINDOW_DAYS,
            max: MAX_RETURN_WINDOW_DAYS,
          },
          // Sold with no time limit; `windowDays` is then absent.
          windowUnlimited: { type: Boolean },
          windowStart: { type: String, enum: RETURN_WINDOW_STARTS },
          shippingRefund: {
            type: String,
            enum: RETURN_SHIPPING_REFUND_MODES,
          },
          restockingFeePercent: { type: Number, min: 0, max: 100 },
          returnShippingFee: { type: Number, min: 0 },
          source: { type: String, enum: ["order", "legacy"] },
          capturedAt: { type: Date },
        },
        { _id: false },
      ),
      default: undefined,
    },
    // Short-lived claim serializing return-request creation per order, so two
    // concurrent requests can't both pass the returnable-quantity validation.
    // Stale claims (crashed request) expire after a few seconds.
    returnRequestLockAt: {
      type: Date,
    },
    // The same claim for refunds. `refundedTotal` already stops two concurrent
    // refunds exceeding the order between them, but the AMOUNT is not the only
    // thing being decided: each refund also works out which parts of the sale
    // it reverses, by reading the refunds already recorded. Two that read that
    // list at the same moment would each believe the other's share was still
    // unreversed and both claim it. Held across resolving the split and writing
    // the row, in `createRefundTransaction`.
    refundLockAt: {
      type: Date,
    },
    // Set in the write that reserves an in-app refund and cleared once its row
    // is written: while it stands, a gateway refund webhook waits instead of
    // recording the same refund a second time. See lib/orders/refund-in-flight.ts.
    refundInFlightAt: {
      type: Date,
    },
    // Client-generated idempotency key for POS sales. A network blip after the
    // server commits but before the client sees the response makes the cashier
    // retry — the unique partial index below turns that retry into "return the
    // existing order" instead of a second sale + double stock decrement.
    posClientRequestId: {
      type: String,
      trim: true,
    },
    /**
     * The provisional number printed on the receipt when this sale was rung up
     * with no connection (`lib/pos/offline-receipt.ts`), e.g. `TA3F9-0007`.
     *
     * The real `orderNumber` is only assigned when the sale reaches the server,
     * which can be hours later — but the customer walked out with the
     * provisional one, and that is what they present for a return or exchange.
     * Both are kept so either can find the order. Absent on every online sale.
     */
    posLocalReceiptNumber: {
      type: String,
      trim: true,
    },
    /**
     * Lines this replayed offline sale could not cover, as the shelf stood
     * *before* the decrement.
     *
     * Present only when a terminal's queued sale drove stock negative — another
     * register sold the last unit while this one had no connection. The sale is
     * never refused (the goods left the shop), so this is the only record that
     * a shelf count now needs correcting. Absent means nothing went negative.
     */
    posOversoldLines: [
      new Schema(
        {
          productId: { type: Schema.Types.ObjectId, ref: "Product" },
          variantId: { type: Schema.Types.ObjectId },
          name: { type: String, trim: true },
          requested: { type: Number, min: 0 },
          available: { type: Number },
        },
        { _id: false },
      ),
    ],
    /**
     * What the gateway kept out of this charge, as the gateway itself reported
     * it. Stamped once, at completion, by whichever path confirmed the payment.
     *
     * Absent means "not reported", never "free": Pesapal and ioTec expose no fee
     * on their status APIs, and cash, COD and manual orders have no gateway at
     * all. Defaulting it to 0 would let a report claim a margin the store never
     * earned — the same reason `items.cost` has no default.
     *
     * `paymentFeeCurrency` is carried because it is not always the order's
     * currency: Stripe bills the fee in the account's balance currency, so a EUR
     * charge on a USD account is billed in USD. Nothing may subtract the fee
     * from the order total unless the two codes match.
     */
    paymentFee: {
      type: Number,
      min: 0,
    },
    paymentFeeCurrency: {
      type: String,
      trim: true,
      uppercase: true,
    },
    /**
     * The rate the gateway used, when it converted: how many units of
     * `paymentFeeCurrency` one unit of `currency` bought. Only Stripe reports
     * one, and only when it settled a foreign charge.
     *
     * Captured because the rate on the day cannot be reconstructed afterwards —
     * without it a fee billed in another currency can never be stated in the
     * order's own, and the honest report is then "not convertible" forever.
     */
    paymentFeeRate: {
      type: Number,
      min: 0,
    },
    paymentId: {
      type: String,
    },
    stripeSessionId: {
      type: String,
    },
    stripePaymentIntentId: {
      type: String,
    },
    // Indexed via the unique partial indexes declared below — a field-level
    // `index: true` here would collide with them (same key, different options).
    paypalOrderId: {
      type: String,
    },
    paypalCaptureId: {
      type: String,
    },
    razorpayOrderId: {
      type: String,
    },
    /**
     * The cart a gateway checkout was placed from, and a hash of what it was
     * placed for (lines, prices, totals, addresses, coupon). A shopper who
     * leaves a redirect gateway and tries again from the same cart is handed
     * this same order — and its gateway session where that can still be paid —
     * instead of a new pending order per attempt. See
     * `lib/checkout/checkout-attempts.ts`.
     */
    checkoutCartId: {
      type: Schema.Types.ObjectId,
    },
    /**
     * The checkout attempt this order was written from, once the money had
     * actually arrived (`createOrderFromAttempt`). Absent on every order
     * placed before the attempt model, and on the paths that never go through
     * a gateway — cash on delivery, a pay-later pre-order, a till sale, an
     * order an admin made by hand.
     *
     * Its unique index below is the last line of defence against a payment
     * being turned into two orders.
     */
    checkoutAttemptId: {
      type: Schema.Types.ObjectId,
      ref: "CheckoutAttempt",
    },
    checkoutFingerprint: {
      type: String,
    },
    /** The gateway's payment page for this order, kept so a retry can reuse it. */
    gatewayCheckoutUrl: {
      type: String,
    },
    razorpayPaymentId: {
      type: String,
    },
    paystackReference: {
      type: String,
    },
    paystackTransactionId: {
      type: String,
    },
    pesapalOrderTrackingId: {
      type: String,
    },
    pesapalMerchantReference: {
      type: String,
    },
    pesapalConfirmationCode: {
      type: String,
    },
    iotecTransactionId: {
      type: String,
    },
    iotecExternalId: {
      type: String,
    },
    // Our own reference, echoed back in Orange's notification — the only key
    // the callback can look an order up by.
    orangeMoneyOrderId: {
      type: String,
    },
    // Required to call /transactionstatus, which is the only authoritative
    // check Orange offers.
    orangeMoneyPayToken: {
      type: String,
    },
    // Orange signs nothing; this token is the shared secret the notification
    // must present.
    orangeMoneyNotifToken: {
      type: String,
    },
    orangeMoneyTxnId: {
      type: String,
    },
    // The X-Reference-Id UUID we generated for requesttopay — MTN returns no
    // id of its own, so this is the only key the callback, the verify poll and
    // the reconcile sweep can ever look the payment up by.
    mtnMomoReferenceId: {
      type: String,
    },
    // The mobile-money reconcile sweep's bookkeeping. `CheckedAt` rotates the
    // sweep through every pending order instead of re-asking the same first
    // batch; `ClosedAt` marks a payment the gateway says failed for good, so
    // it stops taking a slot at all.
    paymentReconcileCheckedAt: { type: Date },
    // "platform" when the store recorded the money itself (an admin-created
    // order). See PLATFORM_PAYMENT_CUSTODY in lib/payments/payment-custody.ts.
    paymentCustody: { type: String, enum: ["platform"] },
    paymentReconcileClosedAt: { type: Date },
    // MTN's financialTransactionId, present once SUCCESSFUL.
    mtnMomoTransactionId: {
      type: String,
    },
    // The MSISDN the prompt was sent to, kept for support/audit ("which phone
    // was charged?") — the payer's number is not otherwise on the order.
    mtnMomoPhone: {
      type: String,
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    shippingCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Selected shipping method for single-shipment orders. Multi-vendor orders
    // additionally carry a per-subOrder shippingMethod.
    shippingMethod: {
      name: { type: String },
      optionId: { type: String },
      minDays: { type: Number },
      maxDays: { type: Number },
    },
    fulfillment: { type: FulfillmentSchema },
    // Import duties/customs collected at checkout (DDP) or deferred to the
    // customer on delivery (DDU/DAP).
    customs: {
      dutyAmount: { type: Number, default: 0, min: 0 },
      dutyMode: { type: String, enum: ["DDP", "DDU"] },
      international: { type: Boolean, default: false },
      collectedAtCheckout: { type: Boolean, default: false },
    },
    tax: {
      type: Number,
      default: 0,
      min: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountMeta: {
      source: {
        type: String,
        enum: ["pos", "coupon", "manual", "other"],
        default: "pos",
      },
      type: {
        type: String,
        enum: ["percent", "amount"],
      },
      value: {
        type: Number,
        min: 0,
      },
      reason: {
        type: String,
        trim: true,
      },
      note: {
        type: String,
        trim: true,
      },
    },
    coupon: {
      code: {
        type: String,
        uppercase: true,
        trim: true,
      },
      type: {
        type: String,
      },
      value: {
        type: Number,
        min: 0,
      },
      couponId: {
        type: Schema.Types.ObjectId,
        ref: "Coupon",
      },
      /**
       * Who paid for the goods discount, frozen at checkout: the store, or the
       * sellers whose items it discounted. Absent — every order placed before
       * this existed — means the sellers, which is how those orders were paid
       * out and posted. See `fundedBy` on the Coupon model.
       */
      fundedBy: {
        type: String,
        enum: ["platform", "vendor"],
      },
      // Set to true once the coupon's usedCount has actually been
      // incremented for this order. Used to gate decrementing on
      // cancel/refund so we never under- or over-count usage.
      usageIncremented: {
        type: Boolean,
        default: false,
      },
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    hasPreorder: {
      type: Boolean,
      default: false,
      index: true,
    },
    preorderStatus: {
      type: String,
      enum: [
        "reserved",
        "payment_due",
        "delayed",
        "partially_ready",
        "ready",
        "fulfilled",
        "cancelled",
        "expired",
      ],
      index: true,
    },
    preorderReleaseDate: {
      type: Date,
      index: true,
    },
    preorderReserved: {
      type: Boolean,
      default: false,
    },
    preorderAcknowledgedAt: {
      type: Date,
    },
    /**
     * When the shopper authorised their card to be kept and charged for the
     * balance, and the exact words they authorised.
     *
     * Stored rather than derived because that is the whole point of it: a
     * mandate is evidence, and evidence rebuilt later from today's wording
     * proves nothing about what was on screen at the time. Composed server
     * side from the server's own figures — the client sends a bare `true` —
     * so the text cannot be dictated by whoever is checking out. Absent on
     * every pre-order paid in full, which has no balance to authorise.
     *
     * See `lib/payments/preorder-mandate.ts`.
     */
    preorderMandateAcceptedAt: {
      type: Date,
    },
    preorderMandateText: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    /**
     * The card kept for the balance, as a Stripe PaymentMethod.
     *
     * Saved at checkout (`setup_future_usage` on a deposit, a SetupIntent when
     * nothing is charged today) and never used on its own: an off-session
     * charge also needs the shopper's Customer, which is on the user, and the
     * mandate above, which is the permission. Present only where all three are.
     */
    preorderSavedPaymentMethodId: {
      type: String,
    },
    /**
     * The Stripe Customer that saved card is attached to.
     *
     * Kept on the order because Stripe will only charge a saved card
     * off-session when the SAME Customer is named with it, and a guest has no
     * user account to keep a Customer on — theirs is minted for the checkout
     * (`resolveGuestStripeCustomerId`) and lives only here. A signed-in
     * shopper's is stamped too: it is the Customer the card was actually saved
     * against, which a later re-mint on the user (a deleted customer, a new
     * Stripe account) would otherwise lose track of.
     */
    stripeCustomerId: {
      type: String,
    },
    preorderPaymentMode: {
      type: String,
      enum: ["full", "deposit", "pay_later"],
    },
    preorderDepositAmount: {
      type: Number,
      min: 0,
    },
    preorderOutstandingAmount: {
      type: Number,
      min: 0,
    },
    preorderOriginalReleaseDate: {
      type: Date,
    },
    preorderDelayReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    preorderReleaseDateUpdatedAt: {
      type: Date,
    },
    preorderCustomerNotifiedAt: {
      type: Date,
    },
    /**
     * The Stripe PaymentIntent that collected (or is collecting) the deposit
     * balance, separate from `stripePaymentIntentId` — which is the deposit
     * charge and carries a unique index. Stamped when the intent is created so
     * a second "Pay balance" click reuses the open intent instead of minting
     * another; `preorderBalancePaidAt` is set once it succeeded.
     */
    preorderBalancePaymentIntentId: {
      type: String,
    },
    preorderBalancePaidAt: {
      type: Date,
    },
    /**
     * How much the balance payment actually was, stamped with it.
     *
     * Not always `preorderOutstandingAmount`: a consignment cancelled before
     * the balance was asked for comes off what the shopper is charged
     * (`getPreorderBalanceDue`), and without the figure that ACTUALLY arrived
     * a paid order read its whole total as collected — so a later cancel tried
     * to refund money that never came in. Absent on balances recorded before
     * it existed, which keep the old reading.
     */
    preorderBalancePaidAmount: {
      type: Number,
      min: 0,
    },
    /**
     * The gateway's cut of the balance payment alone, stamped with it. The
     * order's `paymentFee` is the deposit's and the balance's together once
     * the balance is in, and without this the balance's fee could not be told
     * apart — so it was never posted.
     */
    preorderBalancePaymentFee: {
      type: Number,
      min: 0,
    },
    /**
     * Which of the store's accounts the balance actually landed in, when it
     * was recorded by hand rather than charged.
     *
     * The order's own `paymentMethod` answers for the DEPOSIT and cannot
     * answer for this: a deposit taken on Stripe and a balance handed over in
     * cash are two different accounts, and a `pay_later` order took nothing at
     * checkout at all. Read as the deposit's, every offline balance was booked
     * into the gateway — the balance of a pay-later order being the whole
     * total of it.
     *
     * Absent on a gateway balance, which lands wherever the charge did, and on
     * every balance recorded before this existed.
     */
    preorderBalancePaidFrom: {
      type: String,
      enum: ["bank", "cash", "gateway"],
    },
    /**
     * The PayPal order raised to collect the balance, while the shopper is
     * away approving it and afterwards.
     *
     * Two jobs, both of which need the ORDER id rather than the capture id the
     * balance reference records: it is how PayPal's return to the capture route
     * finds which Storify order the approval was for, and it is what a refund
     * reads back to ask PayPal how much of the balance is still refundable.
     * Overwritten by a fresh attempt, which is safe: PayPal moves no money on
     * approval, only on the capture call this app makes.
     */
    preorderBalancePaypalOrderId: {
      type: String,
    },
    /**
     * The PayPal order raised from a "pay now" link, for an order whose
     * original payment never arrived.
     *
     * Its own field rather than `paypalOrderId`, which belongs to the checkout
     * that failed: overwriting that one would lose the reference a support
     * question ("PayPal says I paid") is asked about, and would make the
     * checkout finalizer pick up a payment meant for this path.
     */
    payLinkPaypalOrderId: {
      type: String,
    },
    /**
     * When the store actually ASKED for the balance (the move to
     * `payment_due`), as opposed to when the goods were promised.
     *
     * The expiry sweep counted its grace period from the release date alone,
     * which is the right clock only while the two coincide. A batch that
     * lands late — release date in June, stock received and payment requested
     * in July — was already past its grace the moment the request went out,
     * so the shopper was reminded and cancelled in the SAME cron run. Stamped
     * once and never moved by a repeat click, so re-running the action cannot
     * quietly extend a shopper's runway either.
     */
    preorderBalanceRequestedAt: {
      type: Date,
    },
    /**
     * The dunning record for the card on file: how many times the store has
     * tried to take the balance off it, when it last tried, and what Stripe
     * said the last time it refused.
     *
     * All three are one mechanism, not three facts. `...LastChargeAt` is the
     * claim AND the backoff — an attempt is made only by the caller that can
     * move it, and only once it is older than the retry window, so two
     * overlapping sweeps cannot both charge and a failure cannot be retried
     * in a tight loop. `...Attempts` stops the retries after a few rather
     * than hammering a dead card until the expiry sweep gets there.
     * `...LastChargeCode` is Stripe's own code, kept because the answer to
     * `authentication_required` is different in kind from the answer to a
     * decline: no off-session retry will ever pass it, only the shopper can.
     *
     * See `lib/payments/preorder-balance-charge.ts`.
     */
    preorderBalanceChargeAttempts: {
      type: Number,
      min: 0,
    },
    /**
     * When the auto-release sweep last looked at this reservation and left it
     * — its stock not in yet, or its payment not captured. The sweep reads the
     * least recently checked first, so a pile of orders it cannot release yet
     * no longer fills every batch and starves the ones behind them.
     */
    preorderAutoReleaseCheckedAt: {
      type: Date,
    },
    preorderBalanceLastChargeAt: {
      type: Date,
    },
    preorderBalanceLastChargeCode: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    /**
     * Which balance reminders have already gone out, as stage keys.
     *
     * The scheduled job's whole idempotency rests on this: it claims each
     * order with `$addToSet` and only notifies if the claim actually added the
     * stage, so two overlapping runs — or a retry after a timeout — cannot
     * send the same reminder twice. A single `lastReminderSentAt` timestamp
     * could not do that, because two stages fall due in the same window and
     * the second would look like the first.
     */
    preorderBalanceRemindersSent: {
      type: [String],
      default: undefined,
    },
    channel: {
      type: String,
      enum: ["online", "pos"],
      default: "online",
      index: true,
    },
    posLocationId: {
      type: String,
      index: true,
    },
    staffId: {
      type: String,
    },
    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PENDING,
    },
    trackingNumber: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    carrier: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    processingAt: {
      type: Date,
    },
    shippedAt: {
      type: Date,
    },
    deliveredAt: {
      type: Date,
    },
    cancelledAt: {
      type: Date,
    },
    cancelReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    statusChangedBy: {
      type: String,
      trim: true,
    },
    // Last time the auto-ship sweep looked at this order. Written whatever the
    // outcome, so an ineligible order is not re-examined every minute.
    autoShipCheckedAt: {
      type: Date,
    },
    // Shipping paused because a courier can't deliver to the address — see
    // `lib/orders/address-hold-policy.ts`. Not a status: the order keeps its
    // own, and every shipping path asks this instead.
    addressHold: {
      type: new mongoose.Schema(
        {
          state: { type: String, enum: ["open", "released"], required: true },
          reason: {
            type: String,
            enum: ["carrier_refused", "validation_failed", "store"],
            required: true,
          },
          message: { type: String, trim: true, maxlength: 600 },
          placedAt: { type: Date, required: true },
          placedBy: { type: String, trim: true },
          requestedAt: Date,
          requestsSent: { type: Number, min: 0 },
          lastRequestAt: Date,
          deadlineAt: Date,
          expiredAt: Date,
          customerConfirmedAt: Date,
          releasedAt: Date,
          releasedBy: { type: String, trim: true },
          releaseReason: {
            type: String,
            enum: ["address_changed", "store_edited", "store_confirmed", "order_cancelled"],
          },
        },
        { _id: false },
      ),
      default: undefined,
    },
    // The address a check after checkout last looked at, so an unchanged
    // address is not re-checked (and re-billed) on every sweep.
    addressCheck: {
      type: new mongoose.Schema(
        {
          key: { type: String, trim: true },
          checkedAt: Date,
          verdict: { type: String, enum: ["valid", "invalid", "unknown"] },
        },
        { _id: false },
      ),
      default: undefined,
    },
    notes: {
      type: String,
      maxlength: 1000,
    },
    customerNote: {
      type: String,
      maxlength: 1000,
    },
    contactPhone: {
      type: String,
      trim: true,
      maxlength: 30,
    },
    checkoutFields: {
      type: [
        new Schema(
          {
            key: { type: String, required: true },
            label: { type: String, required: true },
            type: { type: String, required: true },
            value: { type: String, maxlength: 1000 },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
// Compound indexes match the real list-query shapes (filter field + createdAt
// desc sort) so admin/customer/vendor/staff order lists seek instead of doing
// an in-memory sort over a filtered collection scan. Each compound's leading
// field also serves the equality-only lookups, so the former single-field
// {customerId}, {status}, {paymentStatus}, {subOrders.vendorId} indexes are
// redundant prefixes and have been folded in. (A database created before this
// change keeps those stale single-field indexes — Mongoose autoIndex only
// creates, it never drops — so drop them by hand if you want the write cost
// back.)
OrderSchema.index({ status: 1, createdAt: -1 });
// Bounds the auto-ship sweep: stamped on every pass regardless of outcome, so
// the scan never re-examines the same order forever.
OrderSchema.index({ status: 1, autoShipCheckedAt: 1 });
// The address-hold sweep reads only open holds.
OrderSchema.index(
  { "addressHold.state": 1, "addressHold.lastRequestAt": 1 },
  { partialFilterExpression: { "addressHold.state": "open" } },
);
OrderSchema.index({ paymentStatus: 1, createdAt: -1 });
// A credit hold is settled or released by what became of its order (R8).
OrderSchema.index({ "storeCredit.holdKey": 1 }, { sparse: true });
// An exchange order by its return (R7), and the credit such orders still wait on.
OrderSchema.index({ "exchangeOf.returnId": 1 }, { sparse: true });
OrderSchema.index({ customerId: 1, createdAt: -1 });
// Guest orders are looked up by the checkout email: the account-claim on
// login relinks them in one updateMany, and guest customer stats aggregate
// over them. Sparse — orders placed by signed-in shoppers never carry it.
OrderSchema.index({ guestEmail: 1 }, { sparse: true });
OrderSchema.index({ "subOrders.vendorId": 1, createdAt: -1 });
OrderSchema.index({ channel: 1, staffId: 1, createdAt: -1 });
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ customerId: 1, "coupon.code": 1 });
OrderSchema.index({ channel: 1, posLocationId: 1 });

// One order per Stripe payment. Partial so the many orders without a Stripe
// id (COD/POS/other gateways, or empty-string values) do not collide. This
// makes finalizeStripe*Order's duplicate-key (11000) guard effective and
// prevents the webhook + /verify fallback from racing into two orders for
// one payment.
OrderSchema.index(
  { stripePaymentIntentId: 1 },
  {
    unique: true,
    partialFilterExpression: { stripePaymentIntentId: { $gt: "" } },
  },
);
OrderSchema.index(
  { stripeSessionId: 1 },
  {
    unique: true,
    partialFilterExpression: { stripeSessionId: { $gt: "" } },
  },
);
OrderSchema.index(
  { pesapalOrderTrackingId: 1 },
  {
    unique: true,
    partialFilterExpression: { pesapalOrderTrackingId: { $gt: "" } },
  },
);
OrderSchema.index(
  { pesapalMerchantReference: 1 },
  {
    unique: true,
    partialFilterExpression: { pesapalMerchantReference: { $gt: "" } },
  },
);
// One POS order per client sale attempt (idempotency key). Partial so the
// many orders without a key don't collide.
OrderSchema.index(
  { posClientRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: { posClientRequestId: { $gt: "" } },
  },
);
// A customer returning an offline sale presents the provisional receipt, which
// is the only number they were ever given. Partial, and NOT unique: two
// terminals that were both reset could in principle reissue a prefix, and a
// lookup aid must never be the thing that refuses to record a completed sale.
OrderSchema.index(
  { posLocalReceiptNumber: 1 },
  { partialFilterExpression: { posLocalReceiptNumber: { $gt: "" } } },
);
// PayPal's return names only its own order id, so this is the lookup the
// capture route makes on every pre-order balance payment. Partial, because all
// but a handful of orders never carry one.
OrderSchema.index(
  { preorderBalancePaypalOrderId: 1 },
  { partialFilterExpression: { preorderBalancePaypalOrderId: { $gt: "" } } },
);
// The same lookup for a "pay now" PayPal approval, and just as rare.
OrderSchema.index(
  { payLinkPaypalOrderId: 1 },
  { partialFilterExpression: { payLinkPaypalOrderId: { $gt: "" } } },
);
/**
 * One attempt, one order — enforced by the database rather than trusted to the
 * claim logic above it.
 *
 * The claim (`finalize.claimedAt` on the attempt) is what normally stops a
 * webhook and the shopper's return from both writing an order. This is what
 * stops them when the claim has a bug in it: the second insert fails, the
 * settlement finds the order the first one wrote, and the payment is recorded
 * once.
 *
 * `$type: "objectId"` rather than `$exists`, so a row that somehow carries a
 * `null` is outside the index too and cannot collide with every other null.
 */
OrderSchema.index(
  { checkoutAttemptId: 1 },
  {
    unique: true,
    partialFilterExpression: { checkoutAttemptId: { $type: "objectId" } },
  },
);
// Mirror the Stripe/Pesapal duplicate-order protection for the remaining
// gateways: nothing should ever create two orders with the same gateway
// reference, and the DB now enforces it.
OrderSchema.index(
  { paypalOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: { paypalOrderId: { $gt: "" } },
  },
);
// A retry looks for the cart's live gateway attempt.
OrderSchema.index(
  { checkoutCartId: 1, status: 1 },
  { partialFilterExpression: { checkoutCartId: { $exists: true } } },
);
OrderSchema.index(
  { razorpayOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: { razorpayOrderId: { $gt: "" } },
  },
);
OrderSchema.index(
  { paystackReference: 1 },
  {
    unique: true,
    partialFilterExpression: { paystackReference: { $gt: "" } },
  },
);
OrderSchema.index(
  { iotecTransactionId: 1 },
  {
    unique: true,
    partialFilterExpression: { iotecTransactionId: { $gt: "" } },
  },
);
OrderSchema.index(
  { iotecExternalId: 1 },
  {
    unique: true,
    partialFilterExpression: { iotecExternalId: { $gt: "" } },
  },
);
OrderSchema.index(
  { orangeMoneyOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: { orangeMoneyOrderId: { $gt: "" } },
  },
);
OrderSchema.index(
  { orangeMoneyTxnId: 1 },
  {
    unique: true,
    partialFilterExpression: { orangeMoneyTxnId: { $gt: "" } },
  },
);
OrderSchema.index(
  { mtnMomoReferenceId: 1 },
  {
    unique: true,
    partialFilterExpression: { mtnMomoReferenceId: { $gt: "" } },
  },
);
OrderSchema.index(
  { mtnMomoTransactionId: 1 },
  {
    unique: true,
    partialFilterExpression: { mtnMomoTransactionId: { $gt: "" } },
  },
);

/**
 * Every order carries the return rules it was sold under.
 *
 * The checkout writes them into the order document itself, so an order made
 * later from a checkout attempt keeps the rules of the moment the shopper paid.
 * This catches every other way an order comes into being (admin, vendor, POS,
 * the Stripe finaliser) without each of them having to remember.
 *
 * Never fails the order: without terms it reads the store's settings, the way
 * every order did before they were stored.
 */
OrderSchema.pre("validate", async function stampReturnTerms() {
  if (!this.isNew || this.returnTerms) return;
  // Nobody opened a connection, so reading the settings would wait for ever
  // and no order is being written anyway: an order is only created after
  // `connectDB()`. This is a model being validated on its own, as a test does.
  if (this.db?.readyState === 0) return;
  try {
    const { getSettings } = await import("@/models/settings.model");
    this.returnTerms = returnTermsForNewOrder(await getSettings());
  } catch (error) {
    console.error("Failed to record an order's return terms:", error);
  }
});

/**
 * Every line carries whether it was sold as final sale, and its own return
 * window when its product or a collection gave it one (R6).
 *
 * The checkout writes both into the document from the products it already
 * has in hand, which is what the shopper was shown; this fills the lines every
 * other way of making an order leaves unmarked. Like the return terms it never
 * fails the order: a line left unmarked is returnable, as every line was
 * before final sale existed, for the order's own window.
 */
OrderSchema.pre("validate", async function stampFinalSaleLines() {
  if (!this.isNew) return;
  const unmarked = (this.items || []).filter(
    (item) => item && typeof item.finalSale !== "boolean",
  );
  if (unmarked.length === 0) return;
  if (this.db?.readyState === 0) return;
  try {
    const [{ returnLineTerms }, { getSettings }] = await Promise.all([
      import("@/lib/returns/final-sale-lines"),
      import("@/models/settings.model"),
    ]);
    const terms = await returnLineTerms(unmarked, await getSettings());
    unmarked.forEach((item, index) => {
      item.finalSale = terms[index]?.finalSale === true;
      const windowDays = terms[index]?.returnWindowDays;
      if (typeof windowDays === "number" && typeof item.returnWindowDays !== "number") {
        item.returnWindowDays = windowDays;
      }
    });
  } catch (error) {
    console.error("Failed to record which order lines are final sale:", error);
  }
});

// Virtual for customer
OrderSchema.virtual("customer", {
  ref: "User",
  localField: "customerId",
  foreignField: "_id",
  justOne: true,
});

export const Order = models.Order || model<IOrder>("Order", OrderSchema);
