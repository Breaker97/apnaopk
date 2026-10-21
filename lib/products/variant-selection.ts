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

type DefaultSelectionProduct = {
  options?: Array<{ values?: Array<{ value?: string } | string> | null }> | null;
  /** Any variant; only its `optionValues` are read. */
  variants?: object[] | null;
};

type VariantAnswers = { optionValues?: Array<string | { value?: string } | null> | null };

const answerOf = (value: string | { value?: string } | null | undefined) =>
  (typeof value === "string" ? value : value?.value) ?? "";

/**
 * Where the product page and the quick view start: the product's first
 * variant, every option on its answer, so the price, the stock and the
 * picture are a variant's from the first moment, and changing one option (a
 * colour) shows its variant at once. A first variant that does not answer
 * every option is passed over for the next one that does; with none, every
 * option on its first value. Nothing for a product that asks nothing. One
 * answer per option, in the options' order.
 */
export function defaultOptionValues(product: DefaultSelectionProduct): string[] {
  const options = Array.isArray(product.options) ? product.options : [];
  if (options.length === 0 || !productRequiresVariantSelection(product)) return [];
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const complete = (answers: string[]) =>
    answers.length === options.length && answers.every(Boolean);

  const first = variants
    .map((variant) => ((variant as VariantAnswers).optionValues ?? []).map(answerOf))
    .find(complete);
  if (first) return first;
  const firsts = options.map((option) => answerOf(option.values?.[0]));
  return complete(firsts) ? firsts : [];
}
