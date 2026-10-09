import { randomUUID } from "node:crypto";
import {
  ProductVariantGeneration,
  type ProductEditorFields,
  type ProductOption,
  type ProductStockBaseline,
  type ProductVariantGenerateRequest,
} from "@/contracts/mobile/biz/v1/product-editor";
import { MobileApiError } from "@/lib/api-core/errors";
import { mongoose } from "@/lib/db";
import { sanitizeHtml } from "@/lib/sanitize";
import {
  sanitizeOptionsForMongoose,
  sanitizePreorderSettings,
  sanitizeVariantsForMongoose,
} from "./sanitize";
import { keepUnwritableRows } from "./stock-baseline";

export type EditorDocument = Record<string, any>; // Internal Mongoose document, never an API answer.

export function editorRefusal(
  reason: string,
  message: string,
  field?: string,
): never {
  throw new MobileApiError(400, "VALIDATION_ERROR", message, {
    reason,
    ...(field ? { errors: { [field]: [message] } } : {}),
  });
}

function normalizeEditorOptions(options: ProductOption[]) {
  if (options.length > 5)
    editorRefusal(
      "PRODUCT_FIELD_NOT_ALLOWED",
      "A product can have at most five options.",
      "options",
    );
  const names = new Set<string>();
  const ids = new Set<string>();
  return sanitizeOptionsForMongoose(
    options.map((option, position) => {
      const name = option.name.trim();
      const id = option.id || randomUUID();
      if (names.has(name.toLowerCase()) || ids.has(id))
        editorRefusal(
          "PRODUCT_FIELD_NOT_ALLOWED",
          "Option names and IDs must be unique.",
          "options",
        );
      names.add(name.toLowerCase());
      ids.add(id);
      const values = new Set<string>();
      const valueIds = new Set<string>();
      return {
        ...option,
        _id: id,
        position,
        values: option.values.map((value, index) => {
          const text = value.value.trim();
          const valueId = value.id || randomUUID();
          if (values.has(text.toLowerCase()) || valueIds.has(valueId))
            editorRefusal(
              "PRODUCT_FIELD_NOT_ALLOWED",
              "Option values and IDs must be unique.",
              "options",
            );
          values.add(text.toLowerCase());
          valueIds.add(valueId);
          return { ...value, _id: valueId, value: text, position: index };
        }),
      };
    }),
  );
}

function assertRows(
  rows: EditorDocument[] | undefined,
  allowed: ReadonlySet<string>,
  field: string,
) {
  const seen = new Set<string>();
  for (const row of rows || []) {
    if (!allowed.has(row.locationId) || seen.has(row.locationId))
      editorRefusal(
        "PRODUCT_FIELD_NOT_ALLOWED",
        "Select an authorized location once per inventory row.",
        field,
      );
    seen.add(row.locationId);
  }
}

/** Stock figures on existing holders may only round-trip a baseline; M05 owns adjustments. */
function preserveStock(
  next: EditorDocument,
  current: EditorDocument,
  base: ProductStockBaseline | undefined,
  allowed: ReadonlySet<string>,
  variantId?: string,
) {
  const baseline = variantId ? base?.variants?.[variantId] : base;
  if (
    next.stock !== undefined &&
    (baseline?.stock === undefined || next.stock !== baseline.stock)
  )
    editorRefusal(
      "STOCK_CHANGED",
      "Adjust existing units through the stock action.",
      "stock",
    );
  if (next.locationInventory !== undefined) {
    if (!baseline?.locationInventory)
      editorRefusal(
        "STOCK_CHANGED",
        "Reload the stock baseline before saving inventory rows.",
        "locationInventory",
      );
    const wanted = new Map<string, number>(
      (next.locationInventory as EditorDocument[]).map((row) => [
        row.locationId,
        row.quantity,
      ]),
    );
    for (const row of next.locationInventory) {
      if (baseline.locationInventory[row.locationId] !== row.quantity)
        editorRefusal(
          "STOCK_CHANGED",
          "Adjust existing units through the stock action.",
          "locationInventory",
        );
    }
    for (const [id, quantity] of Object.entries(baseline.locationInventory)) {
      if (allowed.has(id) && quantity !== 0 && !wanted.has(id))
        editorRefusal(
          "STOCK_CHANGED",
          "A save cannot remove existing stock.",
          "locationInventory",
        );
    }
  }
  next.stock = current.stock;
  next.locationInventory = current.locationInventory || [];
  // Policy changes must not reset counters which only reservation operations own.
  if (next.preorder)
    next.preorder.reservedQuantity = current.preorder?.reservedQuantity || 0;
}

export function normalizeEditorChanges(input: {
  changes: Partial<ProductEditorFields>;
  before?: EditorDocument;
  baseline?: ProductStockBaseline;
  locations: ReadonlySet<string>;
}): EditorDocument {
  const { changes, before, baseline, locations } = input;
  const next: EditorDocument = { ...changes };
  if ("description" in next) next.description = sanitizeHtml(next.description);
  if ("shortDescription" in next)
    next.shortDescription = sanitizeHtml(next.shortDescription);
  const title = changes.title?.trim() || changes.name?.trim();
  if (title) {
    next.title = title;
    next.name = title;
  }
  if (changes.options) next.options = normalizeEditorOptions(changes.options);
  if (changes.preorder) {
    next.preorder = sanitizePreorderSettings(changes.preorder);
    if (before)
      next.preorder.reservedQuantity = before.preorder?.reservedQuantity || 0;
  }
  assertRows(changes.locationInventory, locations, "locationInventory");
  if (before) {
    if ("stock" in next || "locationInventory" in next)
      preserveStock(next, before, baseline, locations);
  } else if (
    (changes.stock ?? 0) < 0 ||
    changes.locationInventory?.some((row) => row.quantity < 0)
  ) {
    editorRefusal(
      "STOCK_CHANGED",
      "Initial stock cannot be negative.",
      "stock",
    );
  }
  if (changes.variants) {
    const current = new Map<string, EditorDocument>(
      (before?.variants || []).map((variant: EditorDocument) => [
        String(variant._id),
        variant,
      ]),
    );
    const ids = new Set<string>();
    const combinations = new Set<string>();
    next.variants = changes.variants.map((variant) => {
      if (variant.id && ids.has(variant.id))
        editorRefusal(
          "PRODUCT_FIELD_NOT_ALLOWED",
          "Variant IDs must be unique.",
          "variants",
        );
      if (variant.id) ids.add(variant.id);
      const old = variant.id ? current.get(variant.id) : undefined;
      if (before && variant.id && mongoose.isValidObjectId(variant.id) && !old)
        editorRefusal(
          "PRODUCT_FIELD_NOT_ALLOWED",
          "This variant does not belong to the product.",
          "variants",
        );
      assertRows(variant.locationInventory, locations, "variants");
      const key = variant.optionValues
        .map(
          (value) =>
            `${value.optionId || value.optionName}:${value.valueId || value.value}`,
        )
        .sort()
        .join("|");
      if (key && combinations.has(key))
        editorRefusal(
          "PRODUCT_FIELD_NOT_ALLOWED",
          "Variant combinations must be unique.",
          "variants",
        );
      combinations.add(key);
      const [cleaned] = sanitizeVariantsForMongoose([
        {
          ...variant,
          _id: old?._id || new mongoose.Types.ObjectId().toString(),
        },
      ]);
      if (old) {
        // Sanitizer defaults are never accepted as omitted stock/preorder fields.
        preserveStock(
          {
            ...cleaned,
            stock: variant.stock,
            locationInventory: variant.locationInventory,
          },
          old,
          baseline,
          locations,
          variant.id,
        );
        cleaned.stock = old.stock;
        cleaned.locationInventory = old.locationInventory || [];
        cleaned.inventory = { ...old.inventory, ...variant.inventory };
        cleaned.preorder = variant.preorder
          ? {
              ...(cleaned.preorder as object),
              reservedQuantity: old.preorder?.reservedQuantity || 0,
            }
          : old.preorder;
        // Preserve server fields and omitted optional variant fields.
        const merged = { ...old, ...cleaned };
        for (const field of ["sku", "barcode", "image", "mediaId"])
          if (variant[field as keyof typeof variant] === "")
            delete merged[field];
        for (const field of ["comparePrice", "cost"])
          if (variant[field as keyof typeof variant] === null)
            delete merged[field];
        return merged;
      }
      if (
        (variant.stock ?? 0) < 0 ||
        variant.locationInventory?.some((row) => row.quantity < 0)
      )
        editorRefusal(
          "STOCK_CHANGED",
          "Initial stock cannot be negative.",
          "variants",
        );
      return cleaned;
    });
    for (const [id, variant] of current) {
      if (ids.has(id)) continue;
      if (
        Number(variant.stock) !== 0 ||
        Number(variant.preorder?.reservedQuantity) > 0 ||
        variant.locationInventory?.some(
          (row: EditorDocument) => Number(row.quantity) !== 0,
        )
      ) {
        editorRefusal(
          "PRODUCT_HAS_DEPENDENCIES",
          "Clear stock and pre-order reservations before removing a variant.",
          "variants",
        );
      }
      if (
        variant.locationInventory?.some(
          (row: EditorDocument) => !locations.has(String(row.locationId)),
        )
      )
        editorRefusal(
          "PRODUCT_FIELD_NOT_ALLOWED",
          "This variant includes stock outside your locations.",
          "variants",
        );
    }
    // A simple product becoming variant-based must not silently discard its stock.
    if (
      before &&
      !before.variants?.length &&
      next.variants.length &&
      (before.stock ||
        before.locationInventory?.some((row: EditorDocument) => row.quantity))
    )
      editorRefusal(
        "PRODUCT_HAS_DEPENDENCIES",
        "Clear simple-product stock before adding variants.",
        "variants",
      );
  }
  if (before && next.locationInventory)
    next.locationInventory = keepUnwritableRows(
      next.locationInventory,
      before.locationInventory,
      locations,
    );
  return next;
}

/** Desktop Cartesian generation, bounded BEFORE expansion; surviving combinations keep edits. */
export function generateEditorVariants(
  input: ProductVariantGenerateRequest,
): ProductVariantGeneration {
  normalizeEditorOptions(input.options);
  const options = [...input.options]
    .filter((option) => option.values.length)
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  const count = options.reduce(
    (total, option) => total * option.values.length,
    options.length ? 1 : 0,
  );
  if (count > 250)
    editorRefusal(
      "PRODUCT_FIELD_NOT_ALLOWED",
      "A product can have at most 250 variants.",
      "options",
    );
  const signature = (values: EditorDocument[]) =>
    values
      .map((value) => `${value.optionName}:${value.value}`)
      .sort()
      .join("|");
  const existing = new Map(
    (input.existing || []).map((variant) => [
      signature(variant.optionValues),
      variant,
    ]),
  );
  let combinations: EditorDocument[][] = options.length ? [[]] : [];
  for (const option of options)
    combinations = combinations.flatMap((combo) =>
      [...option.values]
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .map((value) => [
          ...combo,
          {
            optionId: option.id,
            optionName: option.name,
            valueId: value.id,
            value: value.value,
            colorCode: value.colorCode,
          },
        ]),
    );
  const variants = combinations.map(
    (optionValues) =>
      existing.get(signature(optionValues)) || {
        name: optionValues.map((value) => value.value).join(" / "),
        price: 0,
        stock: 0,
        optionValues,
      },
  );
  const kept = new Set(
    variants.map((variant) => signature(variant.optionValues)),
  );
  const removed = (input.existing || []).filter(
    (variant) => !kept.has(signature(variant.optionValues)),
  );
  return ProductVariantGeneration.parse({
    variants,
    warnings: removed.length ? ["PRODUCT_HAS_DEPENDENCIES"] : [],
  });
}
