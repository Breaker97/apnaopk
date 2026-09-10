/**
 * Server-side sanitizers for product write paths (create + update).
 *
 * Why this exists:
 *   The Mongoose schemas have stricter rules than the Zod request schemas.
 *   For example, `variant.optionValues` is a `[VariantOptionValueSchema]`
 *   array of subdocuments — but the Zod schema accepts both string and
 *   object items for backward compatibility. If a string slips through, the
 *   Mongoose write fails with a confusing CastError ("Cast to embedded
 *   failed for value '' (type Object) at path 'variants'"). We coerce or
 *   drop unsafe shapes here so writes always match what Mongoose expects.
 *
 *   We also strip client-generated `_id` fields (the form can use UUIDs that
 *   can't be cast to ObjectId), preserve real Mongo ObjectIds for existing
 *   variants, and drop empty-string fields that should simply be unset.
 */

import { generateBarcode } from "@/lib/products/codes";
import { detectBarcodeFormat } from "@/lib/barcode/standards";
import { isOptionVisual } from "@/lib/products/option-visual";

type Loose = Record<string, unknown>;

function isPlainObject(v: unknown): v is Loose {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function emptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length === 0;
}

function isObjectIdString(value: unknown): value is string {
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function rememberBarcode(used: Set<string>, value: unknown) {
  if (nonEmptyString(value)) used.add(value.trim());
}

/**
 * Coerce a single optionValue entry to the shape Mongoose expects.
 * Accepts either a structured object or a legacy plain string.
 * Returns null when the entry can't be sensibly coerced.
 */
function coerceOptionValue(raw: unknown): Loose | null {
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) return null;
    // Legacy string — synthesize the missing structural fields. The
    // Mongoose schema requires optionId, valueId, and value as strings.
    // Without IDs we generate stable placeholders so the variant can save;
    // the client can re-link IDs on next edit.
    return {
      optionId: `legacy-${value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      optionName: undefined,
      valueId: `legacy-value-${value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      value,
    };
  }
  if (!isPlainObject(raw)) return null;
  const optionId = typeof raw.optionId === "string" ? raw.optionId : undefined;
  const valueId = typeof raw.valueId === "string" ? raw.valueId : undefined;
  const value = typeof raw.value === "string" ? raw.value.trim() : "";
  if (!value || !optionId || !valueId) return null;
  return {
    optionId,
    optionName:
      typeof raw.optionName === "string" ? raw.optionName : undefined,
    valueId,
    value,
    colorCode:
      typeof raw.colorCode === "string" && /^#[0-9a-f]{6}$/i.test(raw.colorCode)
        ? raw.colorCode
        : undefined,
  };
}

/**
 * `allowedLocationIds` is the set of locations the saving merchant owns.
 *
 * `locationInventory[].locationId` is a bare string with no `ref` and no
 * validation, so without this a crafted payload could park a product's stock in
 * another merchant's warehouse — where it would count toward their location
 * totals and be picked up by their register. Omitting the set keeps the old
 * permissive behaviour, for callers that have no merchant context (imports run
 * by an admin, tests).
 */
function sanitizeLocationInventory(
  raw: unknown,
  allowedLocationIds?: ReadonlySet<string>,
): Loose[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const cleaned: Loose[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const locationId =
      typeof entry.locationId === "string"
        ? entry.locationId
        : entry.locationId
          ? String(entry.locationId)
          : undefined;
    if (!locationId) continue;
    if (allowedLocationIds && !allowedLocationIds.has(locationId)) continue;
    const quantity =
      typeof entry.quantity === "number" && Number.isFinite(entry.quantity)
        ? Math.max(0, entry.quantity)
        : 0;
    cleaned.push({ locationId, quantity });
  }
  return cleaned;
}

export function sanitizePreorderSettings(input: unknown): Loose | undefined {
  if (!isPlainObject(input)) return undefined;
  const enabled = Boolean(input.enabled);
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.max(0, input.limit)
      : 0;
  const reservedQuantity =
    typeof input.reservedQuantity === "number" &&
    Number.isFinite(input.reservedQuantity)
      ? Math.max(0, input.reservedQuantity)
      : 0;
  const message =
    typeof input.message === "string" && input.message.trim()
      ? input.message.trim()
      : undefined;
  const releaseDate =
    input.releaseDate instanceof Date
      ? input.releaseDate
      : typeof input.releaseDate === "string" && input.releaseDate.trim()
        ? new Date(input.releaseDate)
        : undefined;
  const supplierEta =
    input.supplierEta instanceof Date
      ? input.supplierEta
      : typeof input.supplierEta === "string" && input.supplierEta.trim()
        ? new Date(input.supplierEta)
        : undefined;
  const paymentMode =
    input.paymentMode === "deposit" || input.paymentMode === "pay_later"
      ? input.paymentMode
      : "full";
  const depositType = input.depositType === "fixed" ? "fixed" : "percentage";
  const depositValue =
    typeof input.depositValue === "number" && Number.isFinite(input.depositValue)
      ? Math.max(0, input.depositValue)
      : 0;
  const batchName =
    typeof input.batchName === "string" && input.batchName.trim()
      ? input.batchName.trim().slice(0, 120)
      : undefined;

  const cleaned: Loose = {
    enabled,
    limit,
    reservedQuantity,
    preorderOnly: Boolean(input.preorderOnly),
    autoConvert:
      typeof input.autoConvert === "boolean" ? input.autoConvert : true,
    paymentMode,
    depositType,
    depositValue,
  };
  if (message) cleaned.message = message;
  if (batchName) cleaned.batchName = batchName;
  if (releaseDate && !Number.isNaN(releaseDate.getTime())) {
    cleaned.releaseDate = releaseDate;
  }
  if (supplierEta && !Number.isNaN(supplierEta.getTime())) {
    cleaned.supplierEta = supplierEta;
  }
  return cleaned;
}

/**
 * Sanitize a variants array for safe insertion via Mongoose.
 * - Drops non-object entries (defensive: stops Mongoose from receiving "")
 * - Strips client-generated _id fields
 * - Coerces optionValues entries (string → object) and drops invalid ones
 * - Removes empty-string mediaId/barcode (they should be unset, not "")
 * - Normalizes locationInventory shape
 */
export function sanitizeVariantsForMongoose(
  input: unknown,
  allowedLocationIds?: ReadonlySet<string>,
): Loose[] {
  if (!Array.isArray(input)) return [];
  const out: Loose[] = [];
  for (const raw of input) {
    if (!isPlainObject(raw)) continue;
    const variant: Loose = { ...raw };
    if (!isObjectIdString(variant._id)) delete variant._id;

    // Coerce optionValues — this is the main culprit for the cast error.
    if (Array.isArray(variant.optionValues)) {
      const coerced = variant.optionValues
        .map(coerceOptionValue)
        .filter((v): v is Loose => v !== null);
      variant.optionValues = coerced;
    } else {
      variant.optionValues = [];
    }

    // Strip empty-string fields that should be unset.
    if (emptyString(variant.mediaId)) delete variant.mediaId;
    if (emptyString(variant.barcode)) delete variant.barcode;
    if (emptyString(variant.image)) delete variant.image;
    if (emptyString(variant.sku)) delete variant.sku;

    // Normalize locationInventory.
    const li = sanitizeLocationInventory(
      variant.locationInventory,
      allowedLocationIds,
    );
    if (li !== undefined) variant.locationInventory = li;

    const preorder = sanitizePreorderSettings(variant.preorder);
    if (preorder !== undefined) variant.preorder = preorder;

    // Defensive: ensure required numeric fields exist.
    if (typeof variant.price !== "number") variant.price = 0;
    if (typeof variant.stock !== "number") variant.stock = 0;
    if (typeof variant.name !== "string" || !variant.name.trim()) {
      // Synthesize from option values if missing.
      const optionValues = variant.optionValues as Loose[];
      const parts = optionValues
        .map((ov) => (typeof ov.value === "string" ? ov.value : ""))
        .filter((s) => s.trim().length > 0);
      variant.name = parts.length > 0 ? parts.join(" / ") : "Default";
    }

    out.push(variant);
  }
  return out;
}

/**
 * Optional product fields the form clears by sending an explicit `null`.
 *
 * These are the ones with no empty-string representation: emptying the input
 * yields `undefined`, which `JSON.stringify` removes from the request body
 * entirely, so `$set` never mentions them and the stored value survives. The
 * form sends `null` instead and the write paths turn that into a removal.
 */
export const CLEARABLE_PRODUCT_FIELDS = [
  "comparePrice",
  "cost",
  "unitPrice",
  "unitPriceUnit",
  "barcodeFormat",
  "barcodeSource",
  "quoteButtonLabel",
] as const;

/**
 * Pull the explicit nulls out of a product write payload.
 *
 * Mutates `payload` to drop those keys and returns the matching `$unset` paths,
 * so an update removes the field instead of storing `null` (a null `unitPrice`
 * would also not cast cleanly against its nested schema path). On create the
 * returned map is simply ignored — dropping the keys is enough.
 */
export function extractClearedProductFields(
  payload: Loose,
): Record<string, ""> {
  const unset: Record<string, ""> = {};
  for (const field of CLEARABLE_PRODUCT_FIELDS) {
    if (payload[field] === null) {
      delete payload[field];
      unset[field] = "";
    }
  }
  return unset;
}

export function assignMissingProductBarcodes(payload: Loose): Loose {
  const variants = Array.isArray(payload.variants)
    ? (payload.variants as Loose[])
    : [];
  const usedBarcodes = new Set<string>();

  rememberBarcode(usedBarcodes, payload["barcode"]);
  for (const variant of variants) {
    rememberBarcode(usedBarcodes, variant.barcode);
  }

  if (variants.length > 0) {
    for (const variant of variants) {
      if (!nonEmptyString(variant.barcode)) {
        const barcode = generateBarcode(usedBarcodes);
        variant.barcode = barcode;
        variant.barcodeFormat = "ean13";
        variant.barcodeSource = "internal";
        usedBarcodes.add(barcode);
      } else if (!nonEmptyString(variant.barcodeFormat)) {
        variant.barcodeFormat = detectBarcodeFormat(variant.barcode);
      }
    }
  } else if (!nonEmptyString(payload["barcode"])) {
    const barcode = generateBarcode(usedBarcodes);
    payload["barcode"] = barcode;
    payload["barcodeFormat"] = "ean13";
    payload["barcodeSource"] = "internal";
    usedBarcodes.add(barcode);
  } else if (!nonEmptyString(payload["barcodeFormat"])) {
    payload["barcodeFormat"] = detectBarcodeFormat(payload["barcode"]);
  }

  return payload;
}

/**
 * Sanitize a product-level locationInventory array. Keeps only well-formed
 * entries; drops anything missing locationId, or — when `allowedLocationIds` is
 * supplied — pointing at a location the saving merchant does not own.
 */
export function sanitizeProductLocationInventory(
  input: unknown,
  allowedLocationIds?: ReadonlySet<string>,
): Loose[] | undefined {
  return sanitizeLocationInventory(input, allowedLocationIds);
}

/**
 * Sanitize a product-level options array. Keeps the shape Mongoose expects
 * for ProductOptionSchema (string _id, name, position, values[] of {_id, value, colorCode, position}).
 */
export function sanitizeOptionsForMongoose(input: unknown): Loose[] {
  if (!Array.isArray(input)) return [];
  const out: Loose[] = [];
  for (const raw of input) {
    if (!isPlainObject(raw)) continue;
    const _id =
      typeof raw._id === "string" && raw._id.trim() ? raw._id : undefined;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!_id || !name) continue;
    const position =
      typeof raw.position === "number" && Number.isFinite(raw.position)
        ? raw.position
        : 0;
    const values = Array.isArray(raw.values)
      ? raw.values
          .map((v, idx) => {
            if (typeof v === "string") {
              const trimmed = v.trim();
              if (!trimmed) return null;
              return {
                _id: `legacy-${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
                value: trimmed,
                position: idx,
              };
            }
            if (!isPlainObject(v)) return null;
            const vid =
              typeof v._id === "string" && v._id.trim() ? v._id : undefined;
            const value = typeof v.value === "string" ? v.value.trim() : "";
            if (!vid || !value) return null;
            return {
              _id: vid,
              value,
              colorCode:
                typeof v.colorCode === "string" && /^#[0-9a-f]{6}$/i.test(v.colorCode)
                  ? v.colorCode
                  : undefined,
              position:
                typeof v.position === "number" && Number.isFinite(v.position)
                  ? v.position
                  : idx,
            };
          })
          .filter(
            (v): v is {
              _id: string;
              value: string;
              colorCode?: string;
              position: number;
            } => v !== null,
          )
      : [];
    const visual = isOptionVisual(raw.visual) ? raw.visual : undefined;
    out.push({ _id, name, position, values, ...(visual ? { visual } : {}) });
  }
  return out;
}
