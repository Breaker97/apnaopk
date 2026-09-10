import {
  VENDOR_PACK_LABELS,
  type VendorPermissionPack,
} from "@/config/permissions.config";

interface PlanLimits {
  products?: number | null;
  staff?: number | null;
}

function formatLimit(value?: number | null): string {
  return value == null ? "Unlimited" : String(value);
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
 * Fold a plan's limits and capability packs into its feature list so every
 * surface — the admin catalog and the vendor onboarding wizard — renders the
 * same bullet points on the shared PricingPlanCard.
 *
 * The pack lines are DERIVED rather than hand-written, so the pricing page
 * cannot promise something the entitlement layer will refuse (guideline §2.2).
 * `features` stays free text for anything packs do not express — support terms,
 * commission rate copy, and so on.
 */
export function planFeatureLines(
  features: string[],
  limits?: PlanLimits,
  options?: { packs?: readonly VendorPermissionPack[] },
): string[] {
  const lines = [
    `${formatLimit(limits?.products)} product upload limit`,
    `${formatLimit(limits?.staff)} staff limit`,
  ];

  for (const pack of options?.packs ?? []) {
    if (UNREMARKABLE_PACKS.includes(pack)) continue;
    const label = VENDOR_PACK_LABELS[pack];
    if (label) lines.push(`${label} included`);
  }

  return [...features, ...lines];
}
