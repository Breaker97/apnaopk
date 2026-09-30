/**
 * Reading a money total in ONE currency.
 *
 * Summing across currencies produces a number denominated in nothing, and
 * every screen that did it then printed the result with the store's own
 * symbol — so a shop that took one order in rupees reported those rupees as
 * dollars. `lib/finance/reports.ts` exists in large part to avoid exactly
 * that, and says so in its header; the dashboard, the analytics page and the
 * payments overview each had to answer it separately and two of them did not.
 *
 * So the rule lives here, once, in the two shapes a caller needs: a `$match`
 * filter for a pipeline that reads only this currency's documents, and an
 * expression for one that has to keep counting every document while adding up
 * only this currency's money.
 *
 * **Rows carrying no currency count as the store's.** That is not a guess made
 * here — it is the rule the ledger already applies (see `loadPostingOrder`,
 * which fills the store default in and stamps the entry as assumed), and a
 * screen that excluded them instead would disagree with Finance about the same
 * orders. Most of a long-lived store's history predates the currency snapshot.
 *
 * Deliberately free of imports: both a query builder and an aggregation
 * expression need it, and it is asserted in tests without a database.
 */

/** Every spelling of "this is the store's own money". */
function storeCurrencyValues(storeCurrency: string): string[] {
  const upper = String(storeCurrency || "USD").trim().toUpperCase();
  // Stored case has never been enforced on orders, so both are matched.
  return upper === upper.toLowerCase() ? [upper] : [upper, upper.toLowerCase()];
}

/**
 * A `$match` arm selecting documents held in the store's own currency.
 *
 * Owns the `$or` key of whatever filter it is spread into — a caller that
 * needs its own `$or` must combine both under `$and` rather than let one
 * overwrite the other.
 */
export function inStoreCurrencyMatch(
  storeCurrency: string,
): Record<string, unknown> {
  return {
    $or: [
      { currency: { $in: storeCurrencyValues(storeCurrency) } },
      { currency: { $exists: false } },
      { currency: null },
      { currency: "" },
    ],
  };
}

/**
 * `filter`, narrowed to the store's own currency.
 *
 * Combined under `$and` rather than spread, because the filters this is used
 * with carry their own `$or` — `COLLECTED_ORDER_MATCH` is one — and spreading
 * would silently replace it, widening the match to every order instead of
 * narrowing it to one currency. A mistake that reads as a bigger number, which
 * is the direction nobody checks.
 */
export function narrowedToStoreCurrency(
  filter: Record<string, unknown>,
  storeCurrency: string,
): Record<string, unknown> {
  return { $and: [filter, inStoreCurrencyMatch(storeCurrency)] };
}

/**
 * The same rule as an aggregation expression, for a pipeline that must not
 * drop the document.
 *
 * An order count is a count whatever the order was priced in; only the money
 * columns are denominated. Wrapping the sums in this — rather than filtering
 * the pipeline — is what lets one scan answer both questions, which is how the
 * dashboard's single pass over the orders collection already works.
 */
export function inStoreCurrencyExpr(
  storeCurrency: string,
): Record<string, unknown> {
  return {
    $or: [
      { $in: [{ $ifNull: ["$currency", ""] }, ["", ...storeCurrencyValues(storeCurrency)]] },
    ],
  };
}
