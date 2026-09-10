import { isRecord } from "@/lib/utils";
/**
 * Checkout appearance settings — the CONSTRAINED editor's data.
 *
 * Checkout is deliberately not a section template: the flow (contact →
 * address → shipping → payment) is conversion- and correctness-critical, so
 * admins brand it, they don't rebuild it. What is configurable:
 *   - chrome: the full store header/footer, or a focused minimal bar
 *   - trust copy next to the payment step + a secure badge
 *   - the policy-link row under the pay button
 *
 * Logo and colors are intentionally absent — the logo stays canonical in
 * `general.*` (Branding) and colors come from the active theme's settings,
 * so checkout can never drift off-brand.
 */

export type CheckoutChromeMode = "store" | "focused";

interface CheckoutPolicyLink {
  label: string;
  /** Relative ("/returns") or absolute URL; relative gets the locale prefix. */
  href: string;
  visible: boolean;
}

export interface CheckoutSettings {
  layout: {
    /**
     * "store" renders checkout inside the normal storefront chrome (the
     * pre-existing behaviour). "focused" hides the store header, footer,
     * bottom nav and assistant widget and shows a minimal logo + secure bar.
     */
    chrome: CheckoutChromeMode;
  };
  trust: {
    /** Shown under the Payment heading. "" = the built-in translated line. */
    message: string;
    /** Lock badge in the focused top bar and beside the trust message. */
    showSecureBadge: boolean;
    /** Optional help line under the pay button. "" = hidden. */
    supportText: string;
  };
  policyLinks: CheckoutPolicyLink[];
}

export const MAX_CHECKOUT_POLICY_LINKS = 6;

const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  layout: {
    chrome: "store",
  },
  trust: {
    message: "",
    showSecureBadge: true,
    supportText: "",
  },
  policyLinks: [
    { label: "Refund policy", href: "/returns", visible: true },
    { label: "Privacy policy", href: "/privacy", visible: true },
    { label: "Terms of service", href: "/terms", visible: true },
  ],
};

function cloneDefaults(): CheckoutSettings {
  return JSON.parse(
    JSON.stringify(DEFAULT_CHECKOUT_SETTINGS),
  ) as CheckoutSettings;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeChromeMode(value: unknown): CheckoutChromeMode {
  return value === "focused" ? "focused" : "store";
}

function normalizePolicyLinks(value: unknown): CheckoutPolicyLink[] {
  if (!Array.isArray(value)) return cloneDefaults().policyLinks;

  return value
    .map((item) => {
      const source = isRecord(item) ? item : {};
      return {
        label: normalizeString(source.label, "").trim(),
        href: normalizeString(source.href, "").trim(),
        visible: normalizeBoolean(source.visible, true),
      };
    })
    .filter((link) => link.label && link.href)
    .slice(0, MAX_CHECKOUT_POLICY_LINKS);
}

export function getDefaultCheckoutSettings(): CheckoutSettings {
  return cloneDefaults();
}

export function normalizeCheckoutSettings(value: unknown): CheckoutSettings {
  const defaults = cloneDefaults();
  const source = isRecord(value) ? value : {};

  const layout = isRecord(source.layout) ? source.layout : {};
  const trust = isRecord(source.trust) ? source.trust : {};

  return {
    layout: {
      chrome: normalizeChromeMode(layout.chrome),
    },
    trust: {
      message: normalizeString(trust.message, defaults.trust.message),
      showSecureBadge: normalizeBoolean(
        trust.showSecureBadge,
        defaults.trust.showSecureBadge,
      ),
      supportText: normalizeString(
        trust.supportText,
        defaults.trust.supportText,
      ),
    },
    // An explicitly-saved empty array stays empty (the admin removed every
    // link); only a missing/garbage value falls back to the defaults.
    policyLinks: normalizePolicyLinks(source.policyLinks),
  };
}
