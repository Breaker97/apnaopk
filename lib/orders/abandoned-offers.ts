import { Types } from "mongoose";
import { AbandonedCheckout, Coupon, Vendor } from "@/models";
import { COUPON_SOURCE, CouponStatus, CouponType } from "@/models/coupon.model";
import type { ISettings } from "@/models/settings.model";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { escapeHtml } from "@/lib/email/escape-html";
import { normalizeCheckoutSettings } from "@/lib/checkout/checkout-config";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { isVendorLine } from "@/lib/orders/abandoned-checkout-vendor-view";
import {
  OFFER_QUIET_HOURS,
  abandonedOfferPolicy,
  checkOfferInput,
  chooseAutomaticOfferVendor,
  fitOfferInput,
  generateOfferCode,
  liveOfferOf,
  LIVE_OFFER_STATUSES,
  offerValidUntil,
  ownSubtotal,
  type AbandonedOfferPolicy,
  type OfferInput,
  type OfferKind,
  type StoredOffer,
} from "@/lib/orders/abandoned-offer-state";

/**
 * Vendors' offers on abandoned checkouts — the writes. The rules they follow
 * are in `lib/orders/abandoned-offer-state.ts`.
 *
 * A vendor sends a discount to a shopper who left its goods in a checkout,
 * by hand from its Abandoned checkouts list or by a standing rule the store's
 * recovery email carries. Either way:
 * - the store sends it, from the store's address: the vendor never learns who
 *   the shopper is, and the shopper's consent and unsubscribe are the store's
 *   to honour (it is a marketing email, with the ladder's unsubscribe link);
 * - the code is a coupon of the vendor's (`vendorId`), so it comes off only
 *   the vendor's goods and its cost comes off the vendor's payout, as every
 *   vendor coupon's does — it is single-use, expires, and only this shopper
 *   can redeem it (`restrictedToEmail`);
 * - one offer at a time per checkout, claimed atomically, because an order
 *   carries one coupon and a second offer would only compete with the first.
 */

type Line = {
  productId?: unknown;
  vendorId?: unknown;
  name?: string | null;
  price?: number | null;
  quantity?: number | null;
};

interface OfferRecord {
  _id: unknown;
  items?: Line[] | null;
  vendorIds?: unknown[] | null;
  offers?: StoredOffer[] | null;
  email?: string | null;
  userId?: unknown;
  abandonedAt?: Date | string | null;
}

/** The email parts an offer adds — see `sendAbandonedCheckoutRecoveryEmail`. */
export interface OfferMail {
  html: string;
  subject?: string;
  lead?: string;
}

/** The parts of an offer a vendor's screen shows. */
export interface VendorOfferView {
  kind: OfferKind;
  type: OfferInput["type"];
  value: number;
  validUntil: Date;
  status: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** The message for every reason a shopper cannot be reached, so none is told apart. */
const UNREACHABLE = "This shopper can't be sent an offer by email.";

function idOf(value: unknown): Types.ObjectId | null {
  const text = value == null ? "" : String(value);
  return Types.ObjectId.isValid(text) ? new Types.ObjectId(text) : null;
}

function vendorLines(record: OfferRecord, vendorId: string): Line[] {
  return (record.items ?? []).filter((line) => isVendorLine(line, vendorId));
}

function lineProductIds(lines: Line[]): Types.ObjectId[] {
  const ids = new Map<string, Types.ObjectId>();
  for (const line of lines) {
    const id = idOf(
      line.productId && typeof line.productId === "object" && "_id" in line.productId
        ? (line.productId as { _id?: unknown })._id
        : line.productId,
    );
    if (id) ids.set(String(id), id);
  }
  return Array.from(ids.values());
}

function formatAmount(value: number, currency?: string) {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency || "USD",
    }).format(value);
  } catch {
    return `${value} ${currency || ""}`.trim();
  }
}

/** "10% off" or "$5.00 off". */
export function offerHeadline(
  offer: Pick<OfferInput, "type" | "value">,
  currency?: string,
) {
  return offer.type === "fixed"
    ? `${formatAmount(offer.value, currency)} off`
    : `${offer.value}% off`;
}

/**
 * The block an offer adds to an email. Everything in it is escaped: product
 * and store names are typed by vendors.
 */
export function offerMailBlock(params: {
  vendorName: string;
  productNames: string[];
  input: Pick<OfferInput, "type" | "value">;
  code: string;
  validUntil: Date;
  currency?: string;
}): string {
  const names = params.productNames.filter(Boolean);
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
  const until = params.validUntil.toLocaleDateString("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `
      <div style="margin:18px 0;padding:14px 16px;border:1px dashed #111827;border-radius:8px">
        <p style="margin:0 0 6px;font-size:16px;font-weight:bold">${escapeHtml(
          offerHeadline(params.input, params.currency),
        )}${shown ? ` ${escapeHtml(`on ${shown}${more}`)}` : ""}</p>
        <p style="margin:0">${escapeHtml(params.vendorName)} is offering you this to finish your order. Your code is <strong style="letter-spacing:1px">${escapeHtml(
          params.code,
        )}</strong>, and the button below applies it for you. Valid until ${escapeHtml(until)}.</p>
      </div>`;
}

/** Offers a vendor has made in the last day — the store's daily cap. */
export async function offersMadeInLastDay(vendorId: Types.ObjectId, now: Date) {
  const since = new Date(now.getTime() - DAY_MS);
  const [row] = await AbandonedCheckout.aggregate<{ count: number }>([
    { $match: { "offers.vendorId": vendorId, "offers.createdAt": { $gte: since } } },
    { $unwind: "$offers" },
    {
      $match: {
        "offers.vendorId": vendorId,
        "offers.createdAt": { $gte: since },
        // One that never reached the shopper does not count against the vendor.
        "offers.status": { $nin: ["failed", "suppressed"] },
      },
    },
    { $count: "count" },
  ]);
  return row?.count ?? 0;
}

/**
 * The coupon behind an offer: the vendor's, so it applies only to the
 * vendor's goods and costs the vendor; for the products in this checkout;
 * single-use; this shopper's alone; kept out of every Discounts list.
 */
async function createOfferCoupon(params: {
  vendorId: Types.ObjectId;
  checkoutId: Types.ObjectId;
  productIds: Types.ObjectId[];
  email: string;
  userId?: unknown;
  input: OfferInput;
  validUntil: Date;
  createdBy: string;
  now: Date;
}) {
  const userId = idOf(params.userId);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await Coupon.create({
        code: generateOfferCode(),
        label: "Abandoned checkout offer",
        type: params.input.type === "fixed" ? CouponType.FIXED : CouponType.PERCENTAGE,
        value: params.input.value,
        usageLimit: 1,
        perUserLimit: 1,
        startDate: params.now,
        endDate: params.validUntil,
        status: CouponStatus.ACTIVE,
        vendorId: params.vendorId,
        applicableProducts: params.productIds,
        listed: false,
        source: COUPON_SOURCE.ABANDONED_OFFER,
        abandonedCheckoutId: params.checkoutId,
        restrictedToEmail: params.email.trim().toLowerCase(),
        ...(userId ? { restrictedToUserId: userId } : {}),
        createdBy: params.createdBy,
      });
    } catch (error) {
      // A code already taken: draw another. Anything else is a real failure.
      if ((error as { code?: number }).code === 11000) continue;
      throw error;
    }
  }
  throw new Error("Could not make a unique offer code");
}

/**
 * Put the offer on the checkout — only while the checkout is open and no
 * offer is live on it. The check and the write are one statement, so two
 * vendors (or two clicks) cannot both get one in.
 */
async function claimOffer(checkoutId: unknown, offer: Record<string, unknown>, now: Date) {
  const result = await AbandonedCheckout.updateOne(
    {
      _id: checkoutId,
      status: "open",
      recoveryStatus: { $ne: "recovered" },
      offers: {
        $not: {
          $elemMatch: {
            status: { $in: LIVE_OFFER_STATUSES },
            validUntil: { $gt: now },
          },
        },
      },
    },
    { $push: { offers: offer } },
  );
  return result.modifiedCount === 1;
}

/**
 * Write what became of an offer's email. One that never reached the shopper
 * has its code switched off, so it cannot be used by someone who finds it.
 */
export async function settleOffer(
  checkoutId: unknown,
  offer: { _id: unknown; couponId?: unknown },
  outcome: string,
  dedupeKey?: string,
) {
  const status =
    outcome === "sent" || outcome === "queued" || outcome === "suppressed"
      ? outcome
      : "failed";
  await AbandonedCheckout.updateOne(
    { _id: checkoutId, "offers._id": offer._id },
    {
      $set: {
        "offers.$.status": status,
        ...(status === "sent" || status === "queued"
          ? { "offers.$.sentAt": new Date() }
          : {}),
        ...(dedupeKey ? { "offers.$.dedupeKey": dedupeKey } : {}),
      },
    },
  );
  if ((status === "failed" || status === "suppressed") && offer.couponId) {
    await Coupon.updateOne(
      { _id: offer.couponId },
      { $set: { status: CouponStatus.INACTIVE } },
    );
  }
  return status;
}

/** The outbox key for one offer's own email. */
function offerDedupeKey(record: OfferRecord, offerId: unknown) {
  const at = record.abandonedAt ? new Date(record.abandonedAt).getTime() : "first";
  return `checkout-offer:${String(record._id)}:${at}:${String(offerId)}`;
}

/** Whether the store may email this shopper at all, by its own rules. */
async function assertReachable(
  record: OfferRecord & { buyerAcceptsMarketing?: boolean; unsubscribedAt?: unknown },
  settings: ISettings,
  now: Date,
) {
  const email = record.email?.trim().toLowerCase();
  if (!email || record.unsubscribedAt) throw new ValidationError(UNREACHABLE);

  const config = normalizeCheckoutSettings(settings.checkout).abandonedCheckouts;
  if (config.marketingConsentOnly) {
    const { filterConsentingCheckouts } = await import("@/lib/orders/abandoned-checkouts");
    const allowed = await filterConsentingCheckouts(
      [{ _id: record._id, email, buyerAcceptsMarketing: record.buyerAcceptsMarketing }],
      1,
    );
    if (allowed.length === 0) throw new ValidationError(UNREACHABLE);
  }

  const { getMarketingSuppressions } = await import("@/lib/customers/marketing-consent");
  if ((await getMarketingSuppressions([email])).get(email)) {
    throw new ValidationError(UNREACHABLE);
  }

  // No pile-up: an offer is not sent to someone the store has just emailed —
  // a recovery reminder, or another seller's offer.
  const { recentEmailRecipients } = await import("@/lib/email/email");
  const recent = await recentEmailRecipients({
    to: [email],
    categories: ["marketing"],
    since: new Date(now.getTime() - OFFER_QUIET_HOURS * 60 * 60 * 1000),
  });
  if (recent.has(email)) {
    throw new ValidationError(
      "The store emailed this shopper in the last day. You can send an offer once a day has passed.",
    );
  }
  return email;
}

/**
 * A vendor's offer, sent by hand from its Abandoned checkouts list.
 *
 * The vendor comes from the signed-in account and the checkout must hold its
 * goods — no id in the request can point this at another seller's shopper.
 */
export async function sendVendorOffer(params: {
  checkoutId: string;
  vendor: { _id: unknown; storeName?: string | null };
  actorUserId: string;
  input: OfferInput;
  settings: ISettings;
  now?: Date;
}): Promise<{
  outcome: string;
  offer: VendorOfferView;
  couponId: string;
  productNames: string[];
}> {
  const now = params.now ?? new Date();
  const policy = abandonedOfferPolicy(params.settings);
  if (!policy.enabled) {
    throw new ValidationError("The store does not let sellers send offers.");
  }

  const vendorId = idOf(params.vendor._id);
  const checkoutId = idOf(params.checkoutId);
  if (!vendorId || !checkoutId) throw new NotFoundError("Checkout");

  const record = await AbandonedCheckout.findOne({ _id: checkoutId, vendorIds: vendorId });
  if (!record) throw new NotFoundError("Checkout");
  const lines = vendorLines(record, String(vendorId));
  if (lines.length === 0) throw new NotFoundError("Checkout");

  if (
    record.status !== "open" ||
    record.recoveryStatus === "recovered" ||
    !record.abandonedAt
  ) {
    throw new ValidationError("This checkout is closed: the shopper already came back.");
  }
  if (liveOfferOf(record, now)) {
    throw new ConflictError("This shopper already has an offer open on this checkout.");
  }

  const input = checkOfferInput(params.input, policy, ownSubtotal(lines));
  const email = await assertReachable(record, params.settings, now);

  if ((await offersMadeInLastDay(vendorId, now)) >= policy.maxPerVendorPerDay) {
    throw new ValidationError(
      `You have sent the most offers the store allows in a day (${policy.maxPerVendorPerDay}). Try again tomorrow.`,
    );
  }

  const validUntil = offerValidUntil(now, input.validDays);
  const coupon = await createOfferCoupon({
    vendorId,
    checkoutId,
    productIds: lineProductIds(lines),
    email,
    userId: record.userId,
    input,
    validUntil,
    createdBy: params.actorUserId,
    now,
  });

  const offer = {
    _id: new Types.ObjectId(),
    vendorId,
    couponId: coupon._id,
    code: coupon.code,
    kind: "manual" as const,
    type: input.type,
    value: input.value,
    validUntil,
    status: "pending",
    sentBy: idOf(params.actorUserId) ?? undefined,
    createdAt: now,
  };
  if (!(await claimOffer(checkoutId, offer, now))) {
    await Coupon.deleteOne({ _id: coupon._id });
    throw new ConflictError("This shopper already has an offer open on this checkout.");
  }

  const productNames = lines.map((line) => String(line.name ?? "")).filter(Boolean);
  const storeName =
    params.settings.general?.storeName || process.env.NEXT_PUBLIC_APP_NAME || "our store";
  const mail: OfferMail = {
    subject: `A special offer on the items you left at ${storeName}`,
    lead: "Good news: a seller has an offer for you on items you left in your checkout.",
    html: offerMailBlock({
      vendorName: params.vendor.storeName || "A seller",
      productNames,
      input,
      code: coupon.code,
      validUntil,
      currency: params.settings.general?.defaultCurrency,
    }),
  };

  let outcome = "failed";
  try {
    const { sendAbandonedCheckoutRecoveryEmail } = await import(
      "@/lib/orders/abandoned-checkouts"
    );
    const sent = await sendAbandonedCheckoutRecoveryEmail({
      cart: record,
      settings: params.settings,
      locale: record.customerLocale || "en",
      offer: mail,
      dedupeKey: offerDedupeKey(record, offer._id),
    });
    outcome = await settleOffer(checkoutId, offer, sent.outcome, sent.dedupeKey);
  } catch (error) {
    console.error("Failed to send a vendor's offer:", error);
    outcome = await settleOffer(checkoutId, offer, "failed");
  }

  return {
    outcome,
    offer: {
      kind: "manual",
      type: input.type,
      value: input.value,
      validUntil,
      status: outcome,
    },
    couponId: String(coupon._id),
    productNames,
  };
}

/** Whether a vendor still holds the grant an offer spends: making discounts. */
async function vendorMayMakeOffers(userId: unknown) {
  if (!userId) return false;
  const { loadVendorAccess } = await import("@/lib/vendors/vendor-permissions");
  const access = await loadVendorAccess(String(userId));
  return Boolean(access?.has(VENDOR_PERMISSIONS.CREATE_DISCOUNTS));
}

/**
 * A vendor's standing offer for the rung of the store's recovery ladder that
 * carries one (`offerRungStep`), claimed on the checkout. Null when no vendor
 * in the checkout has one set, the store does not allow them, or an offer is
 * already live — the rung then goes out as a plain reminder.
 *
 * The ladder has already decided the shopper may be emailed (consent,
 * unsubscribe), so this does not ask again; the email's own suppression check
 * still applies, and `settleOffer` switches the code off if it is refused.
 */
export async function prepareAutomaticOffer(params: {
  record: OfferRecord;
  settings: ISettings;
  now: Date;
}): Promise<{ offer: { _id: Types.ObjectId; couponId: unknown }; mail: OfferMail } | null> {
  const { record, settings, now } = params;
  const policy: AbandonedOfferPolicy = abandonedOfferPolicy(settings);
  if (!policy.enabled || !policy.automatic) return null;
  if (liveOfferOf(record, now)) return null;
  const email = record.email?.trim().toLowerCase();
  const checkoutId = idOf(record._id);
  if (!email || !checkoutId) return null;

  const vendorIds = (record.vendorIds ?? []).map(idOf).filter((id): id is Types.ObjectId => Boolean(id));
  if (vendorIds.length === 0) return null;

  const vendors = await Vendor.find({
    _id: { $in: vendorIds },
    "abandonedOffer.enabled": true,
    status: "approved",
    storeActive: { $ne: false },
  })
    .select("_id storeName userId abandonedOffer")
    .lean<
      Array<{
        _id: Types.ObjectId;
        storeName?: string;
        userId?: unknown;
        abandonedOffer?: Partial<OfferInput> & { enabled?: boolean };
      }>
    >();

  const candidates = chooseAutomaticOfferVendor(
    vendors.map((vendor) => {
      const lines = vendorLines(record, String(vendor._id));
      return { vendor, lines, ownSubtotal: ownSubtotal(lines) };
    }),
  );

  for (const candidate of candidates) {
    const input = fitOfferInput(candidate.vendor.abandonedOffer, policy, candidate.ownSubtotal);
    if (!input) continue;
    if (!(await vendorMayMakeOffers(candidate.vendor.userId))) continue;
    if ((await offersMadeInLastDay(candidate.vendor._id, now)) >= policy.maxPerVendorPerDay) {
      continue;
    }

    const validUntil = offerValidUntil(now, input.validDays);
    const coupon = await createOfferCoupon({
      vendorId: candidate.vendor._id,
      checkoutId,
      productIds: lineProductIds(candidate.lines),
      email,
      userId: record.userId,
      input,
      validUntil,
      createdBy: "system:abandoned-offer",
      now,
    });
    const offer = {
      _id: new Types.ObjectId(),
      vendorId: candidate.vendor._id,
      couponId: coupon._id,
      code: coupon.code,
      kind: "automatic" as const,
      type: input.type,
      value: input.value,
      validUntil,
      status: "pending",
      createdAt: now,
    };
    if (!(await claimOffer(checkoutId, offer, now))) {
      await Coupon.deleteOne({ _id: coupon._id });
      return null;
    }

    return {
      offer,
      mail: {
        html: offerMailBlock({
          vendorName: candidate.vendor.storeName || "A seller",
          productNames: candidate.lines.map((line) => String(line.name ?? "")).filter(Boolean),
          input,
          code: coupon.code,
          validUntil,
          currency: settings.general?.defaultCurrency,
        }),
      },
    };
  }
  return null;
}

/**
 * The code of the offer a recovery link should apply, when the checkout has
 * one live — so the shopper who taps the button lands with it on their cart.
 */
export async function liveOfferCodeForToken(token: string, now: Date = new Date()) {
  const record = await AbandonedCheckout.findOne({
    $or: [{ checkoutToken: token }, { recoveryToken: token }],
  })
    .select("offers")
    .lean<{ offers?: StoredOffer[] } | null>();
  const offer = record ? liveOfferOf(record, now) : undefined;
  return offer?.code || null;
}
