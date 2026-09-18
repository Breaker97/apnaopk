import { z } from "zod";
import { mongoose } from "@/lib/db";
import { InventoryLocation, Product } from "@/models";
import { ConflictError } from "@/lib/api/errors";
import { UpdateProductSchema } from "@/lib/validations";

/**
 * Saving a product form must not undo stock that moved while it was open.
 *
 * The form sends every stock number it loaded — each variant's location rows
 * and `stock`, and a simple product's own — and the update route `$set`s them
 * wholesale. A sale, a register sale, or a transfer shipping from a warehouse
 * between loading the form and pressing Save was silently reversed: the units
 * came back on the shelf they had already left.
 *
 * So the form also sends what it loaded (the baseline), and each number is
 * merged three ways: untouched in the form → the database's current value
 * wins; edited in the form while the database still holds the baseline → the
 * edit wins; both moved to different values → a conflict, refused rather than
 * guessed at.
 */

const quantities = z.record(z.string().max(64), z.number());

export const StockBaselineSchema = z.object({
  stock: z.number().optional(),
  locationInventory: quantities.optional(),
  variants: z
    .record(
      z.string().max(64),
      z.object({
        stock: z.number().optional(),
        locationInventory: quantities.optional(),
      }),
    )
    .optional(),
});

export type StockBaseline = z.infer<typeof StockBaselineSchema>;

/** The product update body, plus the baseline the form loaded. */
export const ProductUpdateWithBaselineSchema = UpdateProductSchema.extend({
  stockBaseline: StockBaselineSchema.optional(),
});

type Row = { locationId: string; quantity: number };

type StockHolder = {
  stock?: number;
  locationInventory?: Row[];
};

type VariantHolder = StockHolder & { _id?: unknown; name?: string };

export class StockMergeConflict extends Error {
  constructor(
    public readonly label: string,
    public readonly locationId: string | null,
    public readonly current: number,
  ) {
    super("Stock changed while the product was being edited");
    this.name = "StockMergeConflict";
  }
}

/**
 * One number, three ways. `null` means the form and the database both moved it
 * to different values.
 */
export function mergeQuantity(
  submitted: number,
  baseline: number,
  current: number,
): number | null {
  if (submitted === baseline) return current;
  if (current === baseline || current === submitted) return submitted;
  return null;
}

function toMap(rows: Row[] | undefined) {
  return new Map(
    (rows || []).map((row) => [String(row.locationId), Number(row.quantity) || 0]),
  );
}

/**
 * Merge one holder's location rows. Rows the form never had (a transfer landed
 * units at a new location while the form was open) are kept; rows the form
 * dropped are dropped only if the database still holds what the form loaded.
 */
export function mergeLocationRows(
  submitted: Row[],
  baseline: Record<string, number> | undefined,
  current: Row[] | undefined,
  label: string,
): Row[] {
  const base = baseline || {};
  const cur = toMap(current);
  const merged: Row[] = [];
  const seen = new Set<string>();

  for (const row of submitted) {
    const locationId = String(row.locationId);
    seen.add(locationId);
    const sub = Number(row.quantity) || 0;
    const had = Object.prototype.hasOwnProperty.call(base, locationId);

    // Removed from the database since the form loaded (its location was
    // deleted) and not edited here: leave it gone.
    if (!cur.has(locationId) && had && sub === base[locationId]) continue;

    // A row the form seeded (not in the baseline) stands for "nothing here".
    const value = mergeQuantity(
      sub,
      had ? base[locationId] : 0,
      cur.get(locationId) ?? 0,
    );
    if (value === null) {
      throw new StockMergeConflict(label, locationId, cur.get(locationId) ?? 0);
    }
    merged.push({ ...row, locationId, quantity: value });
  }

  for (const [locationId, quantity] of cur) {
    if (seen.has(locationId)) continue;
    const had = Object.prototype.hasOwnProperty.call(base, locationId);
    // Dropped in the form: honoured only while nothing else changed it.
    if (had && base[locationId] === quantity) continue;
    merged.push({ locationId, quantity });
  }

  return merged;
}

function isValidId(value: unknown): boolean {
  return value != null && mongoose.isValidObjectId(String(value));
}

/**
 * Merge a submitted product's stock with the database's, given what the form
 * loaded. Pure: `submitted` is not modified; the merged fields are returned.
 */
export function mergeProductStock(params: {
  submitted: {
    stock?: number;
    locationInventory?: Row[];
    variants?: VariantHolder[];
  };
  baseline: StockBaseline;
  current: StockHolder & { name?: string; title?: string; variants?: VariantHolder[] };
}): { stock?: number; locationInventory?: Row[]; variants?: VariantHolder[] } {
  const { submitted, baseline, current } = params;
  const productLabel = current.title || current.name || "This product";
  const result: { stock?: number; locationInventory?: Row[]; variants?: VariantHolder[] } = {};

  if (Array.isArray(submitted.variants)) {
    const currentById = new Map(
      (current.variants || []).map((variant) => [String(variant._id), variant]),
    );
    result.variants = submitted.variants.map((variant) => {
      const id = isValidId(variant._id) ? String(variant._id) : "";
      const base = id ? baseline.variants?.[id] : undefined;
      const now = id ? currentById.get(id) : undefined;
      // A variant added in the form, or one the form never loaded: as sent.
      if (!base || !now) return variant;

      const label = `${productLabel} (${variant.name || now.name || "variant"})`;
      const rows = mergeLocationRows(
        Array.isArray(variant.locationInventory) ? variant.locationInventory : [],
        base.locationInventory,
        now.locationInventory,
        label,
      );
      const next: VariantHolder = { ...variant, locationInventory: rows };

      // `stock` only stands alone for a variant without location rows; with
      // rows, the aggregate sync derives it from them.
      if (rows.length === 0 && typeof base.stock === "number") {
        const value = mergeQuantity(
          Number(variant.stock) || 0,
          base.stock,
          Number(now.stock) || 0,
        );
        if (value === null) {
          throw new StockMergeConflict(label, null, Number(now.stock) || 0);
        }
        next.stock = value;
      }
      return next;
    });
  }

  const hasVariants = (result.variants || submitted.variants || []).length > 0;
  if (!hasVariants) {
    let rows: Row[] | undefined;
    if (Array.isArray(submitted.locationInventory)) {
      rows = mergeLocationRows(
        submitted.locationInventory,
        baseline.locationInventory,
        current.locationInventory,
        productLabel,
      );
      result.locationInventory = rows;
    }
    const rowCount = rows?.length ?? (current.locationInventory || []).length;
    if (
      rowCount === 0 &&
      typeof submitted.stock === "number" &&
      typeof baseline.stock === "number"
    ) {
      const value = mergeQuantity(
        submitted.stock,
        baseline.stock,
        Number(current.stock) || 0,
      );
      if (value === null) {
        throw new StockMergeConflict(productLabel, null, Number(current.stock) || 0);
      }
      result.stock = value;
    }
  }

  return result;
}

/**
 * Apply the baseline merge to an update about to be written, against the
 * product as it stands now. Returns the `updatedAt` it merged against, for the
 * caller to pin the write to — so a movement landing between this read and the
 * write makes the write miss and the merge run again, instead of being lost.
 *
 * `submitted` is the sanitized stock the form sent, kept apart from `updateSet`
 * so a retry merges from the form's numbers, not from the previous attempt.
 */
export async function applyStockBaseline(params: {
  filter: Record<string, unknown>;
  updateSet: Record<string, unknown>;
  submitted: { stock?: number; locationInventory?: Row[]; variants?: VariantHolder[] };
  baseline: StockBaseline | undefined;
}): Promise<{ updatedAt: Date } | null> {
  const { filter, updateSet, submitted, baseline } = params;
  if (!baseline) return null;
  if (!("variants" in updateSet || "locationInventory" in updateSet || "stock" in updateSet)) {
    return null;
  }

  const current = await Product.findOne(filter)
    .select(
      "title name stock locationInventory variants._id variants.name variants.stock variants.locationInventory updatedAt",
    )
    .lean<(StockHolder & { title?: string; name?: string; variants?: VariantHolder[]; updatedAt?: Date }) | null>();
  if (!current?.updatedAt) return null;

  let merged: ReturnType<typeof mergeProductStock>;
  try {
    merged = mergeProductStock({ submitted, baseline, current });
  } catch (error) {
    if (!(error instanceof StockMergeConflict)) throw error;
    const location = error.locationId
      ? await InventoryLocation.findById(error.locationId)
          .select("name")
          .lean<{ name?: string } | null>()
          .catch(() => null)
      : null;
    throw new ConflictError(
      `Stock for ${error.label}${location?.name ? ` at ${location.name}` : ""} changed to ${error.current} while you were editing. Reload the product to see the latest stock, then make your change again.`,
    );
  }

  if ("variants" in updateSet && merged.variants) updateSet.variants = merged.variants;
  if ("locationInventory" in updateSet && merged.locationInventory) {
    updateSet.locationInventory = merged.locationInventory;
  }
  if ("stock" in updateSet && typeof merged.stock === "number") {
    updateSet.stock = merged.stock;
  }
  return { updatedAt: current.updatedAt };
}
