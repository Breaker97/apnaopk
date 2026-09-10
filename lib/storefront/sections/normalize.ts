import { normalizeBackground, normalizeSlides } from "@/lib/sliders/types";
import type {
  BlockDefinition,
  BlockInstance,
  Field,
  LocalizedText,
  SectionDefinition,
  SectionInstance,
} from "./types";

/**
 * Field-driven normalization: the read-side half of the schema contract.
 *
 * Stored settings are whatever a past deploy (or a cached entry written by
 * one) put there, so every render normalizes against the CURRENT definition:
 * unknown keys are dropped, missing keys take defaults, out-of-range values
 * clamp. This is the same normalize-on-read discipline the legacy
 * `home-page-config` normalizers applied per section, generalized so a
 * section never hand-writes it again.
 */

function isLocalizedRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "string");
}

function normalizeIdList(value: unknown, max?: number): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  // ORDER IS CONTENT here: it decides which slot each pick lands in, so the
  // list is de-duplicated in place rather than sorted or re-keyed.
  const unique = Array.from(new Set(ids));
  return max !== undefined ? unique.slice(0, max) : unique;
}

export function normalizeFieldValue(field: Field, value: unknown): unknown {
  switch (field.type) {
    case "text":
    case "textarea":
    case "richtext": {
      if (typeof value === "string") return value;
      if (isLocalizedRecord(value)) return value;
      return (field.default ?? "") satisfies LocalizedText;
    }
    case "select":
      return typeof value === "string" && field.options.includes(value)
        ? value
        : field.default;
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return field.default;
      }
      return Math.min(field.max, Math.max(field.min, Math.floor(value)));
    }
    case "toggle":
      return typeof value === "boolean" ? value : field.default;
    case "datetime": {
      if (typeof value !== "string" || value.length === 0) {
        return field.default ?? "";
      }
      return Number.isNaN(Date.parse(value)) ? (field.default ?? "") : value;
    }
    case "image":
    case "url":
    case "collection":
    case "product":
    case "slider":
    case "coupon":
      return typeof value === "string" ? value : (field.default ?? "");
    case "color": {
      if (typeof value !== "string") return field.default ?? "";
      const trimmed = value.trim();
      if (trimmed === "") return "";
      return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)
        ? trimmed
        : (field.default ?? "");
    }
    case "productList":
      return normalizeIdList(value, field.max);
    case "categoryList":
      return normalizeIdList(value);
    // Inline slide lists ride the slider contract's own normalizer, so the
    // write gate enforces exactly what the saved-slider API enforces.
    case "slides":
      return normalizeSlides(value);
    case "background":
      return normalizeBackground(value);
  }
}

export function normalizeSettings(
  fields: Field[],
  raw: unknown,
): Record<string, unknown> {
  const source =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const settings: Record<string, unknown> = {};
  for (const field of fields) {
    settings[field.key] = normalizeFieldValue(field, source[field.key]);
  }
  return settings;
}

function normalizeBlocks(
  definitions: BlockDefinition[] | undefined,
  blocks: BlockInstance[] | undefined,
): BlockInstance[] {
  if (!definitions || definitions.length === 0 || !Array.isArray(blocks)) {
    return [];
  }
  const byType = new Map(definitions.map((def) => [def.type, def]));
  const counts = new Map<string, number>();
  const normalized: BlockInstance[] = [];
  for (const block of blocks) {
    const def = byType.get(block.type);
    if (!def) continue; // unknown block type: skip, don't crash
    const count = counts.get(def.type) ?? 0;
    if (def.max !== undefined && count >= def.max) continue;
    counts.set(def.type, count + 1);
    normalized.push({
      id: block.id,
      type: block.type,
      visible: block.visible,
      settings: normalizeSettings(def.fields, block.settings),
    });
  }
  return normalized;
}

/**
 * Migrate (if the stored version predates the definition) then normalize an
 * instance for rendering. Never mutates the stored document — documents are
 * only rewritten by explicit migrations or saves.
 */
export function normalizeSectionInstance(
  def: SectionDefinition,
  instance: SectionInstance,
): SectionInstance {
  const migrated =
    instance.version < def.version && def.migrate
      ? def.migrate(instance, instance.version)
      : instance;
  return {
    id: migrated.id,
    type: def.type,
    version: def.version,
    visible: migrated.visible,
    settings: normalizeSettings(def.fields, migrated.settings),
    blocks: normalizeBlocks(def.blocks, migrated.blocks),
  };
}
