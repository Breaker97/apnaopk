import "server-only";

import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { Order } from "@/models";
import type { ISettingsData } from "@/models/settings.model";
import { ValidationError } from "@/lib/api/errors";
import { roundMoney } from "@/lib/intl/money";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  toStripeAmount,
} from "@/lib/payments/stripe";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import { posStripeIntentProblem } from "@/lib/pos/stripe-intent-check";
import { getEnabledPOSPaymentMethods } from "@/lib/pos/payment";
import {
  checkPOSTenders,
  legacyTender,
  primaryTenderMethod,
  type POSTender,
  type POSTenderInput,
} from "@/lib/pos/tenders";
import {
  checkoutCreditAvailable,
  holdCheckoutCredit,
} from "@/lib/store-credit/store-credit";

/**
 * How a counter sale is paid, decided on the server.
 *
 * The till says which tenders it took; this checks them against the sale's
 * server-side total, the store's switched-on methods and — for the two tenders
 * that are claims rather than facts at the counter — the systems that hold the
 * money: a Stripe intent is retrieved and matched, and store credit is held
 * against the customer's balance before the order is written.
 */

export interface POSSalePaymentInput {
  tenders?: POSTenderInput[];
  /** Before split payments: one method for the whole sale. */
  paymentMethod?: string;
  cashTendered?: number | string;
  paymentReference?: string;
  paymentNote?: string;
  stripePaymentIntentId?: string;
  /** Pay part now, the rest later. */
  deposit?: boolean;
}

export interface POSSalePayment {
  tenders: POSTender[];
  /** The order's single method: the largest money tender. */
  method: string;
  paid: number;
  balanceDue: number;
  change: number;
  stripePaymentIntentId?: string;
  /** The reference `Order.paymentId` carries for a card sale. */
  paymentId?: string;
  /** Store credit held for the sale; linked and spent once the order exists. */
  storeCredit?: { applied: number; holdKey: string; state: "held" };
  metadata: Record<string, unknown>;
}

/**
 * A deterministic stand-in for the checkout cart a store-credit hold is filed
 * under: the same sale's retry finds its own hold again, and two sales never
 * share one.
 */
export function posCreditHoldCartId(clientRequestId: string): Types.ObjectId {
  return new Types.ObjectId(
    createHash("sha256").update(`pos:${clientRequestId}`).digest("hex").slice(0, 24),
  );
}

export async function resolvePOSSalePayment(params: {
  input: POSSalePaymentInput;
  total: number;
  currency: string;
  settings: ISettingsData;
  /** The session the Stripe intent must have been created by. */
  cashierId: string;
  posLocationId?: string;
  /** The account the sale is filed under, when a customer was chosen. */
  customerAccountId?: string;
  /** Whether any customer (account or guest) is on the sale. */
  hasCustomer: boolean;
  clientRequestId?: string;
}): Promise<POSSalePayment> {
  const { input, currency, settings } = params;
  const total = roundMoney(params.total);

  const rawTenders: POSTenderInput[] =
    Array.isArray(input.tenders) && input.tenders.length > 0
      ? input.tenders
      : (() => {
          const legacy = legacyTender({
            paymentMethod: input.paymentMethod,
            total,
            cashTendered: input.cashTendered,
            paymentReference: input.paymentReference,
            stripePaymentIntentId: input.stripePaymentIntentId,
          });
          return legacy ? [legacy] : [];
        })();

  const allowPartial = input.deposit === true;
  if (allowPartial) {
    if (settings.pos?.checkout?.allowDeposits !== true) {
      throw new ValidationError("Deposits are not switched on for this store");
    }
    if (!params.hasCustomer) {
      throw new ValidationError("Choose the customer a deposit is for");
    }
  }

  const checked = checkPOSTenders({
    tenders: rawTenders,
    total,
    currency,
    enabledMethods: getEnabledPOSPaymentMethods(settings.pos?.checkout?.paymentMethods),
    allowPartial,
  });
  if (!checked.ok) throw new ValidationError(checked.message);

  const tenders = checked.tenders;
  const result: POSSalePayment = {
    tenders,
    method: primaryTenderMethod(tenders),
    paid: checked.paid,
    balanceDue: checked.balanceDue,
    change: checked.change,
    metadata: {},
  };

  // ---- Stripe: the intent must be this cashier's, for exactly its tender.
  const stripeTender = tenders.find((tender) => tender.cardSubMethod === "card_stripe");
  if (stripeTender) {
    const intentId = String(stripeTender.stripePaymentIntentId || "").trim();
    if (await Order.exists({ stripePaymentIntentId: intentId })) {
      throw new ValidationError("Stripe payment has already been used");
    }
    const stripeSettings = settings.payment?.stripe;
    if (!stripeSettings?.enabled) throw new ValidationError("Stripe is disabled");
    const secretKey = resolveStripeCredentials(stripeSettings).secretKey;
    if (!isStripeSecretKeyConfigured(secretKey)) throw new ValidationError("Stripe is not configured");
    const stripeCurrency = currency.toLowerCase();
    const intent = await getStripeForSecretKey(secretKey).paymentIntents.retrieve(intentId, {
      expand: ["latest_charge"],
    });
    const problem = posStripeIntentProblem(intent, {
      amount: toStripeAmount(stripeTender.amount, stripeCurrency),
      currency: stripeCurrency,
      cashierId: params.cashierId,
      posLocationId: params.posLocationId,
    });
    if (problem) throw new ValidationError(problem);
    result.stripePaymentIntentId = intent.id;
    stripeTender.stripePaymentIntentId = intent.id;
  }

  // ---- Store credit: held now, against what the customer actually has.
  const creditTotal = roundMoney(
    tenders
      .filter((tender) => tender.method === "store_credit")
      .reduce((sum, tender) => sum + tender.amount, 0),
  );
  if (creditTotal > 0) {
    if (!params.customerAccountId) {
      throw new ValidationError("Store credit belongs to a customer account. Choose the customer first.");
    }
    if (!params.clientRequestId) {
      throw new ValidationError("Store credit needs the sale's request key");
    }
    const cartId = posCreditHoldCartId(params.clientRequestId);
    const available = await checkoutCreditAvailable({
      customerId: params.customerAccountId,
      currency,
      cartId,
    });
    if (creditTotal > available + 0.0000001) {
      throw new ValidationError("The customer does not have that much store credit");
    }
    const hold = await holdCheckoutCredit({
      customerId: params.customerAccountId,
      currency,
      amount: creditTotal,
      cartId,
      method: "pos",
      fingerprint: params.clientRequestId,
    });
    result.storeCredit = { applied: hold.amount, holdKey: hold.holdKey, state: "held" };
  }

  // A card sale's reference is its payment id, as it always was.
  const card = tenders.find((tender) => tender.method === "card");
  result.paymentId =
    result.stripePaymentIntentId ||
    (result.method === "card" && card?.reference ? card.reference : undefined);

  const note = String(input.paymentNote || "").trim().slice(0, 500) || undefined;
  result.metadata = {
    posPayment: {
      method: result.method,
      tenders: tenders.map((tender) => ({ ...tender })),
      ...(result.change > 0 ? { changeDue: result.change } : {}),
      ...(result.balanceDue > 0 ? { balanceDue: result.balanceDue } : {}),
      ...(note ? { note } : {}),
    },
  };
  return result;
}
