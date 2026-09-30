import "server-only";

import { Types } from "mongoose";
import {
  StoreCreditAccount,
  StoreCreditTransaction,
  type IStoreCreditTransaction,
  type StoreCreditRedeemStatus,
  type StoreCreditSource,
} from "@/models/store-credit.model";
import { ValidationError } from "@/lib/api/errors";
import { quantizeToCurrency } from "@/lib/intl/money";
import { REUSABLE_ATTEMPT_METHODS } from "@/lib/checkout/superseded-orders";

/**
 * Store credit (R8): giving it, spending it, and letting it expire.
 *
 * Every change is a row, and every row carries an idempotency key, so a retry
 * of the same refund or checkout writes nothing twice. Credit is given as
 * lots; a spend takes from the lot that expires first and each lot moves only
 * by a conditional `$inc` — the guard that stops two checkouts spending the
 * same credit, and any lot going below nothing. See models/store-credit.model.ts.
 */

type IdLike = Types.ObjectId | string;

const toId = (value: IdLike): Types.ObjectId => {
  const id = String(value);
  if (!Types.ObjectId.isValid(id)) throw new ValidationError("Invalid customer for store credit");
  return new Types.ObjectId(id);
};

const currencyOf = (value: string) => String(value || "").trim().toUpperCase();

const money = (value: unknown, currency: string) =>
  quantizeToCurrency(Math.max(0, Number(value) || 0), currency);

const isDuplicateKey = (error: unknown) =>
  Boolean(error && typeof error === "object" && (error as { code?: number }).code === 11000);

/** A lot that can still be spent: something left, and not expired. */
const liveLot = (now: Date) => ({
  type: "issue",
  remaining: { $gt: 0 },
  $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
});

async function accountFor(
  customerId: Types.ObjectId,
  currency: string,
): Promise<{ _id: Types.ObjectId }> {
  const find = () =>
    StoreCreditAccount.findOneAndUpdate(
      { customerId, currency },
      { $setOnInsert: { balance: 0 } },
      { upsert: true, returnDocument: "after" },
    ).lean<{ _id: Types.ObjectId } | null>();
  let account: { _id: Types.ObjectId } | null;
  try {
    account = await find();
  } catch (error) {
    // Two first credits at once: the other one made the account.
    if (!isDuplicateKey(error)) throw error;
    account = await find();
  }
  if (!account) throw new Error("Store credit account could not be opened");
  return account;
}

/**
 * Bring the account's cached balance up to what its live lots hold. Any
 * change calls it; a stale read is healed by the next.
 */
async function refreshStoreCreditBalance(
  customerIdValue: IdLike,
  currencyValue: string,
  now: Date = new Date(),
): Promise<number> {
  const customerId = toId(customerIdValue);
  const currency = currencyOf(currencyValue);
  const [row] = await StoreCreditTransaction.aggregate<{ balance: number }>([
    { $match: { customerId, currency, ...liveLot(now) } },
    { $group: { _id: null, balance: { $sum: "$remaining" } } },
  ]);
  const balance = money(row?.balance ?? 0, currency);
  await StoreCreditAccount.updateOne(
    { customerId, currency },
    { $set: { balance } },
    { upsert: true },
  );
  return balance;
}

/**
 * Give a shopper store credit: one lot, expiring when the store says or never.
 * Idempotent on `idempotencyKey` — the same refund retried gives nothing more.
 */
export async function issueStoreCredit(params: {
  customerId: IdLike;
  currency: string;
  amount: number;
  expiresAt?: Date | null;
  source: StoreCreditSource;
  orderId?: IdLike | null;
  returnId?: IdLike | null;
  paymentTransactionId?: IdLike | null;
  note?: string;
  createdBy?: string;
  idempotencyKey: string;
}): Promise<IStoreCreditTransaction> {
  const customerId = toId(params.customerId);
  const currency = currencyOf(params.currency);
  if (!currency) throw new ValidationError("Store credit needs a currency");
  const amount = money(params.amount, currency);
  if (!(amount > 0)) throw new ValidationError("Store credit must be more than 0");
  if (params.expiresAt && new Date(params.expiresAt).getTime() <= Date.now()) {
    throw new ValidationError("Store credit cannot expire in the past");
  }

  const existing = await StoreCreditTransaction.findOne({
    idempotencyKey: params.idempotencyKey,
  }).lean<IStoreCreditTransaction | null>();
  if (existing) return existing;

  const account = await accountFor(customerId, currency);
  try {
    const lot = await StoreCreditTransaction.create({
      accountId: account._id,
      customerId,
      currency,
      type: "issue",
      amount,
      remaining: amount,
      expiresAt: params.expiresAt ?? undefined,
      source: params.source,
      orderId: params.orderId ?? undefined,
      returnId: params.returnId ?? undefined,
      paymentTransactionId: params.paymentTransactionId ?? undefined,
      note: params.note,
      createdBy: params.createdBy,
      idempotencyKey: params.idempotencyKey,
    });
    await refreshStoreCreditBalance(customerId, currency);
    return lot.toObject() as IStoreCreditTransaction;
  } catch (error) {
    if (isDuplicateKey(error)) {
      const again = await StoreCreditTransaction.findOne({
        idempotencyKey: params.idempotencyKey,
      }).lean<IStoreCreditTransaction | null>();
      if (again) return again;
    }
    throw error;
  }
}

type LiveLot = { _id: Types.ObjectId; remaining: number; expiresAt?: Date | null; createdAt: Date };

/** The soonest to expire first; lots that never expire last; then the oldest. */
function spendOrder(lots: LiveLot[]): LiveLot[] {
  return [...lots].sort((a, b) => {
    const ae = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
    const be = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY;
    if (ae !== be) return ae - be;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

/**
 * Spend a shopper's store credit on an order — held while its checkout is
 * being paid (`held`), or spent outright (`spent`).
 *
 * Taken lot by lot, each with a conditional `$inc`: a lot another checkout
 * has just taken from is read again, and if the shopper's lots cannot cover
 * the amount between them, everything taken is put back and nothing is spent.
 * Idempotent on `idempotencyKey`.
 */
async function redeemStoreCredit(params: {
  customerId: IdLike;
  currency: string;
  amount: number;
  status: Extract<StoreCreditRedeemStatus, "held" | "spent">;
  orderId?: IdLike | null;
  note?: string;
  createdBy?: string;
  idempotencyKey: string;
  now?: Date;
  /** The cart a checkout's hold is for — see `holdCheckoutCredit`. */
  checkoutCartId?: IdLike | null;
  /** How long a hold with no order stands. */
  heldUntil?: Date | null;
}): Promise<IStoreCreditTransaction> {
  const customerId = toId(params.customerId);
  const currency = currencyOf(params.currency);
  const amount = money(params.amount, currency);
  if (!(amount > 0)) throw new ValidationError("Store credit to spend must be more than 0");
  const now = params.now ?? new Date();

  const existing = await StoreCreditTransaction.findOne({
    idempotencyKey: params.idempotencyKey,
  }).lean<IStoreCreditTransaction | null>();
  if (existing) return existing;

  const taken: Array<{ lotId: Types.ObjectId; amount: number }> = [];
  let left = amount;
  const giveBack = async () => {
    for (const lot of taken) {
      await StoreCreditTransaction.updateOne(
        { _id: lot.lotId },
        { $inc: { remaining: lot.amount } },
      ).catch((error) => console.error("Failed to give back store credit taken for a spend:", error));
    }
  };

  // A few passes: a lot another checkout took from is read afresh.
  for (let pass = 0; pass < 3 && left > 0; pass += 1) {
    const lots = spendOrder(
      await StoreCreditTransaction.find({ customerId, currency, ...liveLot(now) })
        .select("_id remaining expiresAt createdAt")
        .lean<LiveLot[]>(),
    );
    if (lots.length === 0) break;
    for (const lot of lots) {
      if (left <= 0) break;
      const take = money(Math.min(left, Number(lot.remaining) || 0), currency);
      if (!(take > 0)) continue;
      const result = await StoreCreditTransaction.updateOne(
        { _id: lot._id, ...liveLot(now), remaining: { $gte: take } },
        { $inc: { remaining: -take } },
      );
      if (result.modifiedCount !== 1) continue;
      const seen = taken.find((entry) => String(entry.lotId) === String(lot._id));
      if (seen) seen.amount = money(seen.amount + take, currency);
      else taken.push({ lotId: lot._id, amount: take });
      left = money(left - take, currency);
    }
  }

  if (left > 0) {
    await giveBack();
    // The same spend asked for twice at once — a double click, a retry racing
    // its first try: the other one took the credit, and this one is it.
    const same = await StoreCreditTransaction.findOne({
      idempotencyKey: params.idempotencyKey,
    }).lean<IStoreCreditTransaction | null>();
    if (same) return same;
    throw new ValidationError("There isn't enough store credit for this order");
  }

  const account = await accountFor(customerId, currency);
  try {
    const row = await StoreCreditTransaction.create({
      accountId: account._id,
      customerId,
      currency,
      type: "redeem",
      amount,
      lots: taken,
      status: params.status,
      source: "order",
      orderId: params.orderId ?? undefined,
      checkoutCartId: params.checkoutCartId ?? undefined,
      heldUntil: params.heldUntil ?? undefined,
      note: params.note,
      createdBy: params.createdBy,
      idempotencyKey: params.idempotencyKey,
    });
    await refreshStoreCreditBalance(customerId, currency, now);
    return row.toObject() as IStoreCreditTransaction;
  } catch (error) {
    // Recorded twice at once: the other spend stands, this one's lots go back.
    await giveBack();
    if (isDuplicateKey(error)) {
      const again = await StoreCreditTransaction.findOne({
        idempotencyKey: params.idempotencyKey,
      }).lean<IStoreCreditTransaction | null>();
      if (again) return again;
    }
    throw error;
  }
}

/**
 * A hold still free for this order: not tied to an order yet, or tied to this
 * one. Two orders can carry the same hold — a double submit, or two payment
 * tabs from one cart — and only one of them may spend or give it back.
 */
const heldFor = (orderId?: IdLike | null) =>
  orderId
    ? {
        $or: [
          { orderId: { $exists: false } },
          { orderId: null },
          { orderId: new Types.ObjectId(String(orderId)) },
        ],
      }
    : {};

/** A held spend becomes spent: its order was placed. */
async function settleStoreCreditHold(params: {
  idempotencyKey: string;
  orderId?: IdLike | null;
}): Promise<boolean> {
  const result = await StoreCreditTransaction.updateOne(
    {
      idempotencyKey: params.idempotencyKey,
      type: "redeem",
      status: "held",
      ...heldFor(params.orderId),
    },
    {
      $set: {
        status: "spent",
        ...(params.orderId ? { orderId: new Types.ObjectId(String(params.orderId)) } : {}),
      },
      $unset: { heldUntil: "" },
    },
  );
  return result.modifiedCount === 1;
}

/**
 * A held spend is given back: its checkout failed or was left. The move from
 * held to released is claimed first, so the lots go back once.
 */
async function releaseStoreCreditHold(params: {
  idempotencyKey: string;
  /** Only if the hold is still this order's — see `heldFor`. */
  orderId?: IdLike | null;
}): Promise<boolean> {
  const row = await StoreCreditTransaction.findOneAndUpdate(
    {
      idempotencyKey: params.idempotencyKey,
      type: "redeem",
      status: "held",
      ...heldFor(params.orderId),
    },
    { $set: { status: "released" } },
    { returnDocument: "before" },
  ).lean<IStoreCreditTransaction | null>();
  if (!row) return false;
  for (const lot of row.lots || []) {
    await StoreCreditTransaction.updateOne(
      { _id: lot.lotId },
      { $inc: { remaining: lot.amount } },
    );
  }
  await refreshStoreCreditBalance(row.customerId, row.currency);
  return true;
}

/**
 * How long a checkout's hold stands before its order exists. A card payment
 * builds its order only when the money lands, and a shopper who closed the
 * tab should have their credit back within the hour or two it takes to be
 * sure they left. A payment that does land later takes the credit again —
 * see `settleOrderStoreCredit`.
 */
const CHECKOUT_CREDIT_HOLD_MS = 2 * 60 * 60 * 1000;

/**
 * How long credit stays held on an order whose payment window closed. The
 * store emails a way to finish such an order (`lib/payments/order-pay.ts`),
 * and that link asks for what the order says is due — the credit included —
 * so it is held for as long as the link can be used.
 */
const EXPIRED_ORDER_CREDIT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

type CartHold = {
  idempotencyKey: string;
  orderId?: Types.ObjectId;
  amount: number;
  currency: string;
};

/**
 * A cart's holds that its next checkout may pick up or give back: one no order
 * has yet, one whose order was called off before any money came, and one on a
 * redirect gateway's order still waiting to be paid — a checkout begun again
 * replaces that order (`takeOverCheckoutAttempt`). Never the hold of an order
 * that stands: a cash order out for delivery, a mobile money payment the
 * payer may still approve, anything paid.
 */
async function cartHoldsInPlay(params: {
  customerId: Types.ObjectId;
  cartId: Types.ObjectId;
  currency?: string;
}): Promise<CartHold[]> {
  const held = await StoreCreditTransaction.find({
    type: "redeem",
    status: "held",
    customerId: params.customerId,
    checkoutCartId: params.cartId,
    ...(params.currency ? { currency: params.currency } : {}),
  })
    .select("idempotencyKey orderId amount currency")
    .lean<CartHold[]>();
  const linked = held.filter((row) => row.orderId).map((row) => row.orderId);
  if (linked.length === 0) return held;
  const { Order } = await import("@/models");
  const orders = await Order.find({ _id: { $in: linked } })
    .select("status paymentStatus paymentMethod paidAt")
    .lean<
      Array<{
        _id: unknown;
        status?: string;
        paymentStatus?: string;
        paymentMethod?: string;
        paidAt?: Date | null;
      }>
    >();
  const byId = new Map(orders.map((order) => [String(order._id), order]));
  return held.filter((row) => {
    if (!row.orderId) return true;
    const order = byId.get(String(row.orderId));
    if (!order) return true;
    if (order.paidAt) return false;
    if (String(order.status || "") === "cancelled") return true;
    return (
      (REUSABLE_ATTEMPT_METHODS as readonly string[]).includes(
        String(order.paymentMethod || ""),
      ) &&
      String(order.status || "") === "pending" &&
      ["pending", "expired"].includes(String(order.paymentStatus || ""))
    );
  });
}

/**
 * Hold a shopper's credit for the checkout of one cart.
 *
 * One hold per cart: this checkout's own — the same cart, payment method and
 * fingerprint (`checkoutAttemptFingerprint`) — is picked up again on a retry,
 * and every other hold of the cart's is given back first, so going back and
 * paying another way never finds the credit tied up by the way before.
 */
export async function holdCheckoutCredit(params: {
  customerId: IdLike;
  currency: string;
  amount: number;
  cartId: IdLike;
  /** The payment method and checkout fingerprint this hold is for. */
  method: string;
  fingerprint: string;
  now?: Date;
}): Promise<{ holdKey: string; amount: number }> {
  const customerId = toId(params.customerId);
  const currency = currencyOf(params.currency);
  const amount = money(params.amount, currency);
  if (!(amount > 0)) throw new ValidationError("Store credit to hold must be more than 0");
  const cartId = new Types.ObjectId(String(params.cartId));
  const now = params.now ?? new Date();
  const heldUntil = new Date(now.getTime() + CHECKOUT_CREDIT_HOLD_MS);
  const base = `checkout:${String(cartId)}:${params.method}:${params.fingerprint.slice(0, 32)}`;
  const isMine = (key: string) => key === base || key.startsWith(`${base}:`);

  const open = await cartHoldsInPlay({ customerId, cartId });
  let mine: string | null = null;
  for (const row of open) {
    if (!mine && isMine(row.idempotencyKey) && row.currency === currency) {
      mine = row.idempotencyKey;
      continue;
    }
    await releaseStoreCreditHold({ idempotencyKey: row.idempotencyKey });
    if (row.orderId) await markOrderCreditReleased(row.orderId, row.idempotencyKey);
  }
  if (mine) {
    await StoreCreditTransaction.updateOne(
      { idempotencyKey: mine, status: "held", orderId: { $exists: false } },
      { $set: { heldUntil } },
    );
    return { holdKey: mine, amount };
  }

  // The base key may already name a hold given back earlier: a fresh one then.
  const taken = await StoreCreditTransaction.exists({ idempotencyKey: base });
  const holdKey = taken ? `${base}:${new Types.ObjectId().toHexString()}` : base;
  await redeemStoreCredit({
    customerId,
    currency,
    amount,
    status: "held",
    idempotencyKey: holdKey,
    checkoutCartId: cartId,
    heldUntil,
    now,
  });
  return { holdKey, amount };
}

/**
 * A hold now belongs to the order its checkout wrote. Only while it is still
 * held: a spend already made stays with the order that made it.
 */
export async function linkStoreCreditHold(params: {
  holdKey: string;
  orderId: IdLike;
}): Promise<void> {
  await StoreCreditTransaction.updateOne(
    { idempotencyKey: params.holdKey, type: "redeem", status: "held" },
    {
      $set: { orderId: new Types.ObjectId(String(params.orderId)) },
      $unset: { heldUntil: "" },
    },
  );
}

async function markOrderCreditReleased(orderId: IdLike, holdKey: string) {
  const { Order } = await import("@/models");
  await Order.updateOne(
    { _id: orderId, "storeCredit.holdKey": holdKey, "storeCredit.state": "held" },
    { $set: { "storeCredit.state": "released" } },
  ).catch((error) =>
    console.error("Failed to mark an order's store credit given back:", error),
  );
}

type OrderWithCredit = {
  _id: unknown;
  orderNumber?: string;
  customerId?: unknown;
  currency?: string | null;
  storeCredit?: {
    applied?: number | null;
    holdKey?: string | null;
    state?: string | null;
  } | null;
  /** The return an exchange order was made for (R7). */
  exchangeOf?: { returnId?: unknown } | null;
};

/**
 * The order's payment landed: its credit is spent.
 *
 * Normally the hold is simply settled. A hold already given back — the
 * payment took longer than the hold stood, or the shopper started paying
 * another way in between — is taken again from what they hold now. When that
 * is no longer there the order is short, and admins are told what is missing.
 */
export async function settleOrderStoreCredit(
  order: OrderWithCredit,
  options: {
    /**
     * Take a hold given back again. Off for money landing on an order already
     * called off: it goes straight back, and credit given back stays given.
     */
    retake?: boolean;
  } = {},
): Promise<void> {
  const credit = order.storeCredit;
  const applied = Number(credit?.applied || 0);
  const holdKey = String(credit?.holdKey || "");
  // An exchange order's credit is its return's money, with no hold behind it
  // (R7): spent the moment the rest of the order is paid.
  if (!holdKey && applied > 0 && credit?.state === "held" && order.exchangeOf?.returnId) {
    const { Order } = await import("@/models");
    await Order.updateOne(
      { _id: order._id, "storeCredit.state": "held" },
      { $set: { "storeCredit.state": "spent" } },
    );
    return;
  }
  if (!(applied > 0) || !holdKey || credit?.state === "spent") return;
  if (credit?.state === "released" && options.retake === false) return;
  const { Order } = await import("@/models");
  const markSpent = () =>
    Order.updateOne(
      { _id: order._id, "storeCredit.holdKey": holdKey },
      { $set: { "storeCredit.state": "spent" } },
    );

  const orderId = String(order._id);
  if (await settleStoreCreditHold({ idempotencyKey: holdKey, orderId })) {
    await markSpent();
    return;
  }
  const row = await StoreCreditTransaction.findOne({ idempotencyKey: holdKey })
    .select("status orderId")
    .lean<{ status?: string; orderId?: Types.ObjectId | null } | null>();
  const anotherOrders = Boolean(row?.orderId) && String(row?.orderId) !== orderId;
  if (row?.status === "spent" && !anotherOrders) {
    await markSpent();
    return;
  }
  // The hold went to another order placed from the same cart: this one holds
  // nothing, and takes its credit afresh below — never the other's spend.
  if (anotherOrders) await markOrderCreditReleased(orderId, holdKey);
  if (options.retake === false) return;
  // Taken again before, under the key used until each order had its own.
  const takenBefore = await StoreCreditTransaction.exists({
    idempotencyKey: `${holdKey}:taken-again`,
    orderId: new Types.ObjectId(orderId),
  });
  if (takenBefore) {
    await markSpent();
    return;
  }
  try {
    // A populated customer is read for its id.
    const customer = order.customerId as { _id?: unknown } | string | null | undefined;
    const customerId =
      customer && typeof customer === "object" && "_id" in customer ? customer._id : customer;
    const again = await redeemStoreCredit({
      customerId: String(customerId),
      currency: String(order.currency || ""),
      amount: applied,
      status: "spent",
      orderId,
      idempotencyKey: `${holdKey}:taken-again:${orderId}`,
    });
    if (String(again.orderId || "") !== orderId) {
      throw new Error("The credit taken again belongs to another order");
    }
    await markSpent();
  } catch (error) {
    console.error(`Store credit for order ${order.orderNumber || order._id} could not be taken:`, error);
    // Short: the credit paid none of it. Left held, the ledger would book a
    // spend that never happened, and a cancel would hand the shopper credit
    // they never gave up.
    await Order.updateOne(
      { _id: order._id, "storeCredit.holdKey": holdKey, "storeCredit.state": { $ne: "spent" } },
      { $set: { "storeCredit.state": "released" } },
    ).catch((err) => console.error("Failed to mark a short order's store credit:", err));
    const { notifyAdminsPaymentAnomaly } = await import("@/lib/notifications/notifications");
    await notifyAdminsPaymentAnomaly({
      title: "An order is short of the store credit it counted on",
      message: `Order #${order.orderNumber || String(order._id)} was paid expecting ${applied} ${order.currency || ""} of the shopper's store credit, but that credit was no longer there when the payment landed. Collect the difference from the shopper, or cancel and refund the order.`,
      link: `/admin/orders/${String(order._id)}`,
      dedupeKey: `store-credit-short:${String(order._id)}`,
    }).catch((err) => console.error("Failed to report a short store credit order:", err));
  }
}

/**
 * The order will never be paid — cancelled before its money came, or its
 * payment window long gone: its held credit goes back to the shopper.
 */
export async function releaseOrderStoreCredit(order: OrderWithCredit): Promise<boolean> {
  const holdKey = String(order.storeCredit?.holdKey || "");
  if (!holdKey || order.storeCredit?.state !== "held") return false;
  // Never another order's hold: that order still counts on it.
  const released = await releaseStoreCreditHold({
    idempotencyKey: holdKey,
    orderId: String(order._id),
  });
  await markOrderCreditReleased(String(order._id), holdKey);
  return released;
}

/**
 * Settle every hold still open by what became of its order: paid, the credit
 * is spent; called off or failed before any money came, or its payment window
 * closed past the time its pay link lasts, it goes back. A hold with no order
 * yet goes back once it has stood its time (`heldUntil`), unless an open
 * checkout attempt still owns it.
 */
export async function reconcileStoreCreditHolds(params: {
  now?: Date;
  limit?: number;
} = {}): Promise<{ spent: number; released: number }> {
  const now = params.now ?? new Date();
  const [{ Order }, { CheckoutAttempt }] = await Promise.all([
    import("@/models"),
    import("@/models/checkout-attempt.model"),
  ]);
  const held = await StoreCreditTransaction.find({ type: "redeem", status: "held" })
    .sort({ createdAt: 1 })
    .select("idempotencyKey orderId heldUntil createdAt")
    .limit(params.limit ?? 200)
    .lean<
      Array<{ idempotencyKey: string; orderId?: Types.ObjectId; heldUntil?: Date; createdAt: Date }>
    >();
  let spent = 0;
  let released = 0;
  for (const row of held) {
    const order =
      (row.orderId
        ? await Order.findById(row.orderId)
            .select("orderNumber customerId currency status paymentStatus paidAt createdAt storeCredit")
            .lean()
        : await Order.findOne({ "storeCredit.holdKey": row.idempotencyKey })
            .select("orderNumber customerId currency status paymentStatus paidAt createdAt storeCredit")
            .lean()) as
        | (OrderWithCredit & {
            status?: string;
            paymentStatus?: string;
            paidAt?: Date | null;
            createdAt?: Date;
          })
        | null;

    if (!order) {
      // No order: a checkout still being paid, unless it has stood its time.
      const until = row.heldUntil ? new Date(row.heldUntil).getTime() : 0;
      if (until > now.getTime()) continue;
      const attemptOpen = await CheckoutAttempt.exists({
        "snapshot.storeCredit.holdKey": row.idempotencyKey,
        status: { $in: ["open", "finalizing"] },
      }).catch(() => null);
      if (attemptOpen) continue;
      if (await releaseStoreCreditHold({ idempotencyKey: row.idempotencyKey })) released += 1;
      continue;
    }

    const payment = String(order.paymentStatus || "");
    const everPaid =
      Boolean(order.paidAt) ||
      ["paid", "partially_paid", "refunded", "partially_refunded"].includes(payment);
    if (everPaid) {
      await settleOrderStoreCredit({
        ...order,
        storeCredit: { ...order.storeCredit, holdKey: row.idempotencyKey },
      });
      spent += 1;
      continue;
    }
    const age = now.getTime() - new Date(order.createdAt || now).getTime();
    const over =
      String(order.status || "") === "cancelled" ||
      payment === "failed" ||
      (payment === "expired" && age > EXPIRED_ORDER_CREDIT_GRACE_MS);
    if (!over) continue;
    if (
      await releaseStoreCreditHold({
        idempotencyKey: row.idempotencyKey,
        orderId: String(order._id),
      })
    ) {
      released += 1;
    }
    await markOrderCreditReleased(String(order._id), row.idempotencyKey);
  }
  return { spent, released };
}

/**
 * Take every lot past its expiry date out of the balance, writing an expire
 * row for what each still held. A lot that changed since it was read waits
 * for the next run.
 */
export async function expireStoreCredit(params: {
  now?: Date;
  limit?: number;
} = {}): Promise<number> {
  const now = params.now ?? new Date();
  const due = await StoreCreditTransaction.find({
    type: "issue",
    remaining: { $gt: 0 },
    expiresAt: { $lte: now },
  })
    .select("_id accountId customerId currency remaining")
    .limit(params.limit ?? 500)
    .lean<
      Array<{
        _id: Types.ObjectId;
        accountId: Types.ObjectId;
        customerId: Types.ObjectId;
        currency: string;
        remaining: number;
      }>
    >();
  let expired = 0;
  for (const lot of due) {
    const claimed = await StoreCreditTransaction.updateOne(
      { _id: lot._id, remaining: lot.remaining },
      { $set: { remaining: 0 } },
    );
    if (claimed.modifiedCount !== 1) continue;
    const expiry = await StoreCreditTransaction.create({
      accountId: lot.accountId,
      customerId: lot.customerId,
      currency: lot.currency,
      type: "expire",
      amount: lot.remaining,
      lots: [{ lotId: lot._id, amount: lot.remaining }],
      source: "expiry",
      idempotencyKey: `expire:${String(lot._id)}:${now.getTime()}`,
    });
    // The debt that lapsed comes off the books (R8).
    const { postStoreCreditEventSafely } = await import("@/lib/finance/post-events");
    postStoreCreditEventSafely(expiry.toObject());
    await refreshStoreCreditBalance(lot.customerId, lot.currency, now);
    expired += 1;
  }
  return expired;
}

/** What a shopper can spend now in one currency. */
async function storeCreditBalance(
  customerIdValue: IdLike,
  currencyValue: string,
  now: Date = new Date(),
): Promise<number> {
  const customerId = toId(customerIdValue);
  const currency = currencyOf(currencyValue);
  const [row] = await StoreCreditTransaction.aggregate<{ balance: number }>([
    { $match: { customerId, currency, ...liveLot(now) } },
    { $group: { _id: null, balance: { $sum: "$remaining" } } },
  ]);
  return money(row?.balance ?? 0, currency);
}

/**
 * What a shopper can spend at the checkout of one cart: their balance, plus
 * what an earlier try at this same checkout is holding — that hold is given
 * back, or picked up again, when this one takes its own (`holdCheckoutCredit`).
 */
export async function checkoutCreditAvailable(params: {
  customerId: IdLike;
  currency: string;
  cartId: IdLike;
  now?: Date;
}): Promise<number> {
  const customerId = toId(params.customerId);
  const currency = currencyOf(params.currency);
  const [balance, inPlay] = await Promise.all([
    storeCreditBalance(customerId, currency, params.now),
    cartHoldsInPlay({
      customerId,
      cartId: new Types.ObjectId(String(params.cartId)),
      currency,
    }),
  ]);
  return money(
    balance + inPlay.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    currency,
  );
}

/** A shopper's credit, currency by currency, with the next part to expire. */
export async function storeCreditSummary(
  customerIdValue: IdLike,
  now: Date = new Date(),
): Promise<
  Array<{
    currency: string;
    balance: number;
    nextExpiry: { amount: number; expiresAt: Date } | null;
  }>
> {
  const customerId = toId(customerIdValue);
  const lots = await StoreCreditTransaction.find({ customerId, ...liveLot(now) })
    .select("currency remaining expiresAt")
    .lean<Array<{ currency: string; remaining: number; expiresAt?: Date | null }>>();
  const byCurrency = new Map<string, typeof lots>();
  for (const lot of lots) {
    const list = byCurrency.get(lot.currency) ?? [];
    list.push(lot);
    byCurrency.set(lot.currency, list);
  }
  return Array.from(byCurrency, ([currency, list]) => {
    const expiring = list
      .filter((lot) => lot.expiresAt)
      .sort((a, b) => new Date(a.expiresAt!).getTime() - new Date(b.expiresAt!).getTime())[0];
    return {
      currency,
      balance: money(
        list.reduce((sum, lot) => sum + Number(lot.remaining || 0), 0),
        currency,
      ),
      nextExpiry: expiring
        ? { amount: money(expiring.remaining, currency), expiresAt: new Date(expiring.expiresAt!) }
        : null,
    };
  }).sort((a, b) => a.currency.localeCompare(b.currency));
}

/** A shopper's credit history, newest first. */
export async function storeCreditHistory(
  customerIdValue: IdLike,
  params: { limit?: number } = {},
) {
  const customerId = toId(customerIdValue);
  return StoreCreditTransaction.find({
    customerId,
    // A spend given back never happened, as far as the shopper is concerned.
    $nor: [{ type: "redeem", status: "released" }],
  })
    .sort({ createdAt: -1 })
    .limit(Math.min(200, Math.max(1, params.limit ?? 50)))
    .select("type amount currency remaining expiresAt status source orderId returnId note createdAt")
    .lean();
}
