import "server-only";

import { Vendor } from "@/models";
import { Shipment, type IShipment } from "@/models/shipment.model";
import { getSettings, type ISettings } from "@/models/settings.model";
import {
  CARRIER_RATE_TTL_MS,
  CARRIER_PROVIDER_LABELS,
  CARRIER_PURCHASE_CLAIM_TTL_MS,
  carrierRouteRefusal,
  isPurchaseClaimStale,
  type CarrierProvider,
} from "@/lib/shipping/carrier-config";
import { ORDER_STATUS } from "@/config/app.config";
import {
  applyShipmentTrackingToOrder,
  clearShipmentTrackingFromOrder,
} from "@/lib/shipping/tracking-cascade";
import type { IOrder, IVendor, SubOrder } from "@/types";
import { buildCarrierShipmentRequest } from "./build-request";
import { resolveCarrierContext, enabledCarrierProviders } from "./credentials";
import { CARRIER_ERROR_CODES, CarrierError } from "./errors";
import { carrierAdapter } from "./registry";
import { isExceptionStatus, shipmentStatusForTracking } from "./status-map";
import { vendorShiprocketPickupLocation } from "./vendor-carriers";
import type {
  CarrierParcel,
  CarrierRateQuote,
  CarrierShipmentRequest,
} from "./types";

/**
 * Everything that actually moves a parcel.
 *
 * Kept out of the routes so the admin surface, the vendor surface and the
 * automation worker all take exactly the same path — three copies of "buy a
 * label" would drift on the first bug fix, and this one spends money.
 */

type OrderForShipment = Pick<
  IOrder,
  | "_id"
  | "orderNumber"
  | "shippingAddress"
  | "currency"
  | "paymentMethod"
  | "paymentStatus"
  | "total"
  | "status"
>;

type SubOrderForShipment = Pick<
  SubOrder,
  | "_id"
  | "vendorId"
  | "items"
  | "subtotal"
  | "shippingCost"
  | "status"
  | "fulfillment"
>;

interface RateShopResult {
  shipment: IShipment;
  quotes: CarrierRateQuote[];
  packing: { strategy: string; warnings: string[]; boxId?: string };
  parcel: CarrierParcel;
}

/** True when a quote list is too old to redeem and must be refreshed. */
function isQuoteStale(quotedAt: Date | undefined | null): boolean {
  if (!quotedAt) return true;
  return Date.now() - new Date(quotedAt).getTime() > CARRIER_RATE_TTL_MS;
}

/**
 * Load just the carrier block of the parcel's vendor.
 *
 * Every carrier call goes through here so a vendor shipping on its own account
 * is honoured identically from the dialog, the worker and the tracking sync.
 */
async function loadCarrierVendor(
  vendorId: SubOrderForShipment["vendorId"] | undefined,
): Promise<Pick<IVendor, "shipping"> | null> {
  if (!vendorId) return null;
  return Vendor.findById(vendorId)
    .select("shipping.carriers")
    .lean<Pick<IVendor, "shipping"> | null>();
}

/**
 * Refuse to re-quote a parcel that already has, or is buying, a label — and
 * report which booking of it the next one would be.
 *
 * The upsert below keys on {order, sub-order, provider}, so a second rate
 * lookup lands on the *bought* shipment and rewrites its courier name, its
 * provider handles and its quote list with a fresh draft's. The label, tracking
 * number and purchase state all survive, which is what makes the damage quiet:
 * the order screen and the customer's email would name "Shippo" rather than the
 * courier actually carrying the box, and the provider handle needed to void it
 * would be gone.
 *
 * An abandoned `purchasing` claim is *not* a reason to refuse. It used to be,
 * which meant one killed worker locked the parcel out of every path it had —
 * dialog, rate route, automation and retry alike.
 */
async function inspectExistingShipments(params: {
  orderId: OrderForShipment["_id"];
  subOrderId: SubOrderForShipment["_id"];
}): Promise<{ bookingSequence: number }> {
  // Both providers' shipments for this parcel, which is at most a handful: the
  // guard has to see a purchase on *any* account, while the booking sequence is
  // the high-water mark across all of them.
  const shipments = await Shipment.find({
    orderId: params.orderId,
    subOrderId: params.subOrderId,
  })
    .select("carrier trackingNumber purchase bookingSequence")
    .lean<
      Array<
        Pick<
          IShipment,
          "carrier" | "trackingNumber" | "purchase" | "bookingSequence"
        >
      >
    >();

  const bought = shipments.find(
    (shipment) =>
      shipment.purchase?.state === "purchased" ||
      (shipment.purchase?.state === "purchasing" &&
        !isPurchaseClaimStale(shipment.purchase)),
  );

  if (bought) {
    throw new CarrierError({
      code: CARRIER_ERROR_CODES.ALREADY_PURCHASED,
      message: bought.trackingNumber
        ? `This parcel already has a ${bought.carrier} label (${bought.trackingNumber}). Void it before buying another.`
        : "A label is already being bought for this parcel.",
      permanent: true,
    });
  }

  return {
    bookingSequence: shipments.reduce(
      (highest, shipment) =>
        Math.max(highest, Number(shipment.bookingSequence) || 0),
      0,
    ),
  };
}

/**
 * Return a voided shipment to a clean draft before it is re-quoted.
 *
 * The upsert keys on {order, sub-order, provider}, so a re-ship lands on the
 * very document whose label was just refunded — and every provider handle on it
 * still points at the dead consignment. `providerTransactionId` is the sharp
 * one: `purchaseLabel` treats it as resume state and would hand back the
 * refunded Shippo transaction as though it were a freshly bought label.
 *
 * `bookingSequence` is deliberately left alone; `voidShipmentLabel` already
 * incremented it, and that is what gets this booking a reference of its own.
 */
async function resetVoidedShipment(filter: Record<string, unknown>) {
  await Shipment.updateOne(
    { ...filter, "purchase.state": "voided" },
    {
      $set: {
        status: "draft",
        "purchase.state": "none",
        "purchase.attempts": 0,
      },
      $unset: {
        trackingNumber: "",
        trackingUrl: "",
        labelUrl: "",
        labelFileType: "",
        providerTransactionId: "",
        providerShipmentId: "",
        providerOrderId: "",
        providerRateId: "",
        serviceToken: "",
        rate: "",
        events: "",
        exception: "",
        lastSyncedAt: "",
        "purchase.startedAt": "",
        "purchase.purchasedAt": "",
        "purchase.voidedAt": "",
        "purchase.idempotencyKey": "",
        "purchase.lastError": "",
        "purchase.lastErrorCode": "",
      },
    },
  );
}

/**
 * MongoDB's duplicate-key error, whichever wrapper it arrives in.
 *
 * Exported for tests: the driver, Mongoose and the bulk-write path all surface
 * E11000 differently, and matching only one of them would leave the retry below
 * dead — which is invisible until two merchants click at the same moment.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    code?: unknown;
    codeName?: unknown;
    // Mongoose wraps the driver error on bulk paths.
    cause?: { code?: unknown };
    writeErrors?: Array<{ code?: unknown }>;
  };
  if (candidate.code === 11000 || candidate.codeName === "DuplicateKey") {
    return true;
  }
  if (candidate.cause?.code === 11000) return true;
  return Boolean(
    candidate.writeErrors?.some((entry) => entry?.code === 11000),
  );
}

/**
 * The rate-shopped draft for one parcel on one carrier.
 *
 * `{orderId, subOrderId, provider}` is uniquely indexed, which is what stops
 * two racing rate lookups — a double click, or the dialog against the
 * automation worker — leaving the parcel with two drafts and the purchase guard
 * reading whichever it happened to load.
 *
 * An upsert is not atomic against a concurrent upsert: both callers miss the
 * filter, both insert, and the unique index rejects the loser with E11000. That
 * turns a silent data problem into a 500, which is better but still wrong —
 * both callers asked for the same draft and both should get it. The retry drops
 * `upsert`, because by then the winner's document is certainly there, so the
 * loser simply updates it. If it somehow is not, the caller's null check
 * reports a failed save rather than this pretending to have succeeded.
 */
async function upsertShipmentDraft(
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
): Promise<IShipment | null> {
  try {
    return await Shipment.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
      runValidators: true,
    }).lean<IShipment | null>();
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    return Shipment.findOneAndUpdate(filter, update, {
      new: true,
      runValidators: true,
    }).lean<IShipment | null>();
  }
}

function assertShippable(subOrder: SubOrderForShipment) {
  if (subOrder.fulfillment?.method === "pickup") {
    throw new CarrierError({
      code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
      message: "Pickup orders are collected in store, not shipped",
      permanent: true,
    });
  }
  if (subOrder.status === "cancelled") {
    throw new CarrierError({
      code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
      message: "This sub-order is cancelled",
      permanent: true,
    });
  }
}

/**
 * Pick the provider when the caller did not.
 *
 * Only providers that both hold credentials and declare they can serve the
 * lane are considered, so a US store with Shiprocket switched on never gets an
 * Indian-only quote attempt.
 */
async function pickProvider(params: {
  requested?: CarrierProvider;
  settings: ISettings;
  /** The parcel's vendor, which may hold the only usable credentials. */
  vendor?: Pick<IVendor, "shipping"> | null;
  originCountry: string;
  destinationCountry: string;
}): Promise<CarrierProvider> {
  const available = await enabledCarrierProviders(
    params.settings,
    params.vendor,
  );
  if (available.length === 0) {
    throw new CarrierError({
      code: CARRIER_ERROR_CODES.NOT_CONFIGURED,
      message:
        "No shipping carrier is connected. Add one in Settings → Shipping.",
      permanent: true,
    });
  }

  // A vendor dispatching from its own registered location is as good as the
  // platform having one; reading only the platform's meant a vendor with its
  // own Shiprocket account was told it "cannot ship this route".
  const hasPickupLocation = Boolean(
    vendorShiprocketPickupLocation(params.vendor?.shipping?.carriers) ||
    params.settings.shipping?.carriers?.shiprocket?.pickupLocationName,
  );
  const capable = available.filter((provider) =>
    carrierAdapter(provider).supports({
      originCountry: params.originCountry,
      destinationCountry: params.destinationCountry,
      hasPickupLocation,
    }),
  );

  if (params.requested) {
    if (!available.includes(params.requested)) {
      throw new CarrierError({
        provider: params.requested,
        code: CARRIER_ERROR_CODES.NOT_CONFIGURED,
        message: `${CARRIER_PROVIDER_LABELS[params.requested]} is not connected`,
        permanent: true,
      });
    }
    if (!capable.includes(params.requested)) {
      throw new CarrierError({
        provider: params.requested,
        code: CARRIER_ERROR_CODES.UNSUPPORTED_ORIGIN,
        message: carrierRouteRefusal(params.requested, params.originCountry),
        permanent: true,
      });
    }
    return params.requested;
  }

  if (capable.length === 0) {
    throw new CarrierError({
      code: CARRIER_ERROR_CODES.UNSUPPORTED_ORIGIN,
      // Each connected carrier's own reason rather than a bare "no carrier can
      // ship this route": there are at most two, so the list stays short, and
      // the origin country — the thing the merchant has to change — is named.
      message: available
        .map((provider) => carrierRouteRefusal(provider, params.originCountry))
        .join(" "),
      permanent: true,
    });
  }
  return capable[0]!;
}

/**
 * Rate-shop a sub-order and record the quotes on a draft shipment.
 *
 * Upserts on {orderId, subOrderId, provider}, so re-opening the dialog
 * refreshes the same draft rather than littering the order with one shipment
 * per rate lookup.
 */
export async function rateShopSubOrder(params: {
  order: OrderForShipment;
  subOrder: SubOrderForShipment;
  actorId: string;
  customerEmail?: string;
  provider?: CarrierProvider;
  packageId?: string;
  parcelOverride?: CarrierParcel;
  settings?: ISettings;
}): Promise<RateShopResult> {
  assertShippable(params.subOrder);
  const { bookingSequence } = await inspectExistingShipments({
    orderId: params.order._id,
    subOrderId: params.subOrder._id,
  });
  const settings = params.settings ?? (await getSettings());

  const built = await buildCarrierShipmentRequest({
    order: params.order,
    subOrder: params.subOrder,
    settings,
    customerEmail: params.customerEmail,
    packageId: params.packageId,
    parcelOverride: params.parcelOverride,
    bookingSequence,
  });

  // Loaded before the provider is chosen, not after: a vendor on its own
  // account may be the only holder of the credentials that make a provider
  // available at all.
  const vendor = await loadCarrierVendor(params.subOrder.vendorId);
  const provider = await pickProvider({
    requested: params.provider,
    settings,
    vendor,
    originCountry: built.request.shipFrom.country,
    destinationCountry: built.request.shipTo.country,
  });

  const context = await resolveCarrierContext({ provider, settings, vendor });
  // Sorted here rather than in each adapter, so the order the merchant sees,
  // the order stored on the draft and the order a re-quote produces are one
  // decision made once. The dialog's default is the first row.
  const quotes = sortQuotesCheapestFirst(
    await carrierAdapter(provider).getRates(context, built.request),
  );

  const parcel = built.request.parcels[0]!;
  const quotedAt = new Date();

  const upsertKey = {
    orderId: params.order._id,
    subOrderId: params.subOrder._id,
    provider,
  };

  // After the rates are in hand, so a provider that refuses to quote leaves the
  // voided record intact rather than half-erased.
  await resetVoidedShipment(upsertKey);

  const shipment = await upsertShipmentDraft(
    upsertKey,
    {
      $set: {
        orderNumber: params.order.orderNumber,
        vendorId: params.subOrder.vendorId,
        // Placeholder until a rate is bought and the real courier is known.
        carrier: CARRIER_PROVIDER_LABELS[provider],
        source: "carrier_api",
        providerMode: context.mode,
        providerShipmentId: quotes[0]?.shipmentId,
        shipFrom: {
          fullName: built.request.shipFrom.name,
          street: built.request.shipFrom.street1,
          apartment: built.request.shipFrom.street2,
          city: built.request.shipFrom.city,
          state: built.request.shipFrom.state,
          postalCode: built.request.shipFrom.postalCode,
          country: built.request.shipFrom.country,
          phone: built.request.shipFrom.phone,
        },
        shipTo: {
          fullName: built.request.shipTo.name,
          street: built.request.shipTo.street1,
          apartment: built.request.shipTo.street2,
          city: built.request.shipTo.city,
          state: built.request.shipTo.state,
          postalCode: built.request.shipTo.postalCode,
          country: built.request.shipTo.country,
          phone: built.request.shipTo.phone,
        },
        parcel: {
          weight: parcel.weight,
          weightUnit: parcel.weightUnit,
          length: parcel.length,
          width: parcel.width,
          height: parcel.height,
          dimensionUnit: parcel.dimensionUnit,
        },
        packageId: built.packing.boxId,
        contactEmail: params.customerEmail,
        label: { source: "carrier", format: "pdf" },
        quotes: quotes.map((quote) => ({
          rateId: quote.rateId,
          carrierName: quote.carrierName,
          serviceName: quote.serviceName,
          serviceToken: quote.serviceToken,
          amount: quote.amount,
          currency: quote.currency,
          estimatedDays: quote.estimatedDays,
          attributes: quote.attributes ?? [],
        })),
        quotedAt,
      },
      $setOnInsert: {
        orderId: params.order._id,
        provider,
        status: "draft",
        createdBy: params.actorId,
        purchase: { state: "none", attempts: 0 },
      },
    },
  );

  if (!shipment) {
    // The upsert always returns a document; a null here means the write was
    // lost, and silently returning a half-result would show the merchant rates
    // they cannot buy.
    throw new CarrierError({
      provider,
      code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
      message: "Could not save the shipment draft",
      permanent: false,
    });
  }

  return {
    shipment,
    quotes,
    packing: {
      strategy: built.packing.strategy,
      warnings: built.packing.warnings,
      boxId: built.packing.boxId,
    },
    parcel,
  };
}

/**
 * Compare two delivery estimates, treating "no estimate" as slowest.
 *
 * Subtracting the two directly returns `NaN` when both are unknown — infinity
 * minus infinity — and a comparator that answers `NaN` has undefined ordering.
 * Every quote from a carrier that publishes no ETA hits exactly that case.
 */
function compareEstimatedDays(a?: number, b?: number): number {
  const aDays = a ?? Number.POSITIVE_INFINITY;
  const bDays = b ?? Number.POSITIVE_INFINITY;
  if (aDays === bDays) return 0;
  return aDays - bDays;
}

/**
 * Cheapest first, ties broken by speed.
 *
 * Applied to every rate list as it arrives, not only inside the automation
 * policy. The Send-to-courier dialog pre-selects the first row, so "first" is a
 * default that spends the merchant's money — and neither provider promises an
 * order: Shippo returns rates in whatever sequence its carrier accounts
 * answered in, and Shiprocket's serviceability list is ordered by its own
 * recommendation. The pre-selected rate was therefore arbitrary while the UI
 * presented it as the obvious choice.
 *
 * Exported for tests, and used by `selectQuote` so "cheapest" cannot come to
 * mean two different things in the two places a merchant meets it.
 */
export function sortQuotesCheapestFirst<
  T extends { amount: number; estimatedDays?: number },
>(quotes: T[]): T[] {
  return [...quotes].sort((a, b) => {
    if (a.amount !== b.amount) return a.amount - b.amount;
    return compareEstimatedDays(a.estimatedDays, b.estimatedDays);
  });
}

/**
 * Choose which quote to buy under an automation policy.
 *
 * Exported because the worker applies the same rule the merchant sees in the
 * settings form — "cheapest" must mean the same thing in both places.
 */
export function selectQuote(
  quotes: CarrierRateQuote[],
  policy: {
    rateChoice?: "cheapest" | "fastest" | "fixed_service";
    fixedServiceToken?: string;
  },
): CarrierRateQuote | undefined {
  if (quotes.length === 0) return undefined;

  if (policy.rateChoice === "fixed_service" && policy.fixedServiceToken) {
    // No silent fallback: a merchant who named a service and did not get it
    // would rather the shipment wait than travel by something else.
    return quotes.find(
      (quote) => quote.serviceToken === policy.fixedServiceToken,
    );
  }

  if (policy.rateChoice === "fastest") {
    return [...quotes].sort((a, b) => {
      const byDays = compareEstimatedDays(a.estimatedDays, b.estimatedDays);
      return byDays !== 0 ? byDays : a.amount - b.amount;
    })[0];
  }

  return sortQuotesCheapestFirst(quotes)[0];
}

/**
 * Buy the label for a rate-shopped shipment.
 *
 * Claims the shipment first with a compare-and-set on `purchase.state`: two
 * clicks, or a worker racing a merchant, must never buy two labels for one
 * parcel. A `null` claim means somebody else owns it and this call is a no-op
 * rather than an error.
 */
export async function purchaseShipmentLabel(params: {
  shipmentId: string;
  order: OrderForShipment;
  subOrder: SubOrderForShipment;
  rateId?: string;
  serviceToken?: string;
  actorId: string;
  customerEmail?: string;
  settings?: ISettings;
  /**
   * How to react when the named rate is gone by the time we buy.
   *
   * `exact` — somebody chose this service and must get it or nothing. `policy`
   * — the caller expressed a *rule* ("cheapest") rather than a rate, so
   * re-applying the rule to the fresh quotes is what they asked for. Defaults
   * to `exact`: a caller that named a rate and silently got a different one is
   * a merchant charged for a service they did not pick.
   */
  rateSelection?: "exact" | "policy";
  /**
   * Hard ceiling on what this label may cost, in the carrier account's own
   * currency. Supplied by automation, which checked the quote it chose — but
   * the quote actually redeemed can differ from the one checked when the stored
   * rates had expired, and a cap that stops applying at that point is not a cap.
   */
  maxAmount?: number;
}): Promise<{ shipment: IShipment; alreadyOwned?: boolean }> {
  const settings = params.settings ?? (await getSettings());

  const staleClaimBefore = new Date(Date.now() - CARRIER_PURCHASE_CLAIM_TTL_MS);
  const claimed = await Shipment.findOneAndUpdate(
    {
      _id: params.shipmentId,
      $or: [
        { "purchase.state": { $in: ["none", "failed"] } },
        // An abandoned claim. Resuming it is safe — the provider handles are
        // checkpointed, Shippo recovers the transaction it already made and
        // Shiprocket refuses a duplicate order id — and leaving it alone strands
        // the parcel permanently.
        {
          "purchase.state": "purchasing",
          "purchase.startedAt": { $lte: staleClaimBefore },
        },
        {
          "purchase.state": "purchasing",
          "purchase.startedAt": { $exists: false },
        },
      ],
    },
    {
      $set: {
        "purchase.state": "purchasing",
        "purchase.startedAt": new Date(),
      },
      $inc: { "purchase.attempts": 1 },
    },
    { new: true },
  ).lean<IShipment>();

  if (!claimed) {
    const existing = await Shipment.findById(
      params.shipmentId,
    ).lean<IShipment>();
    if (!existing) {
      throw new CarrierError({
        code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
        message: "Shipment not found",
        permanent: true,
      });
    }
    if (existing.purchase?.state === "voided") {
      // A voided parcel has no live rate to redeem, so buying against this
      // shipment as it stands is not a no-op — it is a request that cannot be
      // honoured. Reporting it as "already purchased" is how a merchant ended
      // up watching a success toast while nothing shipped.
      throw new CarrierError({
        provider: existing.provider,
        code: CARRIER_ERROR_CODES.RATE_EXPIRED,
        message:
          "This label was voided. Refresh the rates and choose a service to ship it again.",
        permanent: true,
      });
    }
    // Already bought, or another worker is genuinely mid-purchase. Either way
    // there is nothing for this call to do, and reporting an error would invite
    // a retry that buys a second label.
    return { shipment: existing, alreadyOwned: true };
  }

  const provider = claimed.provider;
  if (!provider) {
    await markPurchaseFailed(params.shipmentId, "Shipment has no carrier");
    throw new CarrierError({
      code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
      message: "This shipment was not created through a carrier",
      permanent: true,
    });
  }

  try {
    const vendor = await loadCarrierVendor(params.subOrder.vendorId);
    const context = await resolveCarrierContext({ provider, settings, vendor });
    const adapter = carrierAdapter(provider);

    const built = await buildCarrierShipmentRequest({
      order: params.order,
      subOrder: params.subOrder,
      settings,
      customerEmail: params.customerEmail ?? claimed.contactEmail,
      packageId: claimed.packageId,
      parcelOverride: parcelFromShipment(claimed),
      // The reference the provider de-duplicates on. Reading it off the claimed
      // shipment is what keeps a retry pointed at its own consignment and a
      // re-ship after a void pointed away from the cancelled one.
      bookingSequence: claimed.bookingSequence,
    });

    const quote = await resolveQuoteForPurchase({
      shipment: claimed,
      request: built.request,
      adapter,
      context,
      rateId: params.rateId,
      serviceToken: params.serviceToken,
      selection: params.rateSelection ?? "exact",
      settings,
    });

    if (
      typeof params.maxAmount === "number" &&
      params.maxAmount > 0 &&
      quote.amount > params.maxAmount
    ) {
      throw new CarrierError({
        provider,
        code: CARRIER_ERROR_CODES.RATE_EXPIRED,
        message: `The only rate still available costs ${quote.amount} ${quote.currency}, above the ${params.maxAmount} automation limit. Buy this label by hand if it is worth it.`,
        permanent: true,
      });
    }

    const label = await adapter.purchaseLabel(context, {
      quote,
      request: built.request,
      idempotencyKey:
        claimed.purchase?.idempotencyKey || built.request.reference,
      resume: {
        providerOrderId: claimed.providerOrderId,
        providerShipmentId: claimed.providerShipmentId,
        providerTransactionId: claimed.providerTransactionId,
        trackingNumber: claimed.trackingNumber,
        labelUrl: claimed.labelUrl,
      },
      onProgress: (resume) =>
        persistPurchaseProgress(params.shipmentId, resume),
    });

    const updated = await Shipment.findByIdAndUpdate(
      params.shipmentId,
      {
        $set: {
          carrier: label.carrierName,
          service: label.serviceName || quote.serviceName,
          trackingNumber: label.trackingNumber,
          trackingUrl: label.trackingUrl,
          labelUrl: label.labelUrl,
          labelFileType: label.labelFormat,
          providerRateId: quote.rateId,
          providerTransactionId: label.transactionId,
          providerShipmentId:
            label.resume?.providerShipmentId ?? claimed.providerShipmentId,
          providerOrderId:
            label.resume?.providerOrderId ?? claimed.providerOrderId,
          serviceToken: quote.serviceToken,
          rate: {
            amount: label.amount ?? quote.amount,
            // Stored verbatim in the carrier account's currency — never
            // converted into the store's, and never written to shippingCost.
            currency: label.currency ?? quote.currency,
            // What the books were kept in on the day. Settings only ever hold
            // the CURRENT currency, so this is unrecoverable once it changes.
            baseCurrency: settings.general?.defaultCurrency,
            estimatedDays: quote.estimatedDays,
            carrierName: label.carrierName,
          },
          status: "label_ready",
          label: { source: "carrier", format: labelFormat(label.labelFormat) },
          "purchase.state": "purchased",
          "purchase.purchasedAt": new Date(),
          "purchase.idempotencyKey": built.request.reference,
          // Whose money bought it, recorded now because the answer can change
          // the moment a vendor connects or drops their own carrier account.
          "purchase.billedTo": context.accountOwner,
          "purchase.lastError": null,
          "purchase.lastErrorCode": null,
        },
      },
      { new: true, runValidators: true },
    ).lean<IShipment>();

    // The first real cost of sale the product records. Posted in the carrier's
    // own currency — no rate exists to convert it, and inventing one would be
    // worse than a report that names the currency it is in.
    if (updated?.rate?.amount) {
      const { postShipmentLabelSafely } = await import(
        "@/lib/finance/post-events"
      );
      postShipmentLabelSafely({
        _id: updated._id,
        vendorId: updated.vendorId,
        orderId: updated.orderId,
        rate: updated.rate,
        purchasedAt: updated.purchase?.purchasedAt ?? new Date(),
        // A re-ship lands on this same document, so the booking number is what
        // stops the second label's cost colliding with the first one's entry.
        bookingSequence: updated.bookingSequence,
        billedTo: updated.purchase?.billedTo,
      });
    }

    return { shipment: updated! };
  } catch (error) {
    const carrierError = error instanceof CarrierError ? error : undefined;
    await markPurchaseFailed(
      params.shipmentId,
      error instanceof Error ? error.message : String(error),
      carrierError?.code,
    );
    throw error;
  }
}

function labelFormat(format: string): "pdf" | "zpl" | "png" {
  const upper = format.toUpperCase();
  if (upper.startsWith("ZPL")) return "zpl";
  if (upper === "PNG") return "png";
  return "pdf";
}

function parcelFromShipment(shipment: IShipment): CarrierParcel | undefined {
  const parcel = shipment.parcel;
  if (!parcel?.length || !parcel.width || !parcel.height || !parcel.weight) {
    return undefined;
  }
  return {
    length: parcel.length,
    width: parcel.width,
    height: parcel.height,
    dimensionUnit: parcel.dimensionUnit || "cm",
    weight: parcel.weight,
    weightUnit: parcel.weightUnit || "kg",
  };
}

/**
 * Which of a freshly fetched rate list satisfies what the caller asked for.
 *
 * Pure and exported because this decision spends the merchant's money on their
 * behalf, and the interesting case has no observable failure: a rate that has
 * expired, re-quoted into a list that no longer offers it, and been quietly
 * swapped for the cheapest thing available. Nothing throws, a label is bought,
 * and the parcel travels by a service the merchant declined.
 *
 * `exact` — somebody named a rate or a service; if it is gone there is no
 * honest substitute. `policy` — the caller named a *rule* ("cheapest"), so
 * applying that rule to the fresh list is precisely what they asked for.
 */
export function pickQuoteForPurchase(params: {
  quotes: CarrierRateQuote[];
  rateId?: string;
  serviceToken?: string;
  selection: "exact" | "policy";
  policy?: {
    rateChoice?: "cheapest" | "fastest" | "fixed_service";
    fixedServiceToken?: string;
  };
}): CarrierRateQuote | undefined {
  const byRateId = params.rateId
    ? params.quotes.find((quote) => quote.rateId === params.rateId)
    : undefined;
  if (byRateId) return byRateId;

  // A re-quote mints new rate ids for the same services, so the service token
  // is what survives an expiry — this is the path that keeps a merchant's
  // choice intact across the refresh.
  const byService = params.serviceToken
    ? params.quotes.find((quote) => quote.serviceToken === params.serviceToken)
    : undefined;
  if (byService) return byService;

  if (params.selection !== "policy") return undefined;
  return selectQuote(
    params.quotes,
    params.policy ?? { rateChoice: "cheapest" },
  );
}

/**
 * The quote to redeem, re-fetching when the stored one has gone stale.
 *
 * Shippo rate objects expire, and a merchant who opened the dialog, went for
 * lunch and came back would otherwise get a failure at the moment of purchase.
 * Re-quoting and re-selecting by service keeps the choice they made.
 */
async function resolveQuoteForPurchase(params: {
  shipment: IShipment;
  request: CarrierShipmentRequest;
  adapter: ReturnType<typeof carrierAdapter>;
  context: Awaited<ReturnType<typeof resolveCarrierContext>>;
  rateId?: string;
  serviceToken?: string;
  selection: "exact" | "policy";
  settings: ISettings;
}): Promise<CarrierRateQuote> {
  const stored = params.shipment.quotes || [];
  const wantedToken =
    params.serviceToken ??
    stored.find((quote) => quote.rateId === params.rateId)?.serviceToken;

  const fresh = !isQuoteStale(params.shipment.quotedAt)
    ? stored
    : await params.adapter.getRates(params.context, params.request);

  const asQuotes: CarrierRateQuote[] = fresh.map((quote) => ({
    provider: params.shipment.provider!,
    rateId: quote.rateId,
    shipmentId: params.shipment.providerShipmentId,
    carrierName: quote.carrierName,
    serviceName: quote.serviceName,
    serviceToken: quote.serviceToken,
    amount: quote.amount,
    currency: quote.currency,
    estimatedDays: quote.estimatedDays,
    attributes: "attributes" in quote ? quote.attributes : undefined,
  }));

  const chosen = pickQuoteForPurchase({
    quotes: asQuotes,
    rateId: params.rateId,
    serviceToken: wantedToken,
    selection: params.selection,
    policy: params.settings.shipping?.automation,
  });

  if (!chosen) {
    const named =
      stored.find((quote) => quote.rateId === params.rateId)?.serviceName ||
      wantedToken;
    throw new CarrierError({
      provider: params.shipment.provider,
      code: CARRIER_ERROR_CODES.RATE_EXPIRED,
      message: named
        ? `${named} is no longer available for this parcel. Refresh the rates and choose again.`
        : "The selected shipping rate is no longer available. Refresh the rates and choose again.",
      permanent: true,
    });
  }
  return chosen;
}

/**
 * Record what a half-finished booking has already created.
 *
 * Only the provider handles, and only when the adapter reported one — the
 * parcel is still mid-purchase, so its status, rate and label stay untouched.
 * Without this, a Shiprocket sequence that created the consignment and then
 * failed on the AWB would leave a real order in the merchant's panel that no
 * retry could resume and no void could cancel.
 */
async function persistPurchaseProgress(
  shipmentId: string,
  resume: {
    providerOrderId?: string;
    providerShipmentId?: string;
    providerTransactionId?: string;
    trackingNumber?: string;
  },
) {
  const updates: Record<string, string> = {};
  if (resume.providerOrderId) updates.providerOrderId = resume.providerOrderId;
  if (resume.providerShipmentId) {
    updates.providerShipmentId = resume.providerShipmentId;
  }
  if (resume.providerTransactionId) {
    updates.providerTransactionId = resume.providerTransactionId;
  }
  if (resume.trackingNumber) updates.trackingNumber = resume.trackingNumber;
  if (Object.keys(updates).length === 0) return;

  await Shipment.updateOne({ _id: shipmentId }, { $set: updates }).catch(
    () => undefined,
  );
}

async function markPurchaseFailed(
  shipmentId: string,
  message: string,
  code?: string,
) {
  await Shipment.findByIdAndUpdate(shipmentId, {
    $set: {
      "purchase.state": "failed",
      "purchase.lastError": message.slice(0, 2000),
      "purchase.lastErrorCode": code ?? null,
    },
  }).catch(() => undefined);
}

/** Void a bought label and mark the parcel cancelled. */
export async function voidShipmentLabel(params: {
  shipmentId: string;
  settings?: ISettings;
}): Promise<{ shipment: IShipment; refunded: boolean; state: string }> {
  const settings = params.settings ?? (await getSettings());
  const shipment = await Shipment.findById(params.shipmentId).lean<IShipment>();
  if (!shipment?.provider) {
    throw new CarrierError({
      code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
      message: "This shipment has no carrier label to void",
      permanent: true,
    });
  }
  if (shipment.status === "delivered") {
    throw new CarrierError({
      code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
      message: "A delivered parcel cannot be voided",
      permanent: true,
    });
  }

  // The parcel was bought on whichever account this vendor uses, so voiding
  // and tracking it must talk to that same account.
  const context = await resolveCarrierContext({
    provider: shipment.provider,
    settings,
    vendor: await loadCarrierVendor(shipment.vendorId),
  });
  const result = await carrierAdapter(shipment.provider).voidLabel(context, {
    transactionId: shipment.providerTransactionId,
    awb: shipment.trackingNumber,
    orderId: shipment.providerOrderId,
  });

  const updated = await Shipment.findByIdAndUpdate(
    params.shipmentId,
    {
      $set: {
        status: "cancelled",
        "purchase.state": "voided",
        "purchase.voidedAt": new Date(),
      },
      // The next booking of this parcel needs a reference of its own: Shiprocket
      // rejects a repeat order id, and its duplicate-recovery path would
      // otherwise resume the consignment this call just cancelled.
      $inc: { bookingSequence: 1 },
    },
    { new: true },
  ).lean<IShipment>();

  // The cost comes back off the books only if the money does. A carrier that
  // refuses the refund kept what the label cost, and reversing it would credit
  // the store money nobody returned — which is why `refunded` decides this and
  // the void itself does not.
  if (result.refunded && shipment.rate?.amount) {
    const { postShipmentLabelVoidSafely } = await import(
      "@/lib/finance/post-events"
    );
    postShipmentLabelVoidSafely({
      _id: shipment._id,
      vendorId: shipment.vendorId,
      rate: shipment.rate,
      // Read off the shipment as it was BEFORE this call: the update above
      // increments the booking number, and the entry being reversed belongs to
      // the booking that was just cancelled.
      bookingSequence: shipment.bookingSequence,
      billedTo: shipment.purchase?.billedTo,
      voidedAt: updated?.purchase?.voidedAt ?? new Date(),
    });
  }

  // The AWB just voided is on the sub-order and, on a single-vendor order, on
  // the order itself. Leaving it there shows the customer a dead tracking number
  // and tells the auto-ship predicate this parcel is already handled — so a
  // voided label would quietly disable automation for that sub-order for good.
  if (shipment.trackingNumber) {
    await clearShipmentTrackingFromOrder({
      orderId: String(shipment.orderId),
      subOrderId: shipment.subOrderId,
      trackingNumber: shipment.trackingNumber,
    }).catch(console.error);
  }

  return { shipment: updated!, refunded: result.refunded, state: result.state };
}

interface TrackingSyncResult {
  shipment: IShipment;
  /** Set when the parcel's own status moved, for the order cascade. */
  statusChanged?: IShipment["status"];
}

/**
 * Pull the authoritative tracking state from the carrier and record it.
 *
 * Always re-fetches rather than trusting a webhook body — the webhook only
 * tells us *that* something changed, which is why a forged one is harmless.
 */
export async function refreshShipmentTracking(params: {
  shipmentId: string;
  settings?: ISettings;
}): Promise<TrackingSyncResult> {
  const settings = params.settings ?? (await getSettings());
  const shipment = await Shipment.findById(params.shipmentId).lean<IShipment>();

  if (!shipment?.provider || !shipment.trackingNumber) {
    throw new CarrierError({
      code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
      message: "This shipment has no carrier tracking number yet",
      permanent: true,
    });
  }

  // The parcel was bought on whichever account this vendor uses, so voiding
  // and tracking it must talk to that same account.
  const context = await resolveCarrierContext({
    provider: shipment.provider,
    settings,
    vendor: await loadCarrierVendor(shipment.vendorId),
  });
  const tracking = await carrierAdapter(shipment.provider).track(context, {
    trackingNumber: shipment.trackingNumber,
    carrierName: shipment.rate?.carrierName || shipment.carrier,
    shipmentId: shipment.providerShipmentId,
  });

  const nextStatus = shipmentStatusForTracking(
    tracking.status,
    shipment.status,
  );
  const latest = tracking.events[tracking.events.length - 1];

  const updated = await Shipment.findByIdAndUpdate(
    params.shipmentId,
    {
      $set: {
        ...(nextStatus ? { status: nextStatus } : {}),
        events: tracking.events,
        lastSyncedAt: new Date(),
        ...(isExceptionStatus(tracking.status) && latest
          ? {
              exception: {
                code: tracking.status,
                message:
                  latest.description ||
                  latest.providerStatus ||
                  tracking.status,
                at: latest.at,
              },
            }
          : {}),
      },
    },
    { new: true },
  ).lean<IShipment>();

  const statusChanged =
    nextStatus && nextStatus !== shipment.status ? nextStatus : undefined;

  // The cascade lives here rather than in the callers. It used to sit in the
  // worker, so the queue moved the order but the "Refresh tracking" button —
  // the fallback for exactly the case where webhooks never arrived — updated
  // the parcel and left the order behind, showing the customer "In transit" on
  // a parcel the carrier had already delivered.
  //
  // Carrier movement only moves the order when the merchant asked for it: the
  // same switch that governs the automatic purchase.
  if (
    statusChanged &&
    settings.shipping?.automation?.markOrderShipped !== false
  ) {
    await applyShipmentTrackingToOrder({
      orderId: String(shipment.orderId),
      subOrderId: shipment.subOrderId ? String(shipment.subOrderId) : undefined,
      trackingNumber: shipment.trackingNumber,
      carrier: shipment.rate?.carrierName || shipment.carrier,
      targetStatus:
        statusChanged === "delivered"
          ? ORDER_STATUS.DELIVERED
          : ORDER_STATUS.SHIPPED,
    }).catch(console.error);
  }

  return { shipment: updated!, statusChanged };
}
