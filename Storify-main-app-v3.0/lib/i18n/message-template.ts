/**
 * Any next-intl translator, namespaced or not. `never` keys let every
 * namespace's translator be passed without the caller casting.
 */
type Translator = ((key: never, values?: never) => string) & {
  has: (key: never) => boolean;
};

/**
 * A translation as a template, for a component that fills in its own
 * `{placeholders}` — "Sold by {seller}" split around the seller's link, a
 * WhatsApp greeting that names the product. The message is formatted with
 * every placeholder its English fallback names given back as itself.
 *
 * `t.raw` did this job while messages shipped as the text they were written
 * as. They are compiled at build time now (next.config.ts), and a compiled
 * message is no longer that text.
 */
export function messageTemplate(
  t: Translator,
  key: string,
  fallback: string,
): string {
  if (!t.has(key as never)) return fallback;
  const placeholders = Object.fromEntries(
    [...fallback.matchAll(/\{(\w+)\}/g)].map(([token, name]) => [name, token]),
  );
  return t(key as never, placeholders as never);
}
