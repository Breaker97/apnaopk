import { randomUUID } from "crypto";
import type {
  GlobalVariantType,
  GlobalVariantValue,
  GlobalVariantVisual,
} from "@/types";

const GLOBAL_VARIANT_TYPES: GlobalVariantType[] = [
  "text",
  "color",
  "image",
  "integer",
  "decimal",
];

const GLOBAL_VARIANT_VISUALS: GlobalVariantVisual[] = [
  "rectangle",
  "dropdown",
  "circle",
  "color",
  "color_label",
  "radio",
  "image",
];

function normalizeType(value: unknown): GlobalVariantType {
  return GLOBAL_VARIANT_TYPES.includes(value as GlobalVariantType)
    ? (value as GlobalVariantType)
    : "text";
}

function normalizeVisual(value: unknown): GlobalVariantVisual {
  return GLOBAL_VARIANT_VISUALS.includes(value as GlobalVariantVisual)
    ? (value as GlobalVariantVisual)
    : "rectangle";
}

/**
 * Coerce a raw request payload into the fields a GlobalVariant document
 * accepts. Drops blank values, re-stamps positions, and ensures every value
 * has a stable string id so the client can key/reorder them.
 */
export function normalizeGlobalVariantInput(body: Record<string, unknown>) {
  const rawValues = Array.isArray(body.values) ? body.values : [];

  const values: GlobalVariantValue[] = [];
  for (const raw of rawValues) {
    const value = raw as Record<string, unknown>;
    const label = typeof value.value === "string" ? value.value.trim() : "";
    if (!label) continue;
    const entry: GlobalVariantValue = {
      _id:
        typeof value._id === "string" && value._id ? value._id : randomUUID(),
      value: label,
      position: values.length,
    };
    if (typeof value.colorCode === "string" && value.colorCode.trim()) {
      entry.colorCode = value.colorCode.trim();
    }
    if (typeof value.image === "string" && value.image.trim()) {
      entry.image = value.image.trim();
    }
    values.push(entry);
  }

  return {
    name: typeof body.name === "string" ? body.name.trim() : "",
    type: normalizeType(body.type),
    visual: normalizeVisual(body.visual),
    values,
  };
}
