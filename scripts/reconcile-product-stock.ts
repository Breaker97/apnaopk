/**
 * Realign `stock` with the per-location quantities underneath it.
 *
 * A product carries the same number three times — the `locationInventory` rows,
 * `variant.stock`, and the product's own `stock` — and each is derived from the
 * one below. They fell out of step because `buildProductAggregateUpdate` (the
 * only thing keeping them aligned on the `findOneAndUpdate` path the product
 * PUT uses) summed `variant.stock` while ignoring the location rows beneath it.
 * That is fixed; this repairs what drifted before it was.
 *
 * Why it matters even though nothing looks wrong today: the next ordinary
 * product save recomputes `stock` from the rows, so the difference appears all
 * at once as stock a merchant never added. Doing it here, deliberately and with
 * a printed before/after, is the difference between a reconcile and a mystery.
 *
 * WHICH NUMBER IS RIGHT IS NOT KNOWABLE FROM THE DATA, so this script refuses
 * to guess. A product whose locations sum higher than its `stock` was sold from
 * before it tracked locations: the sale lowered `stock` alone, and whoever
 * later typed the location counts may have counted the shelf before those sales
 * or after. Only the merchant knows which.
 *
 *   --source=locations   the counted shelf is right; raise `stock` to match.
 *                        Risks re-selling units that already shipped.
 *   --source=stock       the running total is right; lower the rows to match.
 *                        Risks understating what is actually on the shelf.
 *
 * `--source=stock` is the safer default choice for a live store, because
 * overselling takes money for goods that are not there. Neither is applied
 * without being named, and the direction is honoured for simple products and
 * variant products alike.
 *
 * When the rows are what move, they are rescaled in proportion to what they
 * already hold (see `distribute`) — never below zero, and never by dumping the
 * whole difference onto one branch. Every row that changes is printed, so a dry
 * run shows the actual writes rather than just the per-variant total.
 *
 * A SIMPLE product that tracks no locations is left completely alone — there is
 * no second number to reconcile its `stock` against. A variant product is always
 * checked: its `stock` is Σ(variant.stock) whether locations are in use or not,
 * and only the variant rows underneath it are a direction question.
 *
 * Separately, and under both directions, a product that has variants gets its
 * PRODUCT-level location rows cleared. Nothing reads them once variants exist
 * (see `ghostLocationRows`), and leaving them is how a later variant deletion
 * resurrects units nobody counted. The discarded figure is printed per row.
 *
 * Usage:
 *   pnpm db:migrate reconcile-stock --dry-run -- --source=stock
 *   pnpm db:migrate reconcile-stock -- --source=stock
 */

import { basename } from "node:path";

import { connectDB, disconnectDB, mongoose } from "@/lib/db";

const LOG = "[reconcile-stock]";
const dryRun = process.argv.includes("--dry-run");
const source = process.argv
  .find((arg) => arg.startsWith("--source="))
  ?.split("=")[1];

function requireDirection(): "locations" | "stock" {
  if (source !== "locations" && source !== "stock") {
    console.error(
      `${LOG} Refusing to run without a direction. Pass --source=locations ` +
        `(the counted shelf wins) or --source=stock (the running total wins). ` +
        `See the header comment — the data cannot tell you which is right.`,
    );
    process.exit(1);
  }
  return source;
}

type Row = { locationId?: string | null; quantity?: number | null };
type Variant = {
  _id?: unknown;
  name?: string;
  stock?: number | null;
  locationInventory?: Row[] | null;
};
type ProductDoc = {
  _id: unknown;
  name?: string;
  stock?: number | null;
  locationInventory?: Row[] | null;
  variants?: Variant[];
};

/**
 * The stock a location array accounts for, or `null` when it does not account
 * for any — no rows, or rows that are all zero while stock says otherwise.
 *
 * That second case is the important one here. The product editor seeds an
 * explicit zero row for every known location, so "all zero" usually means the
 * merchant never distributed the count, not that the shelf is empty. Reading it
 * literally would delete real sellable stock. Mirrors `locationTotal` in
 * models/product.model.ts — the two must agree or the reconcile would undo
 * itself on the next save.
 */
function total(
  rows: Row[] | null | undefined,
  currentStock?: number | null,
): number | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const sum = rows.reduce((acc, row) => acc + (row.quantity || 0), 0);
  if (sum === 0 && (currentStock || 0) > 0) return null;

  return sum;
}

/**
 * Spread `target` across the rows in proportion to what they already hold.
 *
 * The earlier version folded the whole difference onto row 0, which keeps the
 * sum right but drives that row negative whenever the rows below it hold more
 * than `target` — rows `[0, 50]` against a stock of 10 wrote `[-40, 50]`, and
 * `locationInventory.quantity` has no `min: 0` to catch it (deliberately, see
 * models/product.model.ts: online sales draw a location slightly negative). A
 * reconcile writing -40 onto a branch is not that, it is just wrong.
 *
 * Proportional is also the most defensible guess. Which row lost the units is
 * unknowable — the same reason the script refuses to pick a direction for you —
 * so the least it can do is preserve the shape the merchant did choose.
 *
 * Integer-exact: floor everything, then hand the shortfall to the rows that
 * lost the most to flooring, so the result sums to `target` exactly.
 */
export function distribute(current: number[], target: number): number[] {
  // A negative row is real (an oversell), but it cannot carry weight in a
  // proportion without flipping the sign of its share.
  const weights = current.map((quantity) => Math.max(0, quantity));
  const totalWeight = weights.reduce((acc, weight) => acc + weight, 0);

  // Nothing to scale against, or nothing left to spread: one row carries the
  // figure rather than inventing a split across empty branches.
  if (totalWeight <= 0 || target <= 0) {
    const next = current.map(() => 0);
    next[0] = target;
    return next;
  }

  const exact = weights.map((weight) => (weight * target) / totalWeight);
  const next = exact.map((value) => Math.floor(value));

  let shortfall = target - next.reduce((acc, quantity) => acc + quantity, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (let i = 0; shortfall > 0; i += 1, shortfall -= 1) {
    next[byRemainder[i % byRemainder.length].index] += 1;
  }

  return next;
}

/**
 * Product-level location rows on a product that has variants.
 *
 * For a variant product the stock lives one level down — `pre("validate")`
 * recomputes `stock` as Σ(variant.stock) and never looks at these rows, the
 * register reads the variants (lib/pos/product-stock.ts), and the inventory
 * list emits one row per variant off `variantRow.locationInventory`. So nothing
 * reads them: they are what a product recorded back when it had no variants,
 * left behind when variants were added.
 *
 * Harmless right up until it isn't. Delete the variants one day and the `else`
 * branch of that same hook starts reading these rows as the source of truth,
 * resurrecting units nobody has counted in months as if a delivery had arrived.
 *
 * Which variant the old count belonged to is not knowable — splitting it across
 * them would invent a distribution nobody stated, the same reason `distribute`
 * refuses to invent a split across empty branches. So the rows are cleared and
 * the number is printed, for a merchant to re-enter where it actually belongs.
 *
 * Unlike the drift above this is not a direction question — the rows are unread
 * either way — so it happens under both `--source` values.
 */
export function ghostLocationRows(product: {
  variants?: Variant[] | null;
  locationInventory?: Row[] | null;
}): Row[] {
  if (!Array.isArray(product.variants) || product.variants.length === 0) {
    return [];
  }
  const rows = product.locationInventory;
  return Array.isArray(rows) && rows.length > 0 ? rows : [];
}

/** Short enough to scan in a report, long enough to grep for. */
function shortId(value: string | null | undefined): string {
  const id = String(value ?? "");
  return id.length > 8 ? `${id.slice(0, 8)}…` : id || "(no id)";
}

/**
 * Rewrite `rows` to sum to `target`, appending one note per row that moves.
 *
 * The per-row lines are the reason this is a function: without them a dry run
 * printed only `locations 50 -> 10` and the caller could not see that a branch
 * was about to be driven negative.
 */
function rebalance(
  rows: Row[],
  target: number,
  pathPrefix: string,
  set: Record<string, number | Row[]>,
  notes: string[],
): void {
  const current = rows.map((row) => Number(row.quantity) || 0);
  const next = distribute(current, target);

  next.forEach((quantity, index) => {
    if (quantity === current[index]) return;
    set[`${pathPrefix}.${index}.quantity`] = quantity;
    notes.push(
      `      ${shortId(rows[index]?.locationId)} ${current[index]} -> ${quantity}`,
    );
  });
}

async function run() {
  requireDirection();

  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB database connection is unavailable");

  console.log(`${LOG} database: ${db.databaseName}`);

  const products = db.collection<ProductDoc>("products");
  const cursor = products.find({
    $or: [
      // Every variant product, locations or not. `stock` is Σ(variant.stock)
      // for these whether or not any location is in use, so the update path can
      // leave it stale on its own — a variant sold down to 0 against a product
      // still reading 1, which the register (summing variants) and the
      // storefront (reading `stock`) then disagree about. Scoping this scan to
      // location-tracking products left exactly that class unrepaired.
      { "variants.0": { $exists: true } },
      // Simple products only qualify through their rows: with none there is no
      // second number to reconcile `stock` against, and nothing to do.
      { "locationInventory.0": { $exists: true } },
    ],
  });

  let scanned = 0;
  let drifted = 0;
  let unitsBefore = 0;
  let unitsAfter = 0;

  for await (const product of cursor) {
    scanned += 1;
    const variants = product.variants ?? [];
    const set: Record<string, number | Row[]> = {};
    const notes: string[] = [];

    if (variants.length > 0) {
      const ghost = ghostLocationRows(product);
      if (ghost.length > 0) {
        const stranded = ghost.reduce((acc, row) => acc + (row.quantity || 0), 0);
        set.locationInventory = [];
        notes.push(
          `    product-level rows cleared — ${stranded} unit(s) no code path reads` +
            ` (this product has variants; re-enter them per variant if real)`,
        );
        for (const row of ghost) {
          notes.push(`      ${shortId(row.locationId)} ${row.quantity || 0} -> (removed)`);
        }
      }

      let sum = 0;
      variants.forEach((variant, index) => {
        const fromLocations = total(variant.locationInventory, variant.stock);
        const derived =
          source === "stock"
            ? (variant.stock ?? 0)
            : (fromLocations ?? variant.stock ?? 0);

        // With `stock` winning, the rows are what move.
        if (source === "stock" && fromLocations !== null && fromLocations !== derived) {
          notes.push(
            `    variant "${variant.name ?? index}" locations ${fromLocations} -> ${derived}`,
          );
          rebalance(
            variant.locationInventory ?? [],
            derived,
            `variants.${index}.locationInventory`,
            set,
            notes,
          );
        }
        sum += derived;
        if (derived !== (variant.stock ?? 0)) {
          set[`variants.${index}.stock`] = derived;
          set[`variants.${index}.inventory.quantity`] = derived;
          notes.push(
            `    variant "${variant.name ?? index}" ${variant.stock ?? 0} -> ${derived}`,
          );
        }
      });
      if (sum !== (product.stock ?? 0)) {
        set.stock = sum;
        notes.push(`    stock ${product.stock ?? 0} -> ${sum}`);
      }
    } else {
      const fromLocations = total(product.locationInventory, product.stock);
      // No rows means this product does not track locations; leave it alone.
      if (fromLocations !== null) {
        const current = product.stock ?? 0;

        // This branch used to read the locations as truth whichever direction
        // was asked for, so `--source=stock` raised `stock` on a simple product
        // — precisely the oversell the flag exists to avoid. It now honours the
        // direction the caller named, same as the variant branch above.
        if (source === "stock") {
          if (fromLocations !== current) {
            notes.push(`    locations ${fromLocations} -> ${current}`);
            rebalance(
              product.locationInventory ?? [],
              current,
              "locationInventory",
              set,
              notes,
            );
          }
        } else if (fromLocations !== current) {
          set.stock = fromLocations;
          notes.push(`    stock ${current} -> ${fromLocations}`);
        }
      }
    }

    if (notes.length === 0) continue;

    drifted += 1;
    unitsBefore += product.stock ?? 0;
    // Only `stock` feeds the units tally, and only ever as a number — clearing
    // the ghost rows writes an array under `locationInventory`, which moves no
    // sellable unit and must not be added to the total.
    unitsAfter +=
      typeof set.stock === "number" ? set.stock : (product.stock ?? 0);

    console.log(`${LOG}   ${product.name ?? String(product._id)}`);
    for (const note of notes) console.log(`${LOG} ${note}`);

    if (!dryRun) {
      await products.updateOne({ _id: product._id }, { $set: set });
    }
  }

  console.log(
    `${LOG} Scanned ${scanned} product(s) with a derived stock; ${drifted} had drifted.`,
  );
  console.log(
    `${LOG} Total stock across them: ${unitsBefore} -> ${unitsAfter} ` +
      `(${unitsAfter - unitsBefore >= 0 ? "+" : ""}${unitsAfter - unitsBefore}).`,
  );
  console.log(
    dryRun
      ? `${LOG} Dry run complete — nothing was written.`
      : `${LOG} Reconcile complete.`,
  );
}

// Only when invoked as the migration. `distribute` decides how production stock
// is rewritten, so tests import it directly — and importing must not connect to
// a database or exit the process over a missing --source.
if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  run()
    .catch((error) => {
      console.error(`${LOG} Failed:`, error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectDB();
    });
}
