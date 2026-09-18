import crypto from "crypto";
import type { Address } from "@/types";
import type { ISettings } from "@/models/settings.model";
import { AbandonedCheckout, Cart } from "@/models";
import { sendEmail } from "@/lib/email/email";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { normalizeCheckoutSettings } from "@/lib/checkout/checkout-config";

type CheckoutCartDocument = {
  _id: unknown;
  userId?: unknown;
  sessionId?: string;
  items?: Array<{ price?: number; quantity?: number }>;
  checkoutToken?: string;
  checkoutUrl?: string;
  recoveryToken?: string;
  email?: string;
  phone?: string;
  customerName?: string;
  customerLocale?: string;
  buyerAcceptsMarketing?: boolean;
  billingAddress?: Address;
  shippingAddress?: Address;
  sourceName?: string;
  landingSite?: string;
  referringSite?: string;
  gateway?: string;
  subtotalPrice?: number;
  shippingPrice?: number;
  totalTax?: number;
  totalDiscounts?: number;
  totalPrice?: number;
  presentmentCurrency?: string;
  checkoutStartedAt?: Date;
  abandonedAt?: Date;
  completedAt?: Date;
  lastActionAt?: Date;
  recoveryEmailStatus?: string;
  recoveryStatus?: string;
  emailStatusReason?: string;
  emailSentAt?: Date;
  orderId?: unknown;
  status?: string;
  paymentEvents?: Array<{
    gateway?: string;
    status: "created" | "failed" | "succeeded" | "cancelled";
    message?: string;
    paymentId?: string;
    createdAt?: Date;
  }>;
  save: () => Promise<unknown>;
};

interface CheckoutSnapshotInput {
  /**
   * The checkout settings' `abandonedCheckouts.enabled`. Off keeps the cart's
   * own contact snapshot (payment events and recovery still read it) but
   * writes nothing to the abandoned-checkouts list.
   */
  trackAbandoned?: boolean;
  origin?: string;
  locale?: string;
  email?: string;
  phone?: string;
  customerName?: string;
  customerLocale?: string;
  buyerAcceptsMarketing?: boolean;
  billingAddress?: Address;
  shippingAddress?: Address;
  sourceName?: string;
  landingSite?: string;
  referringSite?: string;
  gateway?: string;
  subtotalPrice?: number;
  shippingPrice?: number;
  totalTax?: number;
  totalDiscounts?: number;
  totalPrice?: number;
  presentmentCurrency?: string;
  paymentEvent?: {
    gateway?: string;
    status: "created" | "failed" | "succeeded" | "cancelled";
    message?: string;
    paymentId?: string;
  };
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function cleanAddress(address?: Address) {
  if (!address) return undefined;
  const next = {
    fullName: cleanString(address.fullName),
    firstName: cleanString(address.firstName),
    lastName: cleanString(address.lastName),
    street: cleanString(address.street),
    apartment: cleanString(address.apartment),
    city: cleanString(address.city),
    state: cleanString(address.state),
    postalCode: cleanString(address.postalCode),
    country: cleanString(address.country),
    phone: cleanString(address.phone),
    isDefault: address.isDefault,
    label: address.label,
  };

  return Object.fromEntries(
    Object.entries(next).filter(([, value]) => value !== undefined),
  ) as unknown as Address;
}

function buildCheckoutRecoveryUrl(params: {
  origin?: string;
  locale?: string;
  token: string;
}) {
  const origin =
    params.origin?.replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const locale = params.locale || "en";
  return `${origin}/${locale}/checkout?recover=${encodeURIComponent(params.token)}`;
}

export function getCheckoutSubtotal(cart: { items?: Array<{ price?: number; quantity?: number }> }) {
  return (cart.items || []).reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );
}

function ensureCheckoutToken(
  cart: CheckoutCartDocument,
  params: { origin?: string; locale?: string } = {},
) {
  const token = cart.checkoutToken || cart.recoveryToken || crypto.randomUUID();
  cart.checkoutToken = token;
  cart.recoveryToken = token;
  cart.checkoutUrl = buildCheckoutRecoveryUrl({
    origin: params.origin,
    locale: params.locale || cart.customerLocale,
    token,
  });
  return token;
}

export async function updateCheckoutSnapshot(
  cart: CheckoutCartDocument,
  input: CheckoutSnapshotInput,
) {
  ensureCheckoutToken(cart, input);

  const email = cleanString(input.email);
  const phone = cleanString(input.phone);
  const shippingAddress = cleanAddress(input.shippingAddress);
  const billingAddress = cleanAddress(input.billingAddress);
  const customerName =
    cleanString(input.customerName) ||
    cleanString(shippingAddress?.fullName) ||
    [cleanString(shippingAddress?.firstName), cleanString(shippingAddress?.lastName)]
      .filter(Boolean)
      .join(" ") ||
    undefined;

  if (email) cart.email = email.toLowerCase();
  if (phone) cart.phone = phone;
  if (customerName) cart.customerName = customerName;
  if (cleanString(input.customerLocale)) cart.customerLocale = input.customerLocale;
  if (typeof input.buyerAcceptsMarketing === "boolean") {
    cart.buyerAcceptsMarketing = input.buyerAcceptsMarketing;
  }
  if (shippingAddress) cart.shippingAddress = shippingAddress;
  if (billingAddress) cart.billingAddress = billingAddress;
  if (cleanString(input.sourceName)) cart.sourceName = input.sourceName;
  if (cleanString(input.landingSite)) cart.landingSite = input.landingSite;
  if (cleanString(input.referringSite)) cart.referringSite = input.referringSite;
  if (cleanString(input.gateway)) cart.gateway = input.gateway;
  if (cleanString(input.presentmentCurrency)) {
    cart.presentmentCurrency = input.presentmentCurrency?.toUpperCase();
  }

  const subtotal = input.subtotalPrice ?? getCheckoutSubtotal(cart);
  cart.subtotalPrice = subtotal;
  cart.shippingPrice = input.shippingPrice ?? cart.shippingPrice ?? 0;
  cart.totalTax = input.totalTax ?? cart.totalTax ?? 0;
  cart.totalDiscounts = input.totalDiscounts ?? cart.totalDiscounts ?? 0;
  cart.totalPrice =
    input.totalPrice ??
    Math.max(
      0,
      subtotal + (cart.shippingPrice || 0) + (cart.totalTax || 0) - (cart.totalDiscounts || 0),
    );

  cart.checkoutStartedAt = cart.checkoutStartedAt || new Date();
  cart.lastActionAt = new Date();
  if (cart.status === "recovered") {
    cart.recoveryStatus = "recovered";
  } else {
    cart.status = "active";
    cart.recoveryStatus = cart.recoveryStatus || "not_recovered";
  }
  cart.recoveryEmailStatus = cart.recoveryEmailStatus || "not_sent";

  if (input.paymentEvent) {
    cart.paymentEvents = cart.paymentEvents || [];
    cart.paymentEvents.push({
      ...input.paymentEvent,
      createdAt: new Date(),
    });
  }

  await cart.save();
  if (input.trackAbandoned !== false) {
    await upsertAbandonedCheckoutSnapshot(cart);
  }
  return cart;
}

export async function upsertAbandonedCheckoutSnapshot(
  cart: CheckoutCartDocument,
  params: {
    abandonedAt?: Date;
    status?: "open" | "recovered" | "closed";
    orderId?: unknown;
  } = {},
) {
  const token = ensureCheckoutToken(cart);
  const itemCount = (cart.items || []).reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0,
  );
  const subtotalPrice = cart.subtotalPrice ?? getCheckoutSubtotal(cart);
  const totalPrice =
    cart.totalPrice ??
    Math.max(
      0,
      subtotalPrice +
        Number(cart.shippingPrice || 0) +
        Number(cart.totalTax || 0) -
        Number(cart.totalDiscounts || 0),
    );
  const recoveryStatus =
    params.status === "recovered" || cart.recoveryStatus === "recovered"
      ? "recovered"
      : "not_recovered";

  await AbandonedCheckout.findOneAndUpdate(
    { checkoutToken: token },
    {
      $set: {
        cartId: cart._id,
        orderId: params.orderId || cart.orderId,
        userId: cart.userId,
        sessionId: cart.sessionId,
        checkoutToken: token,
        recoveryToken: token,
        checkoutUrl: cart.checkoutUrl,
        email: cart.email,
        phone: cart.phone,
        customerName: cart.customerName,
        customerLocale: cart.customerLocale,
        buyerAcceptsMarketing: cart.buyerAcceptsMarketing || false,
        billingAddress: cart.billingAddress,
        shippingAddress: cart.shippingAddress,
        sourceName: cart.sourceName || "online_store",
        landingSite: cart.landingSite,
        referringSite: cart.referringSite,
        gateway: cart.gateway,
        items: cart.items || [],
        itemCount,
        subtotalPrice,
        shippingPrice: cart.shippingPrice || 0,
        totalTax: cart.totalTax || 0,
        totalDiscounts: cart.totalDiscounts || 0,
        totalPrice,
        presentmentCurrency: cart.presentmentCurrency,
        checkoutStartedAt: cart.checkoutStartedAt || new Date(),
        abandonedAt: params.abandonedAt || cart.abandonedAt,
        completedAt: cart.completedAt,
        recoveryEmailStatus: cart.recoveryEmailStatus || "not_sent",
        emailSentAt: cart.emailSentAt,
        recoveryStatus,
        emailStatusReason: cart.emailStatusReason,
        status:
          params.status || (recoveryStatus === "recovered" ? "recovered" : "open"),
        paymentEvents: cart.paymentEvents || [],
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, returnDocument: "after" },
  );
}

export async function markCheckoutRecovered(params: {
  cartId?: unknown;
  recoveryToken?: string;
  orderId?: unknown;
  paymentEvent?: CheckoutSnapshotInput["paymentEvent"];
}) {
  const query = params.cartId
    ? { _id: params.cartId }
    : params.recoveryToken
      ? { $or: [{ checkoutToken: params.recoveryToken }, { recoveryToken: params.recoveryToken }] }
      : null;
  if (!query) return null;

  const cart = await Cart.findOne(query);
  if (!cart) return null;

  cart.status = "recovered";
  cart.recoveryStatus = "recovered";
  cart.recoveredAt = new Date();
  cart.completedAt = new Date();
  if (params.orderId) cart.orderId = params.orderId;
  if (params.paymentEvent) {
    cart.paymentEvents = cart.paymentEvents || [];
    cart.paymentEvents.push({ ...params.paymentEvent, createdAt: new Date() });
  }
  await cart.save();
  await upsertAbandonedCheckoutSnapshot(cart, {
    status: "recovered",
    orderId: params.orderId,
  });
  return cart;
}

export async function sendAbandonedCheckoutRecoveryEmail(params: {
  cart: CheckoutCartDocument;
  settings?: ISettings;
  origin?: string;
  locale?: string;
}) {
  const { cart, settings } = params;
  const to = cleanString(cart.email);
  if (!to) {
    cart.recoveryEmailStatus = "not_applicable";
    cart.emailStatusReason = "No customer email is available";
    await cart.save();
    return false;
  }

  const token = ensureCheckoutToken(cart, params);
  const recoveryUrl =
    cart.checkoutUrl ||
    buildCheckoutRecoveryUrl({ origin: params.origin, locale: params.locale, token });
  const storeName =
    settings?.general?.storeName || process.env.NEXT_PUBLIC_APP_NAME || DEFAULT_STORE_NAME;
  const firstName = cleanString(cart.customerName)?.split(/\s+/)[0] || "there";

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
      <h2 style="margin:0 0 12px">${storeName}</h2>
      <p>Hi ${firstName},</p>
      <p>You left items in your checkout. Use the secure link below to return and complete your order.</p>
      <p><a href="${recoveryUrl}" style="display:inline-block;background:#111827;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none">Complete checkout</a></p>
      <p style="color:#6b7280;font-size:13px">If you already completed your order, you can ignore this email.</p>
    </div>
  `;

  const sent = await sendEmail({
    to,
    subject: `Complete your checkout at ${storeName}`,
    html,
    settings,
  });

  cart.recoveryEmailStatus = sent ? "sent" : "failed";
  cart.emailSentAt = sent ? new Date() : cart.emailSentAt;
  cart.emailStatusReason = sent ? undefined : "Email provider is not configured or failed";
  await cart.save();

  return sent;
}

/**
 * Mark checkouts nobody has touched for `minutes` as abandoned and list them.
 *
 * Only checkouts that left a way to reach the shopper qualify — an anonymous
 * cart has nobody to recover it from. Shared by the admin "detect" action and
 * the recovery sweep.
 */
export async function markAbandonedCheckouts(params: {
  minutes: number;
  origin?: string;
  locale?: string;
  limit?: number;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const threshold = new Date(now.getTime() - params.minutes * 60 * 1000);

  const candidates = await Cart.find({
    status: "active",
    checkoutStartedAt: { $lte: threshold },
    lastActionAt: { $lte: threshold },
    "items.0": { $exists: true },
    $or: [
      { email: { $exists: true, $ne: "" } },
      { phone: { $exists: true, $ne: "" } },
    ],
  }).limit(params.limit ?? 250);

  for (const cart of candidates) {
    ensureCheckoutToken(cart, {
      origin: params.origin,
      locale: params.locale || cart.customerLocale || "en",
    });
    cart.status = "abandoned";
    cart.recoveryStatus = cart.recoveryStatus || "not_recovered";
    cart.recoveryEmailStatus = cart.recoveryEmailStatus || "not_sent";
    cart.abandonedAt = cart.abandonedAt || now;
    cart.subtotalPrice = cart.subtotalPrice ?? getCheckoutSubtotal(cart);
    cart.totalPrice = cart.totalPrice ?? cart.subtotalPrice;
    await cart.save();
    await upsertAbandonedCheckoutSnapshot(cart, {
      abandonedAt: cart.abandonedAt,
      status: "open",
    });
  }

  return candidates.length;
}

/** Idle minutes before a started checkout counts as abandoned. */
const ABANDON_AFTER_MINUTES = 10;
/** A checkout older than this is not mailed, e.g. when the setting is first switched on. */
const RECOVERY_EMAIL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The scheduled pass behind the checkout settings' abandoned-checkout
 * switches: detect, then — when automatic recovery is on — send each
 * abandoned checkout its one recovery email once it has sat idle for the
 * configured delay.
 *
 * At most once per checkout: the cart is claimed (`recoveryEmailClaimedAt`)
 * before the send, so overlapping runs cannot both mail it, and a run that
 * dies mid-send leaves it unsent rather than retried into a second email.
 */
export async function sweepAbandonedCheckouts(params: {
  settings: ISettings;
  now?: Date;
  limit?: number;
}) {
  const now = params.now ?? new Date();
  const config = normalizeCheckoutSettings(
    params.settings.checkout,
  ).abandonedCheckouts;
  if (!config.enabled) {
    return { enabled: false, detected: 0, emailed: 0, failed: 0 };
  }

  const detected = await markAbandonedCheckouts({
    minutes: ABANDON_AFTER_MINUTES,
    now,
  });

  let emailed = 0;
  let failed = 0;
  if (config.autoRecoveryEmail) {
    const idleSince = new Date(now.getTime() - config.delayMinutes * 60 * 1000);
    const due = await Cart.find({
      status: "abandoned",
      recoveryStatus: { $ne: "recovered" },
      recoveryEmailStatus: "not_sent",
      recoveryEmailClaimedAt: { $exists: false },
      email: { $exists: true, $ne: "" },
      "items.0": { $exists: true },
      lastActionAt: {
        $lte: idleSince,
        $gte: new Date(now.getTime() - RECOVERY_EMAIL_MAX_AGE_MS),
      },
      ...(config.marketingConsentOnly ? { buyerAcceptsMarketing: true } : {}),
    })
      .select("_id")
      .limit(params.limit ?? 100)
      .lean();

    for (const { _id } of due) {
      const claim = await Cart.updateOne(
        {
          _id,
          recoveryEmailStatus: "not_sent",
          recoveryEmailClaimedAt: { $exists: false },
        },
        { $set: { recoveryEmailClaimedAt: now } },
      );
      if (claim.modifiedCount !== 1) continue;

      const cart = await Cart.findById(_id);
      if (!cart) continue;
      try {
        const sent = await sendAbandonedCheckoutRecoveryEmail({
          cart,
          settings: params.settings,
        });
        if (sent) emailed += 1;
        else failed += 1;
        await upsertAbandonedCheckoutSnapshot(cart, {
          abandonedAt: cart.abandonedAt,
          status: "open",
        });
      } catch (error) {
        failed += 1;
        console.error("Failed to send abandoned checkout recovery email:", error);
      }
    }
  }

  return { enabled: true, detected, emailed, failed };
}
