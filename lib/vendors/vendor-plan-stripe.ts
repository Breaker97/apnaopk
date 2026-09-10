import Stripe from "stripe";
import { VendorPlan } from "@/models";
import {
  VENDOR_BILLING_INTERVAL,
  VENDOR_PLAN_STATUS,
} from "@/config/app.config";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import { ValidationError } from "@/lib/api/errors";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  toStripeAmount,
} from "@/lib/payments/stripe";
import type { ISettings } from "@/models/settings.model";
import type { VendorPlanForApplication } from "@/lib/vendors/vendor-application";

type StripeRecurringInterval = "month" | "year";

interface VendorPlanStripeSyncFields {
  stripeProductId: string;
  stripePriceId: string;
  stripePriceCurrency: string;
  stripePriceActive: boolean;
  stripeSyncedAt: Date;
}

function stripeIntervalForPlan(interval: string): StripeRecurringInterval {
  if (interval === VENDOR_BILLING_INTERVAL.MONTHLY) return "month";
  if (interval === VENDOR_BILLING_INTERVAL.YEARLY) return "year";
  throw new ValidationError("Only monthly or yearly paid plans can be billed");
}

function isStripeMissing(error: unknown): boolean {
  const e = error as { statusCode?: number; code?: string } | null;
  return e?.statusCode === 404 || e?.code === "resource_missing";
}

export function isActivePaidVendorPlan(
  plan: Pick<VendorPlanForApplication, "price" | "billingInterval" | "status">,
): boolean {
  return (
    plan.status === VENDOR_PLAN_STATUS.ACTIVE &&
    plan.billingInterval !== VENDOR_BILLING_INTERVAL.NONE &&
    Number(plan.price || 0) > 0
  );
}

export const ARCHIVED_VENDOR_PLAN_MESSAGE =
  "This vendor plan is no longer offered. Ask an admin to move your application to a current plan.";

/**
 * Reject a plan that was archived between approval and payment.
 *
 * Archiving stops a plan being offered; it deliberately leaves subscriptions
 * already running on it alone. The paths that can newly put a vendor on a plan
 * all refuse an archived one, and checkout has to refuse it by name too —
 * otherwise the rejection surfaces from inside price creation as "Only active
 * paid plans need Stripe billing", which says nothing about what happened or
 * what the vendor should do.
 */
export function assertVendorPlanStillOffered(
  plan: Pick<VendorPlanForApplication, "status">,
): void {
  if (plan.status !== VENDOR_PLAN_STATUS.ACTIVE) {
    throw new ValidationError(ARCHIVED_VENDOR_PLAN_MESSAGE);
  }
}

export function assertStripeBillingReady(settings: ISettings): string {
  const stripeSettings = settings.payment?.stripe;
  if (!stripeSettings?.enabled) {
    throw new ValidationError("Stripe must be enabled before offering paid vendor plans");
  }

  const secretKey = resolveStripeCredentials(stripeSettings).secretKey;
  if (!isStripeSecretKeyConfigured(secretKey)) {
    throw new ValidationError(
      "Stripe is enabled but not configured. Please add Stripe Secret Key in Admin Settings before offering paid vendor plans.",
    );
  }

  return secretKey as string;
}

function priceMatchesPlan(
  price: Stripe.Price,
  expected: {
    currency: string;
    unitAmount: number;
    interval: StripeRecurringInterval;
  },
): boolean {
  return (
    price.active === true &&
    price.currency.toLowerCase() === expected.currency.toLowerCase() &&
    price.unit_amount === expected.unitAmount &&
    price.recurring?.interval === expected.interval
  );
}

async function retrieveProduct(
  stripe: Stripe,
  productId: string | null | undefined,
) {
  if (!productId) return null;
  try {
    const product = await stripe.products.retrieve(productId);
    return product.deleted ? null : product;
  } catch (error) {
    if (isStripeMissing(error)) return null;
    throw error;
  }
}

async function retrievePrice(
  stripe: Stripe,
  priceId: string | null | undefined,
) {
  if (!priceId) return null;
  try {
    return await stripe.prices.retrieve(priceId);
  } catch (error) {
    if (isStripeMissing(error)) return null;
    throw error;
  }
}

export async function ensureStripePriceForVendorPlan(
  plan: VendorPlanForApplication,
  settings: ISettings,
  opts?: { persist?: boolean },
): Promise<VendorPlanStripeSyncFields> {
  if (!isActivePaidVendorPlan(plan)) {
    throw new ValidationError("Only active paid plans need Stripe billing");
  }

  const secretKey = assertStripeBillingReady(settings);
  const stripe = getStripeForSecretKey(secretKey);
  const currency = (settings.general?.defaultCurrency || "USD").toLowerCase();
  const unitAmount = toStripeAmount(Number(plan.price || 0), currency);
  const interval = stripeIntervalForPlan(plan.billingInterval);
  const planId = String(plan._id);

  let product = await retrieveProduct(stripe, plan.stripeProductId);
  if (product) {
    product = await stripe.products.update(product.id, {
      name: plan.name,
      description: plan.description || undefined,
      active: true,
      metadata: {
        kind: "vendor_plan",
        planId,
      },
    });
  } else {
    product = await stripe.products.create(
      {
        name: plan.name,
        description: plan.description || undefined,
        active: true,
        metadata: {
          kind: "vendor_plan",
          planId,
        },
      },
      { idempotencyKey: `vendor-plan-product-${planId}` },
    );
  }

  const existingPrice = await retrievePrice(stripe, plan.stripePriceId);
  let price =
    existingPrice && priceMatchesPlan(existingPrice, { currency, unitAmount, interval })
      ? existingPrice
      : null;

  if (!price) {
    price = await stripe.prices.create(
      {
        product: product.id,
        currency,
        unit_amount: unitAmount,
        recurring: { interval },
        nickname: plan.name,
        metadata: {
          kind: "vendor_plan",
          planId,
          billingInterval: plan.billingInterval,
        },
      },
      {
        idempotencyKey: `vendor-plan-price-${planId}-${currency}-${unitAmount}-${interval}`,
      },
    );

    // Keep versioned prices active: submitted applications snapshot a price ID
    // and may be approved after the catalog price changes.
  }

  const fields: VendorPlanStripeSyncFields = {
    stripeProductId: product.id,
    stripePriceId: price.id,
    stripePriceCurrency: currency.toUpperCase(),
    stripePriceActive: Boolean(price.active),
    stripeSyncedAt: new Date(),
  };

  if (opts?.persist !== false) {
    await VendorPlan.updateOne({ _id: String(plan._id) }, { $set: fields });
  }

  return fields;
}
