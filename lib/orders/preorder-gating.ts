import { ValidationError } from "@/lib/api/errors";
import type { PreorderSettingsShape } from "@/lib/orders/preorders";
import type { VendorPreorderAccess } from "@/lib/products/form-options-types";

/**
 * What a vendor is allowed to promise with a pre-order.
 *
 * The asymmetry this exists for: a pre-order takes the buyer's money NOW for
 * goods a vendor will make LATER, and the money lands on the platform's
 * gateway credentials. So an over-promised release date or an outsized deposit
 * is not the vendor's exposure, it is the platform's — the refund, the
 * chargeback and the complaint all arrive here. Before this, any vendor could
 * open a pre-order on any product, for any lead time, at any deposit, with
 * nobody asked.
 *
 * Every limit is read from settings rather than hard-coded, because the right
 * answer differs by market: a store shipping electronics from overseas has a
 * genuine 120-day lead time, and one selling baked goods does not. See
 * `IPreorderSettings` for why the shipped defaults change nothing on upgrade.
 *
 * Called on write, never on read. A listing that predates a tightened limit
 * keeps selling — pulling live listings out from under a vendor because an
 * admin moved a number is a far worse failure than letting the old ones run
 * out, and the vendor meets the new rule the next time they touch the product.
 */

export interface PreorderPolicy {
  enabled?: boolean;
  requireVendorApproval?: boolean;
  maxLeadDays?: number;
  maxDepositPercent?: number;
  expiryGraceDays?: number;
  autoRelease?: boolean;
  autoReleaseDelayDays?: number;
  reservePercent?: number;
  reserveDays?: number;
}

export interface PreorderVendorAccess {
  preorder?: {
    enabled?: boolean;
    requestedAt?: Date | string | null;
  } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Resolved limits, with the same fallbacks the schema declares. */
export function resolvePreorderPolicy(policy?: PreorderPolicy | null) {
  return {
    enabled: policy?.enabled !== false,
    requireVendorApproval: policy?.requireVendorApproval === true,
    maxLeadDays: Number(policy?.maxLeadDays) > 0 ? Number(policy?.maxLeadDays) : 180,
    maxDepositPercent:
      Number.isFinite(Number(policy?.maxDepositPercent)) &&
      Number(policy?.maxDepositPercent) >= 0
        ? Number(policy?.maxDepositPercent)
        : 100,
    expiryGraceDays:
      Number(policy?.expiryGraceDays) > 0 ? Number(policy?.expiryGraceDays) : 14,
    // Explicitly true, never merely truthy: this one asks a store's shoppers
    // for money on its behalf, so a stray value must not switch it on.
    autoRelease: policy?.autoRelease === true,
    // Zero is a real answer — "on the release date itself" — not a missing one.
    autoReleaseDelayDays:
      Number(policy?.autoReleaseDelayDays) > 0
        ? Math.min(90, Number(policy?.autoReleaseDelayDays))
        : 0,
    // Zero is a real answer here, not a missing one — it means "no reserve".
    reservePercent:
      Number(policy?.reservePercent) > 0
        ? Math.min(50, Number(policy?.reservePercent))
        : 0,
    reserveDays: Number(policy?.reserveDays) > 0 ? Number(policy?.reserveDays) : 90,
  };
}

function asDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Whether this vendor may open a new pre-order, and if not, which gate stops
 * them — the first two checks of `assertPreorderAllowed`, answered up front so
 * the product editor can say so before the vendor has filled anything in.
 */
export function resolveVendorPreorderAccess(
  policy?: PreorderPolicy | null,
  vendor?: PreorderVendorAccess | null,
): VendorPreorderAccess {
  const limits = resolvePreorderPolicy(policy);
  const blockedBy = !limits.enabled
    ? "store"
    : limits.requireVendorApproval && !vendor?.preorder?.enabled
      ? "approval"
      : null;
  return {
    allowed: blockedBy === null,
    blockedBy,
    requestedAt: asDate(vendor?.preorder?.requestedAt)?.toISOString() ?? null,
    maxLeadDays: limits.maxLeadDays,
    maxDepositPercent: limits.maxDepositPercent,
  };
}

export type PreorderAccessDecision = "approved" | "declined" | "revoked";

/**
 * What an admin's grant-or-withdraw actually changed for the vendor, so the
 * vendor is told only when something happened to them.
 *
 * `null` means nothing did: re-approving a vendor who already has access,
 * refusing one who neither has access nor asked for it — or any decision while
 * the store is not gating vendors at all. With pre-orders off for everyone, or
 * review off so everyone may, the flag changes nothing today, and "you can no
 * longer open new pre-orders" would tell a vendor who still can that they can't.
 */
export function preorderAccessDecision(
  before: PreorderVendorAccess["preorder"],
  enabled: boolean,
  policy?: PreorderPolicy | null,
): PreorderAccessDecision | null {
  const limits = resolvePreorderPolicy(policy);
  if (!limits.enabled || !limits.requireVendorApproval) return null;
  const hadAccess = Boolean(before?.enabled);
  if (enabled) return hadAccess ? null : "approved";
  if (hadAccess) return "revoked";
  return before?.requestedAt ? "declined" : null;
}

/**
 * Throw unless this pre-order is inside the platform's limits.
 *
 * A no-op for a product that is not on pre-order — the caller does not have to
 * know whether the settings block is even relevant.
 */
export function assertPreorderAllowed(params: {
  preorder?: PreorderSettingsShape | null;
  policy?: PreorderPolicy | null;
  vendor?: PreorderVendorAccess | null;
  /**
   * Unit price, when the caller knows it. Only a fixed-amount deposit needs
   * it: a percentage compares to the cap directly, but "60 off a 100 item"
   * cannot be judged without the 100.
   */
  unitPrice?: number;
  /**
   * Whether the store has any gateway that could take the rest later. False
   * makes the two deferred modes unsellable, so they are refused at the point
   * a vendor chooses one rather than at the shopper's checkout.
   */
  storeCanCollectBalance?: boolean;
  /** Names the offending field, so a variant's error points at the variant. */
  field?: string;
}): void {
  const { preorder } = params;
  if (!preorder?.enabled) return;

  const field = params.field || "preorder";
  const limits = resolvePreorderPolicy(params.policy);

  if (!limits.enabled) {
    throw new ValidationError({
      [field]: ["Pre-orders are switched off for this store"],
    });
  }

  if (limits.requireVendorApproval && !params.vendor?.preorder?.enabled) {
    throw new ValidationError({
      [field]: [
        "This store has to approve your account for pre-orders before you can open one. Ask an admin to enable it.",
      ],
    });
  }

  const releaseDate = asDate(preorder.releaseDate);
  if (!releaseDate) {
    // A pre-order with no date is the promise every complaint starts with:
    // the buyer has paid and nobody has said when. The storefront already
    // needs the date to render, so requiring it costs nothing honest.
    throw new ValidationError({
      [field]: ["A pre-order needs a release date"],
    });
  }
  const leadDays = Math.ceil((releaseDate.getTime() - Date.now()) / DAY_MS);
  if (leadDays > limits.maxLeadDays) {
    throw new ValidationError({
      [field]: [
        `Release dates can be at most ${limits.maxLeadDays} days out. This one is ${leadDays}.`,
      ],
    });
  }

  // A mode that leaves money owing needs somewhere for that money to come
  // from. `storeCanCollectBalance === undefined` means the caller did not ask
  // — the older callers, and the tests that predate this — so it is only
  // enforced when an answer was actually supplied.
  const leavesABalance =
    preorder.paymentMode === "deposit" || preorder.paymentMode === "pay_later";
  if (leavesABalance && params.storeCanCollectBalance === false) {
    throw new ValidationError({
      [field]: [
        "No payment method on this store can collect the rest of a pre-order later, so it has to be paid in full. Turn on card payments to offer a deposit.",
      ],
    });
  }

  const depositValue = Number(preorder.depositValue || 0);
  if (preorder.paymentMode === "deposit" && depositValue > 0) {
    const percent =
      preorder.depositType === "fixed"
        ? Number(params.unitPrice) > 0
          ? (depositValue / Number(params.unitPrice)) * 100
          : // No price to measure against — the deposit is still clamped to the
            // line total downstream, so let it through rather than guess.
            0
        : depositValue;
    if (percent > limits.maxDepositPercent) {
      throw new ValidationError({
        [field]: [
          `Deposits can be at most ${limits.maxDepositPercent}% of the price.`,
        ],
      });
    }
  }
}

/**
 * Everything a limit above actually looks at, and nothing else.
 *
 * Comparing whole pre-order blocks would be wrong, not merely wasteful:
 * `reservedQuantity` moves every time a shopper reserves one, so an untouched
 * form would read as changed on any busy product and be re-validated anyway.
 */
function validationFingerprint(preorder?: PreorderSettingsShape | null): string {
  if (!preorder) return "";
  return JSON.stringify({
    enabled: Boolean(preorder.enabled),
    releaseDate: asDate(preorder.releaseDate)?.getTime() ?? null,
    paymentMode: preorder.paymentMode ?? "full",
    depositType: preorder.depositType ?? "percentage",
    depositValue: Number(preorder.depositValue || 0),
  });
}

type PreorderVariantShape = {
  _id?: unknown;
  name?: string;
  price?: number;
  preorder?: PreorderSettingsShape | null;
};

/**
 * The same check across a product and each of its variants.
 *
 * Variants carry their own pre-order block and override the product's, so a
 * product that passes says nothing about a variant that does not.
 *
 * Pass `stored` on an update and a block this request does not change is left
 * alone. That is what makes the promise at the top of this file true: a vendor
 * renaming a product does not have to satisfy a limit tightened since they
 * last touched it, and — the case that actually bit — a pre-order saved before
 * a release date was required does not make every later edit unsavable. The
 * moment they edit the pre-order itself, the current rules apply in full.
 */
export function assertProductPreorderAllowed(params: {
  product: {
    price?: number;
    preorder?: PreorderSettingsShape | null;
    variants?: PreorderVariantShape[] | null;
  };
  /** The product as stored. Omitted on create, where everything is new. */
  stored?: {
    preorder?: PreorderSettingsShape | null;
    variants?: PreorderVariantShape[] | null;
  } | null;
  policy?: PreorderPolicy | null;
  vendor?: PreorderVendorAccess | null;
  storeCanCollectBalance?: boolean;
}): void {
  if (
    validationFingerprint(params.product.preorder) !==
    validationFingerprint(params.stored?.preorder)
  ) {
    assertPreorderAllowed({
      preorder: params.product.preorder,
      policy: params.policy,
      vendor: params.vendor,
      unitPrice: params.product.price,
      storeCanCollectBalance: params.storeCanCollectBalance,
    });
  }

  const storedVariants = new Map(
    (params.stored?.variants || [])
      .filter((variant) => variant?._id)
      .map((variant) => [String(variant._id), variant]),
  );

  for (const [index, variant] of (params.product.variants || []).entries()) {
    // A variant with no id is new, so it has nothing stored to match and is
    // always judged.
    const before = variant?._id
      ? storedVariants.get(String(variant._id))
      : undefined;
    if (
      validationFingerprint(variant?.preorder) ===
      validationFingerprint(before?.preorder)
    ) {
      continue;
    }
    assertPreorderAllowed({
      preorder: variant?.preorder,
      policy: params.policy,
      vendor: params.vendor,
      unitPrice: variant?.price ?? params.product.price,
      storeCanCollectBalance: params.storeCanCollectBalance,
      field: `variants.${index}.preorder`,
    });
  }
}
