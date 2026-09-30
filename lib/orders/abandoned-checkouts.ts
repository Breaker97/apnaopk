import { appBaseUrl } from "@/lib/app-url";
import { buildLocalePath } from "@/lib/i18n/locale-prefix";
import { getLocaleRouting } from "@/lib/i18n/locale-routing";
import crypto from "crypto";
import type { Address } from "@/types";
import type { ISettings } from "@/models/settings.model";
import type { MarketingSuppressionReason } from "@/lib/customers/marketing-consent";
import { AbandonedCheckout, Cart, EmailDelivery } from "@/models";
import { sendEmail } from "@/lib/email/email";
import { escapeHtml } from "@/lib/email/escape-html";
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

/**
 * The recovery address, or nothing.
 *
 * Checkout tracks as the shopper types, on a debounce, so a snapshot can
 * arrive mid-keystroke — "riya@gmai" is not an address to write down, and a
 * cart that keeps one either fails its one recovery email (recorded as
 * "Email provider is not configured or failed", which sends the merchant
 * looking at the wrong thing) or, worse, is complete enough to reach someone
 * else entirely. The last debounce carries the finished address, so holding
 * out for a plausible one costs nothing.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(value: unknown) {
  const email = cleanString(value);
  return email && EMAIL_PATTERN.test(email) ? email.toLowerCase() : undefined;
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

/**
 * The link the recovery email carries. It goes through `getLocaleRouting`
 * rather than always prefixing: the store's default language is served at the
 * bare path, and a link that spends a redirect getting there is a link some
 * mail clients will not follow at all.
 */
async function buildCheckoutRecoveryUrl(params: {
  locale?: string;
  token: string;
}) {
  const { storeDefault } = await getLocaleRouting();
  const locale = params.locale || storeDefault;
  const path = buildLocalePath(locale, "/checkout", storeDefault);
  return `${appBaseUrl()}${path}?recover=${encodeURIComponent(params.token)}`;
}

/**
 * The address a mailbox provider POSTs to when the shopper presses its own
 * "unsubscribe" button, which is not the page the footer link opens: RFC 8058
 * one-click sends a POST, and a Next page route answers 405 to one.
 */
function buildOneClickUnsubscribeUrl(params: { token: string }) {
  return `${appBaseUrl()}/api/marketing/unsubscribe/one-click?token=${encodeURIComponent(
    params.token,
  )}`;
}

/**
 * The public page a marketing email's unsubscribe link opens — at the path the
 * store serves, for the same reason as the recovery link above: the default
 * language has no prefix, and `/en/unsubscribe/…` spent a redirect getting
 * there.
 */
async function buildUnsubscribeUrl(params: {
  locale?: string;
  token: string;
}) {
  const { storeDefault } = await getLocaleRouting();
  const locale = params.locale || storeDefault;
  const path = buildLocalePath(
    locale,
    `/unsubscribe/${encodeURIComponent(params.token)}`,
    storeDefault,
  );
  return `${appBaseUrl()}${path}`;
}

export function getCheckoutSubtotal(cart: { items?: Array<{ price?: number; quantity?: number }> }) {
  return (cart.items || []).reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );
}

async function ensureCheckoutToken(
  cart: CheckoutCartDocument,
  params: { locale?: string } = {},
) {
  const token = cart.checkoutToken || cart.recoveryToken || crypto.randomUUID();
  cart.checkoutToken = token;
  cart.recoveryToken = token;
  cart.checkoutUrl = await buildCheckoutRecoveryUrl({
    locale: params.locale || cart.customerLocale,
    token,
  });
  return token;
}

export async function updateCheckoutSnapshot(
  cart: CheckoutCartDocument,
  input: CheckoutSnapshotInput,
) {
  await ensureCheckoutToken(cart, input);

  const email = cleanEmail(input.email);
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

  if (email) cart.email = email;
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
    /**
     * The recovery ladder's delays, in minutes from the moment the checkout
     * was abandoned. Given only when a checkout is BEING marked abandoned, so
     * the rungs are written once and never rescheduled under a shopper who is
     * already partway through them.
     */
    schedule?: number[];
  } = {},
) {
  const token = await ensureCheckoutToken(cart);
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
  const abandonedAt = params.abandonedAt || cart.abandonedAt;

  // The rungs this abandonment gets, when it is one.
  const rungs = params.schedule?.length
    ? params.schedule.map((minutes, index) => ({
        step: index + 1,
        dueAt: new Date(
          (params.abandonedAt || new Date()).getTime() + minutes * 60 * 1000,
        ),
        status: "pending" as const,
      }))
    : null;

  // A shopper who came back, bought, and later left another basket behind is
  // abandoning again — and a cart keeps its token for life, so the record is
  // the same one. Its ladder must not stay as the first abandonment spent it,
  // every rung `sent`, or the second abandonment is never followed up at all.
  // `unsubscribedAt` is deliberately NOT cleared: asking to be left alone is
  // not undone by shopping again.
  const restart =
    rungs !== null &&
    Boolean(
      await AbandonedCheckout.exists({
        checkoutToken: token,
        $or: [{ status: { $ne: "open" } }, { recoveryStatus: "recovered" }],
      }),
    );

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
        abandonedAt,
        completedAt: cart.completedAt,
        recoveryEmailStatus: cart.recoveryEmailStatus || "not_sent",
        emailSentAt: cart.emailSentAt,
        recoveryStatus,
        emailStatusReason: cart.emailStatusReason,
        status:
          params.status || (recoveryStatus === "recovered" ? "recovered" : "open"),
        paymentEvents: cart.paymentEvents || [],
        // Ninety days from the moment it was abandoned, after which Mongo
        // deletes the row: this list holds a shopper's name, address and
        // basket, and a record nobody has looked at in three months is not a
        // sales tool any more, it is a liability. A checkout still live has
        // no `abandonedAt` and so no expiry.
        ...(abandonedAt
          ? { purgeAt: new Date(abandonedAt.getTime() + CHECKOUT_RETENTION_MS) }
          : {}),
        // The ladder is written here, not on insert, because the record is
        // created long before the checkout is abandoned — every debounced
        // keystroke at checkout upserts it (`updateCheckoutSnapshot`). An
        // insert-only write therefore never fired in the real flow and no
        // shopper was ever followed up. A schedule reaches this function once
        // per abandonment, from `markAbandonedCheckouts`, so writing it every
        // time it is given cannot overwrite a ladder mid-flight.
        ...(rungs ? { recoveryEmails: rungs } : {}),
      },
      // What the FIRST recovery was worth belongs to the order it became, not
      // to the basket sitting here unpaid.
      ...(restart ? { $unset: { recoveredTotal: "", recoveredVia: "" } } : {}),
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, returnDocument: "after" },
  );
}

/**
 * Add one line to a checkout's payment history: "Razorpay refused this card at
 * 14:02, insufficient funds".
 *
 * `Cart.paymentEvents` has carried a `failed` and a `cancelled` state since it
 * was written, and nothing had ever put one there — only `created`, when a
 * gateway session was opened. So a store worker looking at an abandoned
 * checkout could see that the shopper had tried to pay and nothing about what
 * happened next, which is the one thing they are asked about.
 *
 * Written to the cart AND, when one already exists, to the abandoned-checkout
 * record, because those two are read by different pages and the snapshot is
 * only refreshed while a cart is live. Nothing is created here: a failure is
 * not what makes a checkout abandoned — ten minutes of silence is.
 *
 * Never throws, for the same reason `recordChargeFailure` does not: it is
 * called from webhook handlers.
 */
export async function recordCheckoutPaymentEvent(params: {
  cartId?: unknown;
  checkoutToken?: string | null;
  gateway?: string | null;
  status: "created" | "failed" | "succeeded" | "cancelled";
  message?: string | null;
  paymentId?: string | null;
}): Promise<void> {
  try {
    const query = params.cartId
      ? { _id: params.cartId }
      : params.checkoutToken
        ? { checkoutToken: params.checkoutToken }
        : null;
    if (!query) return;

    const event = {
      ...(params.gateway ? { gateway: String(params.gateway) } : {}),
      status: params.status,
      ...(params.message ? { message: String(params.message).slice(0, 500) } : {}),
      ...(params.paymentId ? { paymentId: String(params.paymentId) } : {}),
      createdAt: new Date(),
    };

    const cart = await Cart.findOneAndUpdate(
      query,
      { $push: { paymentEvents: event } },
      { new: true, projection: { checkoutToken: 1 } },
    ).lean<{ checkoutToken?: string } | null>();

    const token = params.checkoutToken || cart?.checkoutToken;
    if (!token) return;
    await AbandonedCheckout.updateOne(
      { checkoutToken: token },
      { $push: { paymentEvents: event } },
    );
  } catch (error) {
    console.error("Failed to record a checkout payment event:", error);
  }
}

export async function markCheckoutRecovered(params: {
  cartId?: unknown;
  recoveryToken?: string;
  orderId?: unknown;
  /**
   * What the order came to. Recorded rather than derived: by the time anyone
   * asks what recovery is worth, the cart has been emptied and its snapshot
   * overwritten by the shopper's next checkout.
   */
  total?: number;
  paymentEvent?: CheckoutSnapshotInput["paymentEvent"];
  /**
   * What brought it back, when the caller knows better than the ladder: a
   * payment through the link a failed payment's email carries.
   */
  recoveredVia?: "pay_link";
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
  await recordRecoveredRevenue(cart, params.total, params.recoveredVia).catch(
    (err) => console.error("Failed to record recovered checkout revenue:", err),
  );
  // The cart is an order now; its other gateway attempts will never be paid.
  const { retireCartCheckoutAttempts } = await import(
    "@/lib/checkout/checkout-attempts"
  );
  await retireCartCheckoutAttempts(cart._id, params.orderId).catch((err) =>
    console.error("Failed to retire the cart's other checkout attempts:", err),
  );
  return cart;
}

/**
 * What each rung of the ladder says.
 *
 * Three emails that repeat one another are three chances to be marked as
 * spam, so each one has a different reason to exist: the first is a reminder
 * ("you left this open"), the second is help ("was something in the way?"),
 * the third says the cart will not be held for ever. None of them invents a
 * discount — a store that trains its shoppers to abandon a checkout for money
 * off has taught them something expensive.
 */
const RECOVERY_EMAIL_COPY: Record<
  number,
  { subject: (store: string) => string; lead: string; cta: string }
> = {
  1: {
    subject: (store) => `Complete your checkout at ${store}`,
    lead: "You left items in your checkout. Use the secure link below to return and complete your order.",
    cta: "Complete checkout",
  },
  2: {
    subject: (store) => `Still interested? Your ${store} checkout is waiting`,
    lead: "Your checkout is still saved. If something got in the way — a payment that would not go through, a delivery question — just reply to this email and we will help.",
    cta: "Return to checkout",
  },
  3: {
    subject: () => "Last reminder about your saved checkout",
    lead: "This is the last we will write about this checkout. Your items are not reserved, so anything low in stock may sell before you come back.",
    cta: "Finish my order",
  },
};

/**
 * What this checkout was worth, and what brought it back.
 *
 * Attribution is the last email actually sent, which is what "recovered
 * revenue" means everywhere a merchant has seen the figure before. It is an
 * honest approximation and not a claim of causation: without click tracking
 * — which this store does not do to its shoppers — nothing can tell a
 * reminder that worked from a shopper who would have returned anyway. A
 * checkout that came back with no email sent is recorded as `organic`, so the
 * two are never added together. One paid through a failed payment's pay link
 * is `pay_link`: that email, not the ladder, is what it answered.
 */
async function recordRecoveredRevenue(
  cart: CheckoutCartDocument,
  total?: number,
  via?: "pay_link",
) {
  const token = cart.checkoutToken || cart.recoveryToken;
  if (!token) return;

  const record = await AbandonedCheckout.findOne({ checkoutToken: token })
    .select("recoveryEmails totalPrice")
    .lean<{
      recoveryEmails?: Array<{ step: number; status?: string; sentAt?: Date }>;
      totalPrice?: number;
    } | null>();
  if (!record) return;

  const lastSent = (record.recoveryEmails || [])
    .filter((rung) => rung.status === "sent")
    .sort((a, b) => a.step - b.step)
    .pop();

  await AbandonedCheckout.updateOne(
    { checkoutToken: token },
    {
      $set: {
        recoveredTotal:
          Number(total) ||
          Number(cart.totalPrice) ||
          Number(record.totalPrice) ||
          0,
        recoveredVia: via ?? (lastSent ? `email_${lastSent.step}` : "organic"),
      },
    },
  );
}

export async function sendAbandonedCheckoutRecoveryEmail(params: {
  cart: CheckoutCartDocument;
  settings?: ISettings;
  locale?: string;
  /** Which rung of the ladder this is. Defaults to the first. */
  step?: number;
  /**
   * False for a send a person asked for by hand, which must go out even if
   * the same rung was mailed automatically an hour ago — it is the merchant's
   * answer to a shopper who says the link never arrived.
   */
  dedupe?: boolean;
}): Promise<{
  outcome: RecoveryEmailOutcome;
  dedupeKey?: string;
  /** Why it was not sent, when the outcome is `suppressed`. */
  suppression?: MarketingSuppressionReason;
}> {
  const { cart, settings } = params;
  const to = cleanString(cart.email);
  if (!to) {
    cart.recoveryEmailStatus = "not_applicable";
    cart.emailStatusReason = "No customer email is available";
    await cart.save();
    return { outcome: "failed" as const };
  }

  const { getMarketingSuppressions, unsubscribeTokenForEmail } = await import(
    "@/lib/customers/marketing-consent"
  );

  // An address that has said no is not mailed — and is not reported as a
  // failed send either, which is what the outbox's own refusal of it used to
  // look like: the admin's list said "Failed" for a shopper who unsubscribed.
  const suppression = (await getMarketingSuppressions([to])).get(
    to.toLowerCase(),
  );
  if (suppression) {
    cart.emailStatusReason =
      suppression === "pending"
        ? "Waiting for the shopper to confirm their subscription"
        : "The shopper unsubscribed from marketing emails";
    await cart.save();
    return { outcome: "suppressed", suppression };
  }

  const token = await ensureCheckoutToken(cart, params);
  const recoveryUrl =
    cart.checkoutUrl ||
    (await buildCheckoutRecoveryUrl({
      locale: params.locale,
      token,
    }));
  const storeName =
    settings?.general?.storeName || process.env.NEXT_PUBLIC_APP_NAME || DEFAULT_STORE_NAME;
  const firstName = cleanString(cart.customerName)?.split(/\s+/)[0] || "there";

  // A marketing email needs a way out of the list that does not require an
  // account — a guest has none. The customer record's own token where there
  // is a record; where there is not (most abandoned checkouts: the shopper
  // typed an address and left), a sealed one carrying the address. Those
  // shoppers used to get no link and no `List-Unsubscribe` header at all.
  const unsubscribeToken = await unsubscribeTokenForEmail(to);
  const unsubscribeUrl = unsubscribeToken
    ? await buildUnsubscribeUrl({
        locale: params.locale || cart.customerLocale,
        token: unsubscribeToken,
      })
    : null;

  const step = Math.min(Math.max(Number(params.step) || 1, 1), 3);
  const copy = RECOVERY_EMAIL_COPY[step] || RECOVERY_EMAIL_COPY[1];

  // Escaped, every one: the name is whatever was typed into a checkout — by
  // anyone, against any address — so unescaped it let a stranger send a
  // store-branded email carrying their own link to somebody else's inbox.
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
      <h2 style="margin:0 0 12px">${escapeHtml(storeName)}</h2>
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>${copy.lead}</p>
      <p><a href="${escapeHtml(recoveryUrl)}" style="display:inline-block;background:#111827;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none">${copy.cta}</a></p>
      <p style="color:#6b7280;font-size:13px">If you already completed your order, you can ignore this email.</p>
      ${
        unsubscribeUrl
          ? `<p style="color:#6b7280;font-size:12px;margin-top:24px">Don't want these emails? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280">Unsubscribe</a>.</p>`
          : ""
      }
    </div>
  `;

  // One email per rung per ABANDONMENT, whatever happens around this: a sweep
  // that dies after sending and before recording cannot mail it again.
  //
  // Keyed on when the checkout was abandoned, not on the token alone: a cart
  // keeps its token for life, so a shopper who abandons a second time gets a
  // fresh ladder with the same step numbers — and a key of `token:step` would
  // match the first abandonment's mail, which the outbox keeps for a month.
  //
  // A send a person asked for gets a key of its own, unique to the click: it
  // is never deduped away (that is the point of the button), and it can still
  // be found in the outbox afterwards to say whether it actually went.
  const dedupeKey =
    params.dedupe === false
      ? `checkout-recovery-manual:${token}:${Date.now()}:${step}`
      : recoveryEmailDedupeKey(token, cart.abandonedAt, step);

  const sent = await sendEmail({
    to,
    subject: copy.subject(storeName),
    html,
    settings,
    // Marketing rather than transactional: the suppression check in
    // `sendEmail` applies, and a bounced address is taken off the list.
    category: "marketing",
    dedupeKey,
    ...(unsubscribeUrl
      ? {
          headers: {
            // The mailbox's own unsubscribe button. Without it a store sending
            // three marketing emails per abandoned checkout is filed as bulk
            // mail, which eventually takes its order confirmations with it.
            "List-Unsubscribe": `<${buildOneClickUnsubscribeUrl({
              token: unsubscribeToken!,
            })}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  });

  const outcome = sent ? "sent" : await outboxOutcome(dedupeKey);

  // A `queued` mail has not gone yet, but it has not failed either — the
  // outbox is retrying it — and calling it failed sent merchants chasing a
  // problem that was about to fix itself. So it never reads "failed": an
  // earlier rung that went keeps the checkout "sent", and otherwise it is
  // simply not sent yet. (Leaving the old value alone was not enough: a rung
  // that failed last time would carry its "failed" onto this one.)
  cart.recoveryEmailStatus =
    outcome === "queued"
      ? cart.recoveryEmailStatus === "sent"
        ? "sent"
        : "not_sent"
      : outcome;
  cart.emailSentAt = outcome === "sent" ? new Date() : cart.emailSentAt;
  cart.emailStatusReason =
    outcome === "sent"
      ? undefined
      : outcome === "queued"
        ? "Queued — the email service is retrying delivery"
        : "Email provider is not configured or failed";
  await cart.save();

  return { outcome, dedupeKey };
}

/**
 * What happened to a recovery email: delivered, waiting on a retry, not sent
 * because the address refused marketing (or has not confirmed it yet), or
 * failed.
 */
type RecoveryEmailOutcome = "sent" | "queued" | "suppressed" | "failed";

/** The outbox key for one rung of one abandonment — see the sender. */
function recoveryEmailDedupeKey(
  token: string,
  abandonedAt: Date | string | undefined | null,
  step: number,
) {
  return `checkout-recovery:${token}:${
    abandonedAt ? new Date(abandonedAt).getTime() : "first"
  }:${step}`;
}

/**
 * What a `false` from `sendEmail` actually meant.
 *
 * It says the same thing for two very different outcomes. Nothing reached the
 * outbox — email is off, or the address was suppressed after the sender's own
 * check — and nothing ever will: that is a failure. Or the job was queued and its first delivery attempt
 * failed, in which case the outbox retries it on its own schedule and it
 * usually goes. Only the outbox can tell them apart.
 */
async function outboxOutcome(dedupeKey: string): Promise<RecoveryEmailOutcome> {
  const job = await EmailDelivery.findOne({ dedupeKey })
    .select("status")
    .lean<{ status?: string } | null>();
  if (!job) return "failed";
  if (job.status === "sent") return "sent";
  if (job.status === "failed") return "failed";
  return "queued";
}

/**
 * Which abandoned checkouts may be emailed when the store has chosen "only
 * shoppers who agreed".
 *
 * The cart's own tick-box used to be the whole test, which got it wrong twice:
 * a shopper who subscribed on an earlier visit (or from the account page) was
 * skipped because this particular cart carried no tick, and one who had since
 * unsubscribed was mailed anyway because that cart did. The customer record is
 * the store's answer to "may we email them"; the tick on this checkout counts
 * too, since they have just asked for it — unless they are on record as having
 * said no, which is the newer, deliberate answer.
 */
async function filterConsentingCheckouts(
  candidates: Array<{ _id: unknown; email?: string; buyerAcceptsMarketing?: boolean }>,
  limit: number,
) {
  if (candidates.length === 0) return candidates;
  const { getEmailConsentStates } = await import(
    "@/lib/customers/marketing-consent"
  );
  const states = await getEmailConsentStates(
    candidates.map((cart) => cart.email || ""),
  );

  const allowed: typeof candidates = [];
  for (const cart of candidates) {
    if (allowed.length >= limit) break;
    const email = cleanString(cart.email)?.toLowerCase();
    const state = email ? states.get(email) : undefined;
    if (state === "subscribed") {
      allowed.push(cart);
      continue;
    }
    // The tick on this checkout speaks only for a shopper the store has
    // nothing else on. Every other state is an answer already given, and
    // `pending` is an answer still owed: under double opt-in they ticked the
    // box but have not opened the confirmation link, and mailing them before
    // they do is the one thing double opt-in exists to prevent.
    const unanswered = state === undefined || state === "not_subscribed";
    if (cart.buyerAcceptsMarketing === true && unanswered) allowed.push(cart);
  }
  return allowed;
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
  locale?: string;
  limit?: number;
  now?: Date;
  /** The recovery ladder to write, in minutes — see the snapshot upsert. */
  schedule?: number[];
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
    await ensureCheckoutToken(cart, {
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
      schedule: params.schedule,
    });
  }

  return candidates.length;
}

/**
 * How long an abandoned checkout is kept before it deletes itself, which is
 * the window Shopify keeps and about as long as the data is worth anything.
 */
const CHECKOUT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

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
    // Only where the store sends them: a shop with automatic recovery off gets
    // no ladder written, so switching it on later starts everyone fresh rather
    // than firing a day's worth of overdue rungs at once.
    schedule: config.autoRecoveryEmail ? config.schedule : undefined,
  });

  // Before anything new goes out: settle the rungs whose email was waiting
  // on an outbox retry, so the list says what really happened to them.
  const reconciled = await reconcileQueuedRecoveryEmails({ limit: 200 }).catch(
    (error) => {
      console.error("Failed to settle queued recovery emails:", error);
      return { sent: 0, failed: 0, waiting: 0 };
    },
  );

  const sweep = config.autoRecoveryEmail
    ? await sendDueRecoveryEmails({
        settings: params.settings,
        now,
        limit: params.limit ?? 100,
        marketingConsentOnly: config.marketingConsentOnly,
      })
    : { emailed: 0, failed: 0, skipped: 0, queued: 0 };

  return { enabled: true, detected, ...sweep, reconciled };
}

/**
 * Send whichever rungs of the recovery ladder have come due.
 *
 * The state is on the abandoned-checkout record and nowhere else — see
 * `AbandonedRecoveryEmailSchema`. Each rung is claimed on the record itself
 * before its email is built, so two overlapping sweeps cannot both send the
 * same one, and a run that dies mid-send leaves that rung claimed and unsent
 * rather than mailing it twice. (The rung also carries a `dedupeKey` into the
 * outbox, so even a claim written and then lost cannot produce two.)
 *
 * The ladder stops on its own: a recovered checkout is no longer `open`, an
 * unsubscribed shopper has `unsubscribedAt`, and a shopper who came back to
 * their cart has its claim released so the rung waits for them to leave again
 * rather than being spent while they are still shopping.
 */
async function sendDueRecoveryEmails(params: {
  settings: ISettings;
  now: Date;
  limit: number;
  marketingConsentOnly?: boolean;
}) {
  const { now, limit } = params;
  let emailed = 0;
  let failed = 0;
  let skipped = 0;
  let queued = 0;

  const candidates = await AbandonedCheckout.find({
    status: "open",
    recoveryStatus: { $ne: "recovered" },
    unsubscribedAt: { $exists: false },
    email: { $exists: true, $ne: "" },
    "items.0": { $exists: true },
    // Nothing older than the window, so switching the setting on does not
    // fire a month of overdue rungs at a shopper in one afternoon.
    abandonedAt: { $gte: new Date(now.getTime() - RECOVERY_EMAIL_MAX_AGE_MS) },
    recoveryEmails: {
      $elemMatch: { status: "pending", claimedAt: null, dueAt: { $lte: now } },
    },
  })
    .select("_id cartId email buyerAcceptsMarketing recoveryEmails")
    // Oldest first, so a backlog drains in order. Without it the consent
    // filter below — which reads three times the page and keeps what it may
    // send — could take the same non-consenting rows every run and never
    // reach the shoppers who did agree behind them.
    .sort({ abandonedAt: 1 })
    // Consent is decided below rather than in the query (it lives on the
    // customer, not the checkout), so this reads wider than it sends and the
    // filter trims it back to the page size.
    .limit(params.marketingConsentOnly ? limit * 3 : limit)
    .lean<
      Array<{
        _id: unknown;
        cartId?: unknown;
        email?: string;
        buyerAcceptsMarketing?: boolean;
        recoveryEmails?: Array<{
          step: number;
          dueAt: Date;
          claimedAt?: Date;
          status?: string;
        }>;
      }>
    >();

  const due = params.marketingConsentOnly
    ? await filterConsentingCheckouts(candidates, limit)
    : candidates.slice(0, limit);
  const byId = new Map(candidates.map((row) => [String(row._id), row]));

  for (const entry of due) {
    const record = byId.get(String(entry._id));
    if (!record) continue;

    // The earliest rung that is due: a checkout whose first email failed to
    // queue is not carried past it by the second coming due.
    const rung = (record.recoveryEmails || [])
      .filter(
        (item) =>
          item.status === "pending" &&
          !item.claimedAt &&
          new Date(item.dueAt).getTime() <= now.getTime(),
      )
      .sort((a, b) => a.step - b.step)[0];
    if (!rung) continue;

    const claim = await AbandonedCheckout.updateOne(
      {
        _id: record._id,
        status: "open",
        recoveryEmails: {
          $elemMatch: { step: rung.step, status: "pending", claimedAt: null },
        },
      },
      { $set: { "recoveryEmails.$.claimedAt": now } },
    );
    if (claim.modifiedCount !== 1) continue;

    const cart = record.cartId ? await Cart.findById(record.cartId) : null;
    if (!cart || !cart.items?.length) {
      // The cart is gone, or empty: there is nothing to come back to.
      await closeRecoveryRung(record._id, rung.step, "skipped");
      skipped += 1;
      continue;
    }
    if (cart.status !== "abandoned") {
      // They are back in the checkout, or it is already an order. Let the
      // rung go again rather than spending it on someone who is here.
      await AbandonedCheckout.updateOne(
        { _id: record._id, "recoveryEmails.step": rung.step },
        { $set: { "recoveryEmails.$.claimedAt": null } },
      );
      skipped += 1;
      continue;
    }

    try {
      const { outcome, dedupeKey, suppression } =
        await sendAbandonedCheckoutRecoveryEmail({
          cart,
          settings: params.settings,
          step: rung.step,
        });
      if (outcome === "suppressed") {
        // Not a failure, and not something the next sweep should retry. A
        // refusal ends every ladder running for the address; an unconfirmed
        // double opt-in ends only this rung, since confirming would make the
        // next one welcome.
        await closeRecoveryRung(record._id, rung.step, "skipped");
        if (suppression !== "pending" && record.email) {
          await stopRecoveryLadderForEmail(record.email);
        }
        await upsertAbandonedCheckoutSnapshot(cart, {
          abandonedAt: cart.abandonedAt,
          status: "open",
        });
        skipped += 1;
        continue;
      }
      if (outcome === "sent") emailed += 1;
      else if (outcome === "queued") queued += 1;
      else failed += 1;
      await closeRecoveryRung(record._id, rung.step, outcome, { dedupeKey });
      await upsertAbandonedCheckoutSnapshot(cart, {
        abandonedAt: cart.abandonedAt,
        status: "open",
      });
    } catch (error) {
      failed += 1;
      await closeRecoveryRung(record._id, rung.step, "failed");
      console.error("Failed to send abandoned checkout recovery email:", error);
    }
  }

  return { emailed, failed, skipped, queued };
}

/**
 * Write a rung's outcome, and mirror it onto the record's own status.
 *
 * A `queued` rung keeps the record's status where it was: the email has not
 * gone, but it has not failed either — see `reconcileQueuedRecoveryEmails`.
 */
async function closeRecoveryRung(
  id: unknown,
  step: number,
  status: "sent" | "queued" | "failed" | "skipped",
  extra: { dedupeKey?: string; sentAt?: Date } = {},
) {
  const sentAt = extra.sentAt ?? new Date();
  await AbandonedCheckout.updateOne(
    { _id: id, "recoveryEmails.step": step },
    {
      $set: {
        "recoveryEmails.$.status": status,
        ...(extra.dedupeKey
          ? { "recoveryEmails.$.dedupeKey": extra.dedupeKey }
          : {}),
        ...(status === "sent"
          ? {
              "recoveryEmails.$.sentAt": sentAt,
              recoveryEmailStatus: "sent",
              emailSentAt: sentAt,
            }
          : {}),
        ...(status === "failed" ? { recoveryEmailStatus: "failed" } : {}),
      },
    },
  );
}

/**
 * Settle the rungs whose email is waiting in the outbox.
 *
 * A rung is `queued` when its email reached the outbox but the first delivery
 * attempt failed — a mail server that answered slowly, a connection that
 * dropped. The outbox retries those on its own (`processPendingEmailDeliveries`)
 * and usually gets them out, so writing `failed` at that moment was wrong for
 * most of them, and the admin's list said "Failed" for mail that arrived.
 *
 * Runs at the start of every sweep. Reads each queued rung's outbox job and
 * writes what actually happened; one still being retried is left alone.
 */
async function reconcileQueuedRecoveryEmails(
  params: { limit?: number } = {},
): Promise<{ sent: number; failed: number; waiting: number }> {
  const result = { sent: 0, failed: 0, waiting: 0 };
  const records = await AbandonedCheckout.find({
    "recoveryEmails.status": "queued",
  })
    .select("_id recoveryEmails")
    .limit(params.limit ?? 200)
    .lean<
      Array<{
        _id: unknown;
        recoveryEmails?: Array<{ step: number; status?: string; dedupeKey?: string }>;
      }>
    >();

  for (const record of records) {
    for (const rung of record.recoveryEmails || []) {
      if (rung.status !== "queued" || !rung.dedupeKey) continue;
      const job = await EmailDelivery.findOne({ dedupeKey: rung.dedupeKey })
        .select("status sentAt")
        .lean<{ status?: string; sentAt?: Date } | null>();
      if (job?.status === "sent") {
        await closeRecoveryRung(record._id, rung.step, "sent", {
          sentAt: job.sentAt ? new Date(job.sentAt) : undefined,
        });
        result.sent += 1;
      } else if (job?.status === "failed") {
        // Out of retries, or a hard bounce: now it really has failed.
        await closeRecoveryRung(record._id, rung.step, "failed");
        result.failed += 1;
      } else {
        result.waiting += 1;
      }
    }
  }
  return result;
}

/**
 * Stop every ladder running for an address, because its owner has asked not
 * to be emailed.
 *
 * `sendEmail`'s suppression check would refuse the send anyway, but that
 * happens one email at a time and leaves the rungs looking due for ever. This
 * marks them, so the admin's list says why nothing more went out.
 */
export async function stopRecoveryLadderForEmail(rawEmail: string) {
  const email = cleanEmail(rawEmail);
  if (!email) return 0;
  const result = await AbandonedCheckout.updateMany(
    { email, status: "open", unsubscribedAt: { $exists: false } },
    {
      $set: {
        unsubscribedAt: new Date(),
        "recoveryEmails.$[pending].status": "skipped",
      },
    },
    { arrayFilters: [{ "pending.status": "pending" }] },
  );
  return result.modifiedCount || 0;
}
