/**
 * Which products a Featured Collection row puts on its shelf.
 *
 * One rule, read by both the storefront row
 * (components/store/sections/collection-rows.tsx) and the builder's pick
 * dialog, which previews the slots a merchant left to the collection — so the
 * dialog never promises a product the store then does not show. No imports:
 * the dialog is a client component.
 */

/**
 * How many of the collection's products, in its own order, a row reads: the
 * shelf, the lead held back for the panel, and one more per hand-placed
 * product — each pick may stand where a product of the window would have.
 */
export function collectionShelfWindow(limit: number, picks: number): number {
  return limit + 1 + Math.min(Math.max(picks, 0), limit);
}

/**
 * The shelf for one row.
 *
 * `ordered` is the collection in its own order, at least
 * `collectionShelfWindow` long (or all it has). `picked` is what the merchant
 * placed by hand, in slot order, already narrowed to products the collection
 * still offers.
 *
 * Picks take the first slots as placed; the rest fill from the collection's
 * order. The lead — the collection's first product — is the panel's fallback
 * artwork, so it stays off the automatic slots whenever the collection can
 * fill the shelf without it. A merchant who wants it on the shelf picks it.
 */
export function composeCollectionShelf<T extends { _id: string }>(
  ordered: readonly T[],
  picked: readonly T[],
  limit: number,
): { cards: T[]; lead: T | undefined } {
  const [lead, ...rest] = ordered;
  const pool = rest.length >= limit ? rest : ordered;
  const chosen = picked.slice(0, limit);
  const taken = new Set(chosen.map((product) => product._id));
  const cards = [
    ...chosen,
    ...pool.filter((product) => !taken.has(product._id)),
  ].slice(0, limit);
  return { cards, lead };
}
