import "server-only";

import { ValidationError } from "@/lib/api/errors";
import { canApplyPosDiscount } from "@/lib/access/rbac";
import { loadCategoryTaxTree, productTaxRate } from "@/lib/tax/tax-rates";
import type { TaxRateComponent } from "@/lib/tax/tax-settings";

/**
 * The tax side of a counter sale, shared by the card intent and the order
 * route so the amount a card is charged and the sale it pays for agree:
 * each product's own rate, and whether this sale may be sold tax-free.
 */

/**
 * Each product's own rate (fraction), from the rows the route already read —
 * with `partsOf`, the parts (VAT, SD) each is charged at, when known.
 */
export async function posTaxRates(
  products: Array<{ _id: unknown; taxRate?: number | null; taxClass?: string | null; category?: unknown; chargeTax?: boolean }>,
  /** When the sale was made, if not now — a sale replayed from a till's offline queue. */
  options: { at?: number } = {},
): Promise<((productId: unknown) => number | null) & { partsOf: (productId: unknown) => TaxRateComponent[] | undefined }> {
  const tree = await loadCategoryTaxTree(options.at);
  const rates = new Map(products.map((product) => [String(product._id), productTaxRate(product, tree)]));
  const parts = new Map(products.map((product) => [String(product._id), tree.partsOf?.(product)]));
  const key = (productId: unknown) => String(productId ?? "").trim();
  return Object.assign((productId: unknown) => rates.get(key(productId)) ?? null, {
    partsOf: (productId: unknown) => parts.get(key(productId)),
  });
}

export interface POSTaxExemptionInput {
  reason?: string;
  reference?: string;
}

/**
 * A tax-exempt sale's reason and reference (a certificate number), when the
 * cashier asked for one. The same seats that may give a discount may sell
 * tax-free — both take money off what the store collects — and a reason is
 * required, because it is what an auditor reads.
 */
export async function resolvePOSTaxExemption(
  input: POSTaxExemptionInput | null | undefined,
  operator: { id: string; role?: string | null; roles?: (string | null | undefined)[] | null },
): Promise<{ reason: string; reference?: string } | null> {
  if (!input) return null;
  const reason = String(input.reason || "").trim().slice(0, 200);
  if (!reason) throw new ValidationError("Say why this sale is tax-exempt");
  if (
    !(await canApplyPosDiscount({
      id: operator.id,
      role: operator.role ?? undefined,
      roles: (operator.roles ?? undefined) as string[] | undefined,
    }))
  ) {
    throw new ValidationError("Only a seat that manages the POS can sell tax-free");
  }
  const reference = String(input.reference || "").trim().slice(0, 120);
  return { reason, ...(reference ? { reference } : {}) };
}
