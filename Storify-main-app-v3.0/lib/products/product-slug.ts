import { Product } from "@/models";
import { escapeRegExp, slugify } from "@/lib/strings";

/**
 * The slug a product's URL starts from: its handle, else its title, else its
 * SKU, else its id. Never empty — `slugify` keeps only `a-z0-9`, so a title in
 * a script it drops (বাংলা, العربية, 中文) slugifies to "" and the product could
 * not be saved at all.
 */
export function productSlugBase(input: {
  handle?: string | null;
  title?: string | null;
  sku?: string | null;
  productId: unknown;
}): string {
  return (
    slugify(input.handle || "") ||
    slugify(input.title || "") ||
    slugify(input.sku || "") ||
    `product-${String(input.productId).slice(-8)}`
  );
}

/**
 * A slug no other product uses — checked across every vendor, not just this
 * one: the storefront finds a product by slug alone, so two vendors sharing
 * one would leave one of the products unreachable.
 */
export async function uniqueProductSlug(
  base: string,
  excludeId?: unknown,
): Promise<string> {
  const taken = await Product.find({
    slug: { $regex: `^${escapeRegExp(base)}(-\\d+)?$` },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select("slug")
    .lean<{ slug?: string }[]>();
  const used = new Set(taken.map((product) => product.slug));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}
