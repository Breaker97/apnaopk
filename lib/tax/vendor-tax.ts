import type { VendorTaxChangePolicy } from "@/lib/tax/tax-settings";

/**
 * Who may change a vendor's product tax — Charge tax, the tax class, a custom
 * rate. The store answers for the tax its marketplace collects, so under the
 * default policy a vendor asks and the admin decides (a VendorTaxRequest);
 * under "never" only the store changes it, and under "free" the vendor does.
 *
 * Every vendor write path — the product API, the CSV import, the business
 * app — refuses a change through `vendorTaxRefusal`, so the rule cannot be
 * stepped around by choosing a different door. A write that repeats the
 * product's tax as it is (the product form always sends it) is not a change.
 *
 * Pure and client-safe: the product form reads the same rules.
 */

export interface ProductTax {
  chargeTax: boolean;
  /** Settings → Tax class key; null takes the category's. */
  taxClass: string | null;
  /** Custom rate in percent; null when the product has none. */
  taxRate: number | null;
}

/** A new product's tax: charged, at its category's class or rate. */
export const INHERITED_PRODUCT_TAX: ProductTax = { chargeTax: true, taxClass: null, taxRate: null };

export function productTaxOf(product: {
  chargeTax?: boolean | null;
  taxClass?: string | null;
  taxRate?: number | null;
} | null | undefined): ProductTax {
  return {
    chargeTax: product?.chargeTax !== false,
    taxClass: typeof product?.taxClass === "string" && product.taxClass ? product.taxClass : null,
    taxRate: typeof product?.taxRate === "number" && Number.isFinite(product.taxRate) ? product.taxRate : null,
  };
}

export function sameProductTax(a: ProductTax, b: ProductTax): boolean {
  return a.chargeTax === b.chargeTax && a.taxClass === b.taxClass && a.taxRate === b.taxRate;
}

const has = (payload: object, key: string) => Object.prototype.hasOwnProperty.call(payload, key);

/**
 * The tax a write would leave the product with: the fields it carries over
 * the product's own. `null` clears a class or rate, as the editors send it.
 */
export function taxAfterWrite(before: ProductTax, payload: Record<string, unknown>): ProductTax {
  return productTaxOf({
    chargeTax: has(payload, "chargeTax") && typeof payload.chargeTax === "boolean" ? payload.chargeTax : before.chargeTax,
    taxClass: has(payload, "taxClass") ? (payload.taxClass as string | null) : before.taxClass,
    taxRate: has(payload, "taxRate") ? (payload.taxRate as number | null) : before.taxRate,
  });
}

/** Whether a vendor may write a product's tax themselves under this policy. */
export const vendorMayChangeTax = (policy: VendorTaxChangePolicy) => policy === "free";

/**
 * Why a vendor's write may not set this tax, or null when it may: the policy
 * lets them, or the write leaves the tax as it was. `before` is the product
 * as stored, or null for a new one (which starts on its category's tax).
 */
export function vendorTaxRefusal(
  policy: VendorTaxChangePolicy,
  before: ProductTax | null,
  after: ProductTax,
): string | null {
  if (vendorMayChangeTax(policy)) return null;
  if (sameProductTax(before ?? INHERITED_PRODUCT_TAX, after)) return null;
  return policy === "approval"
    ? "Changing a product's tax needs the store's approval. Send a tax change request from the product's tax section."
    : "Only the store can change a product's tax.";
}
