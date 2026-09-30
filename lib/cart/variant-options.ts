/**
 * What a cart line says about the variant it is for — "Color: White",
 * "Size: M".
 *
 * A cart stores only `variantName`, the flat label the model builds from the
 * option values ("White / M"). That string is enough to tell two lines apart
 * but not to caption them: it has lost which part is the colour and which is
 * the size, and every surface that wanted captions was left guessing. The cart
 * page guessed by keyword, so it could only ever show Color and Size, and the
 * checkout summary — which has no such guesser — showed nothing at all.
 *
 * So the pairs are resolved from the product itself, the way seller identity
 * is (see `cartProductFacts`): the option names on screen are the ones on
 * the store today, not the ones captured whenever the line was added.
 *
 * Deliberately free of `server-only` and of any model import — the resolver
 * runs on the cart endpoints, the formatter runs in the browser, and both are
 * plain functions over the shapes they are handed.
 */

/** One option of a variant: the option's name and the value chosen for it. */
export type CartVariantOption = { name: string; value: string };

/** A variant's `optionValues` entry. Legacy documents store a bare string. */
type VariantOptionValueLike =
  | string
  | { optionName?: string | null; value?: string | null }
  | null
  | undefined;

type VariantLike = {
  name?: string | null;
  optionValues?: VariantOptionValueLike[] | null;
};

/** `product.options`, in the order the product declares them. */
type ProductOptionsLike = Array<{ name?: string | null } | null> | null | undefined;

/**
 * The single-variant placeholder a product gets when it has no real options.
 * It names nothing the shopper chose, so it is never shown.
 */
const PLACEHOLDER_VARIANT_NAME = "default title";

/** How a flat variant label joins its values: "White / M", "White, M". */
const VARIANT_LABEL_SEPARATOR = /\s*(?:\/|,|\||;)\s*/;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Pair a flat label ("White / M") back up with the product's option names, by
 * position — the same order `generateAllCombinations` builds the values in.
 * Only for variants written before `optionValues` carried `optionName`; a
 * value whose option can't be named is still worth showing on its own.
 */
function splitVariantLabel(
  label: string,
  options: ProductOptionsLike,
): CartVariantOption[] {
  if (!label || label.toLowerCase() === PLACEHOLDER_VARIANT_NAME) return [];

  return label
    .split(VARIANT_LABEL_SEPARATOR)
    .map((part, index) => ({
      name: clean(options?.[index]?.name),
      value: clean(part),
    }))
    .filter((entry) => entry.value);
}

/**
 * The name/value pairs for one variant of one product.
 *
 * `optionValues` carries its own `optionName`, so the product's option list is
 * only consulted for the two shapes that don't: a legacy string value, and a
 * variant that predates structured option values altogether.
 */
export function resolveVariantOptions(
  variant: VariantLike | null | undefined,
  productOptions?: ProductOptionsLike,
): CartVariantOption[] {
  if (!variant) return [];

  const values = Array.isArray(variant.optionValues) ? variant.optionValues : [];
  const resolved = values
    .map((optionValue, index) => {
      const fallbackName = clean(productOptions?.[index]?.name);
      if (typeof optionValue === "string") {
        return { name: fallbackName, value: clean(optionValue) };
      }
      return {
        name: clean(optionValue?.optionName) || fallbackName,
        value: clean(optionValue?.value),
      };
    })
    .filter((entry) => entry.value);

  if (resolved.length > 0) return resolved;

  return splitVariantLabel(clean(variant.name), productOptions);
}

/**
 * One display line per option, for a cart line: `["Color: White", "Size: M"]`.
 *
 * `variantOptions` is attached by the cart's read endpoints and is what the
 * captions come from. The stored label is the fallback, for a response that
 * predates them — uncaptioned, because that string is all it ever knew.
 *
 * A line's `name` is deliberately not mined for a variant: a cart stores the
 * product's name there and nothing else, so the old "everything after ' - '"
 * rule read a variant out of any product whose name simply contains a dash
 * ("iPad Air M4 - 2026" → "2026").
 */
export function formatVariantOptionLines(item: {
  variantOptions?: CartVariantOption[] | null;
  variantName?: string | null;
}): string[] {
  const options = Array.isArray(item.variantOptions) ? item.variantOptions : [];
  const pairs =
    options.length > 0
      ? options
      : splitVariantLabel(clean(item.variantName), undefined);

  return pairs
    .map((pair) => {
      const value = clean(pair?.value);
      if (!value) return "";
      const name = clean(pair?.name);
      return name ? `${name}: ${value}` : value;
    })
    .filter(Boolean);
}
