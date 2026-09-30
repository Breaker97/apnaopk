import { formatCurrency } from "@/lib/intl/money";
import { resolveCurrency } from "@/lib/intl/currencies";
import {
  ALL_VENDOR_PACKS,
  VENDOR_PACK_LABELS,
  type VendorPermissionPack,
} from "@/config/permissions.config";

type PlanBillingInterval = "monthly" | "yearly" | "none";

interface PlanLimits {
  products?: number | null;
  staff?: number | null;
}

/**
 * Packs every plan is expected to include, so listing them would be noise. What
 * a buyer wants on the card is what makes THIS plan different — the packs a
 * leaner tier does not have.
 */
const UNREMARKABLE_PACKS: VendorPermissionPack[] = [
  "catalog",
  "orders",
  "storefront",
  "analytics",
];

/**
 * Whether a pack earns a line of its own. Staff is sold as seats, so the seat
 * line already says it and a separate "Staff" line would repeat it.
 */
function isListedPack(pack: VendorPermissionPack): boolean {
  return !UNREMARKABLE_PACKS.includes(pack) && pack !== "staff";
}

function packLabels(packs: readonly VendorPermissionPack[]): string[] {
  return packs.map((pack) => VENDOR_PACK_LABELS[pack]).filter(Boolean);
}

/**
 * Plan prices carry no currency of their own — `VendorPlan.price` is charged in
 * the store currency (see `lib/vendor-plan-stripe.ts`), so the card falls back
 * to the store default rather than to a hardcoded USD that would mislabel every
 * plan on a non-dollar marketplace.
 */
export function planPriceParts(
  plan: { price: number; billingInterval: PlanBillingInterval; currency?: string },
  storeCurrencyCode: string,
): { amount: string; cadence: string } {
  if (plan.billingInterval === "none" || plan.price <= 0) {
    return { amount: "Free", cadence: "" };
  }
  const currency = resolveCurrency(plan.currency || storeCurrencyCode);
  return {
    amount: formatCurrency(plan.price, currency.code, currency.locale, {
      minimumFractionDigits: plan.price % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }),
    cadence: plan.billingInterval === "yearly" ? "/year" : "/month",
  };
}

/**
 * The admin list's short answer to "what does this plan unlock". A plan that
 * lacks a single pack says which one; anything leaner is a count, with the
 * names left to the tooltip.
 */
export function planToolsSummary(packs: readonly VendorPermissionPack[]): string {
  const missing = missingPlanPacks(packs);
  if (missing.length === 0) return "All tools";
  if (missing.length === 1) return `All but ${VENDOR_PACK_LABELS[missing[0]]}`;
  return `${ALL_VENDOR_PACKS.length - missing.length} of ${ALL_VENDOR_PACKS.length} tools`;
}

/** The packs a plan does not sell, in catalogue order. */
function missingPlanPacks(
  packs: readonly VendorPermissionPack[],
): VendorPermissionPack[] {
  return ALL_VENDOR_PACKS.filter((pack) => !packs.includes(pack));
}

/** "Missing: Inbox, Point of Sale" — the detail behind a tools count. */
export function missingPlanPacksLabel(
  packs: readonly VendorPermissionPack[],
): string | null {
  const missing = missingPlanPacks(packs);
  return missing.length > 0 ? `Missing: ${packLabels(missing).join(", ")}` : null;
}

function capWord(value: number | null | undefined, one: string, many: string) {
  if (value == null) return `Unlimited ${many}`;
  return `${value} ${value === 1 ? one : many}`;
}

/** "500 products · 3 staff", or "No limits" when the plan caps neither. */
export function planLimitsSummary(limits?: PlanLimits): string {
  const products = limits?.products ?? null;
  const staff = limits?.staff ?? null;
  if (products === null && staff === null) return "No limits";
  return `${capWord(products, "product", "products")} · ${
    staff === null ? "Unlimited" : staff
  } staff`;
}

/**
 * The listed packs every one of these plans sells. The vendor picker says them
 * once under the grid instead of on every card, so each card is left with only
 * what sets it apart.
 */
export function sharedPlanPacks(
  plans: readonly { packs?: readonly VendorPermissionPack[] }[],
): VendorPermissionPack[] {
  if (plans.length === 0) return [];
  return ALL_VENDOR_PACKS.filter(
    (pack) =>
      isListedPack(pack) && plans.every((plan) => (plan.packs ?? []).includes(pack)),
  );
}

/** The one line under the plan grid, or null when there is nothing shared. */
export function sharedPlanPacksSentence(
  packs: readonly VendorPermissionPack[],
  planCount: number,
): string | null {
  if (packs.length === 0) return null;
  const names = new Intl.ListFormat("en", {
    style: "long",
    type: "conjunction",
  }).format(packLabels(packs));
  return planCount > 1 ? `Every plan includes ${names}.` : `Includes ${names}.`;
}

/**
 * What one card lists: its caps, then the tools the other plans in view do not
 * all have, then the admin's own lines.
 *
 * The pack lines are DERIVED rather than hand-written, so the pricing page
 * cannot promise something the entitlement layer will refuse (guideline §2.2).
 * `features` stays free text for anything packs do not express — support terms
 * and so on.
 */
export function planCardLines(
  plan: {
    features?: readonly string[];
    limits?: PlanLimits;
    packs?: readonly VendorPermissionPack[];
  },
  sharedPacks: readonly VendorPermissionPack[],
): string[] {
  const packs = plan.packs ?? [];
  const lines: string[] = [];

  // A cap of 0 means the plan grants none of it, which is not a selling point.
  if (plan.limits?.products !== 0) {
    lines.push(capWord(plan.limits?.products, "product", "products"));
  }
  if (packs.includes("staff") && plan.limits?.staff !== 0) {
    lines.push(capWord(plan.limits?.staff, "staff seat", "staff seats"));
  }
  for (const pack of ALL_VENDOR_PACKS) {
    if (isListedPack(pack) && packs.includes(pack) && !sharedPacks.includes(pack)) {
      lines.push(VENDOR_PACK_LABELS[pack]);
    }
  }

  return [...lines, ...(plan.features ?? []).filter((line) => line.trim())];
}
