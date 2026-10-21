import "server-only";

import { Category, Product } from "@/models";
import { connectDB } from "@/lib/db";

/**
 * How the catalog is taxed, for Settings → Tax's overview: which classes are
 * in use, and how many products and categories still carry a custom rate of
 * their own (lib/tax/tax-rates.ts reads the same fields).
 */
export interface TaxUsage {
  products: { customRate: number; untaxed: number; byClass: Record<string, number> };
  categories: { customRate: number; byClass: Record<string, number> };
}

type ClassCount = { _id: string; count: number };

const byClass = (rows: ClassCount[]) =>
  Object.fromEntries(rows.map((row) => [row._id, row.count]));

const CLASS_GROUP = [
  { $match: { taxClass: { $type: "string", $ne: "" } } },
  { $group: { _id: "$taxClass", count: { $sum: 1 } } },
];

export async function loadTaxUsage(): Promise<TaxUsage> {
  await connectDB();
  const [productCustom, productUntaxed, productClasses, categoryCustom, categoryClasses] =
    await Promise.all([
      Product.countDocuments({ taxRate: { $ne: null }, chargeTax: { $ne: false } }),
      Product.countDocuments({ chargeTax: false }),
      Product.aggregate<ClassCount>(CLASS_GROUP),
      Category.countDocuments({ taxRate: { $ne: null } }),
      Category.aggregate<ClassCount>(CLASS_GROUP),
    ]);
  return {
    products: { customRate: productCustom, untaxed: productUntaxed, byClass: byClass(productClasses) },
    categories: { customRate: categoryCustom, byClass: byClass(categoryClasses) },
  };
}
