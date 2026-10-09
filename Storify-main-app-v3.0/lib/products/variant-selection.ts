/**
 * Whether a product still owes the shopper a choice — and, when it owes none,
 * the variant it is sold as.
 *
 * Three surfaces enforce this and they must agree: the card (which sends the
 * shopper to a chooser instead of adding blind), the quick view and the
 * product page (which keep the buy controls shut until the choice is made).
 * They used to answer it separately — the card by counting variants, the page
 * by looking for options — and the two disagree on a product with several
 * variants and no options: the card would send the shopper off to choose and
 * the page, finding nothing to ask, would quietly add the first variant.
 *
 * Variants are generated from options (`generateAllCombinations`), and a
 * product with no options carries a single placeholder variant standing in for
 * itself, so in real data the two readings coincide. The rule below prefers
 * options and keeps the count as a backstop, which is what decides that
 * disagreement in favour of asking.
 *
 * Deliberately free of model and server imports: the card payload
 * (`PRODUCT_CARD_SELECT` carries `options`), the full product document and the
 * browser all pass through here.
 */

/**
 * All this reads is how many options and variants a product has, so a
 * variant stays whatever its caller says it is — a lean card variant, a full
 * subdocument — and comes back out unchanged.
 */
type VariantSelectionProduct<V> = {
  options?: unknown[] | null;
  variants?: V[] | null;
};

function variantsOf<V>(product: VariantSelectionProduct<V>): V[] {
  return Array.isArray(product.variants) ? product.variants : [];
}

function optionCount(product: VariantSelectionProduct<unknown>) {
  return Array.isArray(product.options) ? product.options.length : 0;
}

/**
 * Must the shopper pick a variant before this product can go in the bag?
 *
 * True for any product that offers options. Also true for one that offers none
 * but carries more than one variant: that is data the storefront has no way to
 * ask about (the importer refuses it — "Product variants require product
 * options" — so it only arrives by hand), and adding one of them on the
 * shopper's behalf would sell a price and an SKU they never saw. Asking and
 * having nothing to show is the visible failure; picking silently is the
 * invisible one.
 */
export function productRequiresVariantSelection<V>(
  product: VariantSelectionProduct<V>,
): boolean {
  const variants = variantsOf(product);
  if (variants.length === 0) return false;
  return optionCount(product) > 0 || variants.length > 1;
}

/**
 * The variant a product that asks nothing is sold as — its single placeholder
 * — or null when there is a choice to make. This is what a card sends as the
 * `variantId`: the cart refuses a product with variants and no variant named,
 * so a simple product still has to name its own.
 */
export function productOnlyVariant<V>(
  product: VariantSelectionProduct<V>,
): V | null {
  if (productRequiresVariantSelection(product)) return null;
  const variants = variantsOf(product);
  return variants.length === 1 ? variants[0] : null;
}
