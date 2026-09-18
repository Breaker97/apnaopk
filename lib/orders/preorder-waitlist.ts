import { Types } from "mongoose";
import { Order, Product, PreorderWaitlist } from "@/models";
import { PRODUCT_STATUS } from "@/config/app.config";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import {
  getPreorderAvailability,
  preorderQuotaVariantId,
} from "@/lib/orders/preorders";

/**
 * Who hears when a pre-order spot opens, and when.
 *
 * **An invitation, not a reservation.** A notified shopper is told a spot is
 * free and the spot goes to whoever checks out first. Holding places for the
 * list would mean timed holds that expire, a second kind of reservation
 * checkout has to respect, and spots locked away from shoppers ready to pay
 * right now on behalf of ones who may never open the email. The honest version
 * is simpler, and the message says so.
 *
 * **How many are told.** As many as there are free places, oldest first, less
 * the invitations still standing for them. A place is announced to one shopper
 * at a time: an invitation sent within the last `INVITATION_HOLD_HOURS` that
 * has not yet turned into an order still counts against the places it was sent
 * for, so a product saved five times in an afternoon, or two cancellations an
 * hour apart, do not tell five people about the same place.
 *
 * Told only that many, an invitation nobody takes up would leave the place
 * empty forever — nothing else frees it again, so nothing would tell the next
 * person. `sweepPreorderWaitlists` is that something: it runs daily, re-counts
 * what is genuinely free once the hold has lapsed, and invites the next
 * shoppers down for whatever is still open.
 *
 * **Counted from the product, never from the event.** A cancellation frees a
 * place, but the product may already have passed its release date and stopped
 * taking pre-orders; inviting someone to a closed pre-order is a broken
 * promise. Every run asks `getPreorderAvailability` what is actually open.
 *
 * **Keyed where the quota lives.** A variant with its own pre-order settings
 * has its own counter; one without shares the product's. Joining and releasing
 * both resolve that the way reservation does (`preorderQuotaVariantId`), so a
 * released place always finds the people waiting for it.
 */

/** Invitations sent per product per run, whatever is free. */
const MAX_INVITES_PER_RUN = 50;

/**
 * How long an invitation stands for its place before the next shopper down may
 * be told about it. Short enough that the daily sweep finds the invitations the
 * previous day's events sent already lapsed; long enough that an evening email
 * is not overtaken by the next person's before its reader has woken up.
 */
export const INVITATION_HOLD_HOURS = 12;

const HOUR_MS = 60 * 60 * 1000;

type WaitlistProduct = Parameters<typeof getPreorderAvailability>[0] & {
  _id: unknown;
  name?: string;
  slug?: string;
};

export type JoinWaitlistResult =
  | { joined: true }
  | { joined: false; reason: "not_preorder" | "closed" | "available" };

/**
 * Put a shopper on the list for a full pre-order.
 *
 * Refused unless the list can mean something: the product must be taking
 * pre-orders and actually be full. A shopper who could simply pre-order is told
 * so instead of being quietly queued for something already in reach.
 */
export async function joinPreorderWaitlist(params: {
  productId: string;
  variantId?: string;
  email: string;
  userId?: string;
  locale?: string;
}): Promise<JoinWaitlistResult | null> {
  if (!Types.ObjectId.isValid(params.productId)) return null;
  if (params.variantId && !Types.ObjectId.isValid(params.variantId)) return null;

  const product = (await Product.findById(params.productId)
    .select("preorder variants")
    .lean()) as WaitlistProduct | null;
  if (!product) return null;

  const availability = getPreorderAvailability(product, params.variantId);
  if (!availability.enabled) return { joined: false, reason: "not_preorder" };
  if (!availability.windowOpen) return { joined: false, reason: "closed" };
  if (availability.remaining > 0) return { joined: false, reason: "available" };

  const quotaVariantId = preorderQuotaVariantId(product, params.variantId);
  await PreorderWaitlist.findOneAndUpdate(
    {
      productId: new Types.ObjectId(params.productId),
      variantId: quotaVariantId ? new Types.ObjectId(quotaVariantId) : null,
      email: params.email.trim().toLowerCase(),
    },
    {
      // Rejoining re-arms a wait that was already answered: the shopper is
      // asking to hear about the NEXT spot. Their place in the queue is the
      // one they first took, which `createdAt` keeps.
      $set: {
        notifiedAt: null,
        ...(params.userId && Types.ObjectId.isValid(params.userId)
          ? { userId: new Types.ObjectId(params.userId) }
          : {}),
        ...(params.locale ? { locale: params.locale } : {}),
      },
    },
    { upsert: true },
  );
  return { joined: true };
}

/**
 * Invite as many waiting shoppers as there are free places on one list.
 *
 * Returns how many were invited. Each shopper is claimed before they are
 * written to, so two runs landing together — a cancellation and the daily
 * sweep — cannot invite the same person twice.
 */
export async function notifyPreorderWaitlist(params: {
  productId: string;
  /** The variant the QUOTA lives on, if any — see `preorderQuotaVariantId`. */
  quotaVariantId?: string;
}): Promise<number> {
  if (!Types.ObjectId.isValid(params.productId)) return 0;
  const productKey = new Types.ObjectId(params.productId);
  // Only a product the storefront would still show. An invitation to a page
  // that answers "not found" — a product unpublished, or its vendor suspended —
  // is a broken promise, and it spends the shopper's one invitation. They stay
  // waiting instead, and hear if the product comes back.
  const product = (await Product.findOne({
    _id: productKey,
    status: PRODUCT_STATUS.ACTIVE,
    ...(await getStorefrontProductConstraint()),
  })
    .select("name slug preorder variants")
    .lean()) as WaitlistProduct | null;
  if (!product) return 0;

  const availability = getPreorderAvailability(product, params.quotaVariantId);
  if (!availability.enabled || !availability.windowOpen) return 0;
  if (availability.remaining <= 0) return 0;

  const variantKey =
    params.quotaVariantId && Types.ObjectId.isValid(params.quotaVariantId)
      ? new Types.ObjectId(params.quotaVariantId)
      : null;

  // A pre-order with no limit has a place for everyone told, so nothing an
  // earlier run sent can be standing in anyone's way.
  const open = Number.isFinite(availability.remaining)
    ? availability.remaining -
      (await standingInvitations({ productId: productKey, variantId: variantKey }))
    : availability.remaining;
  if (open <= 0) return 0;

  const budget = Number.isFinite(open)
    ? Math.min(open, MAX_INVITES_PER_RUN)
    : MAX_INVITES_PER_RUN;
  const productPath = product.slug
    ? `/products/${product.slug}`
    : `/products/${String(product._id)}`;
  const productName = String(product.name || "a product you wanted");

  const { notifyPreorderWaitlistSpot } = await import(
    "@/lib/notifications/notifications"
  );

  let invited = 0;
  for (let i = 0; i < budget; i += 1) {
    const claimed = await PreorderWaitlist.findOneAndUpdate(
      {
        productId: productKey,
        variantId: variantKey,
        notifiedAt: null,
      },
      { $set: { notifiedAt: new Date() } },
      { sort: { createdAt: 1 }, returnDocument: "after" },
    ).lean();
    if (!claimed) break;

    await notifyPreorderWaitlistSpot({
      email: claimed.email,
      userId: claimed.userId ? String(claimed.userId) : undefined,
      productName,
      productPath,
    });
    invited += 1;
  }
  return invited;
}

/**
 * Invitations on one list still standing for a place: sent within the hold, and
 * not yet turned into an order for the product.
 *
 * An invitee who has since ordered took their place, and that place is already
 * gone from `remaining` — counting their invitation as well would count the
 * place twice, and hold back the next shopper for a place that genuinely opened
 * after them. A shopper is recognised by the email they joined with (guest
 * orders keep it, lower-cased, on `guestEmail`) or by the account they joined
 * signed in to. One who is missed is only counted as still standing, which
 * delays the next invitation to the sweep; it never sends a second one.
 */
async function standingInvitations(list: {
  productId: Types.ObjectId;
  variantId: Types.ObjectId | null;
}): Promise<number> {
  const recent = (await PreorderWaitlist.find({
    productId: list.productId,
    variantId: list.variantId,
    notifiedAt: { $gte: new Date(Date.now() - INVITATION_HOLD_HOURS * HOUR_MS) },
  })
    .select("email userId notifiedAt")
    .lean()) as Array<{ email: string; userId?: unknown; notifiedAt: Date }>;
  if (recent.length === 0) return 0;

  const since = new Date(
    Math.min(...recent.map((row) => new Date(row.notifiedAt).getTime())),
  );
  const userIds = recent.flatMap((row) => (row.userId ? [row.userId] : []));
  const orders = (await Order.find({
    createdAt: { $gte: since },
    "items.productId": list.productId,
    $or: [
      { guestEmail: { $in: recent.map((row) => row.email) } },
      ...(userIds.length > 0 ? [{ customerId: { $in: userIds } }] : []),
    ],
  })
    .select("guestEmail customerId createdAt")
    .lean()) as Array<{ guestEmail?: string; customerId?: unknown; createdAt: Date }>;

  return recent.filter(
    (row) =>
      !orders.some(
        (order) =>
          new Date(order.createdAt).getTime() >=
            new Date(row.notifiedAt).getTime() &&
          ((order.guestEmail && order.guestEmail === row.email) ||
            (row.userId && String(order.customerId) === String(row.userId))),
      ),
  ).length;
}

/**
 * The lists touched by a release of reserved quantity.
 *
 * Called after `releasePreorderQuantity` frees places. Each line is resolved to
 * where its quota lives before the list is looked up, and a product released on
 * several lines at once is only walked once.
 */
export async function notifyPreorderWaitlistsForLines(
  lines: Array<{ productId: string; variantId?: string }>,
): Promise<number> {
  const seen = new Set<string>();
  let invited = 0;
  for (const line of lines) {
    if (!Types.ObjectId.isValid(String(line.productId))) continue;
    const product = (await Product.findById(line.productId)
      .select("preorder variants")
      .lean()) as WaitlistProduct | null;
    if (!product) continue;
    const quotaVariantId = preorderQuotaVariantId(product, line.variantId);
    const key = `${line.productId}:${quotaVariantId || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    invited += await notifyPreorderWaitlist({
      productId: String(line.productId),
      quotaVariantId,
    });
  }
  return invited;
}

/**
 * Invite from every list that still has shoppers waiting.
 *
 * The daily safety net. It catches the place an invited shopper never took
 * (nothing else would free it again, and the invitation's hold has lapsed by
 * the time the sweep runs), a limit an admin raised, and anything a
 * release-time invitation missed. Idempotent by construction: it re-counts free
 * places and standing invitations, and claims each shopper before inviting
 * them.
 */
export async function sweepPreorderWaitlists(limit = 200): Promise<{
  lists: number;
  invited: number;
}> {
  const waiting = await PreorderWaitlist.aggregate<{
    _id: { productId: Types.ObjectId; variantId: Types.ObjectId | null };
  }>([
    { $match: { notifiedAt: null } },
    { $group: { _id: { productId: "$productId", variantId: "$variantId" } } },
    { $limit: limit },
  ]);

  let invited = 0;
  for (const list of waiting) {
    invited += await notifyPreorderWaitlist({
      productId: String(list._id.productId),
      quotaVariantId: list._id.variantId ? String(list._id.variantId) : undefined,
    });
  }
  return { lists: waiting.length, invited };
}

/**
 * Every list on one product, after the product itself changed.
 *
 * Called when an admin or vendor saves a product, because a raised pre-order
 * limit frees places without any reservation being released. Reads the product
 * once and walks each distinct quota — the product's own, and each variant that
 * counts its own — rather than one read per variant.
 */
export async function notifyPreorderWaitlistsForProduct(
  productId: string,
): Promise<number> {
  if (!Types.ObjectId.isValid(productId)) return 0;
  const product = (await Product.findById(productId)
    .select("preorder variants")
    .lean()) as (WaitlistProduct & {
    variants?: Array<{ _id?: unknown }>;
  }) | null;
  if (!product) return 0;

  const keys = new Set<string>([""]);
  for (const variant of product.variants || []) {
    const quotaVariantId = preorderQuotaVariantId(product, String(variant._id));
    if (quotaVariantId) keys.add(quotaVariantId);
  }

  let invited = 0;
  for (const key of keys) {
    invited += await notifyPreorderWaitlist({
      productId,
      quotaVariantId: key || undefined,
    });
  }
  return invited;
}
