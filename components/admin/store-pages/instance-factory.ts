import type {
  BlockInstance,
  Field,
  SectionCatalogEntry,
  SectionInstance,
} from "@/lib/storefront/sections/types";

/** The value a field starts with when nothing is stored yet. */
function fieldDefault(field: Field): unknown {
  switch (field.type) {
    case "text":
    case "textarea":
    case "richtext":
      return field.default ?? "";
    case "select":
      return field.default;
    case "number":
      return field.default;
    case "toggle":
      return field.default;
    case "datetime":
    case "image":
    case "url":
    case "collection":
    case "product":
    case "color":
    case "slider":
    case "coupon":
      return field.default ?? "";
    case "productList":
    case "categoryList":
    case "slides":
      return [];
    case "background":
      return { type: "solid" };
  }
}

export function defaultSettings(fields: Field[]): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const field of fields) settings[field.key] = fieldDefault(field);
  return settings;
}

/** Build the instance the picker inserts: defaults ⊕ the entry's starter. */
export function buildInstanceFromCatalog(
  entry: SectionCatalogEntry,
): SectionInstance {
  const blockFieldsByType = new Map(
    entry.blocks.map((block) => [block.type, block.fields]),
  );
  return {
    id: crypto.randomUUID(),
    type: entry.type,
    version: entry.version,
    visible: true,
    settings: { ...defaultSettings(entry.fields), ...entry.starter?.settings },
    blocks: (entry.starter?.blocks ?? []).flatMap((starterBlock) => {
      const fields = blockFieldsByType.get(starterBlock.type);
      if (!fields) return [];
      return [
        {
          id: crypto.randomUUID(),
          type: starterBlock.type,
          visible: true,
          settings: { ...defaultSettings(fields), ...starterBlock.settings },
        },
      ];
    }),
  };
}

/**
 * Deep-copy an instance with FRESH ids (section and every block): what the
 * saved-sections library inserts and what a row's Duplicate places under
 * its original, so two placements never collide on React keys, preview
 * targeting, or write-side id uniqueness.
 *
 * DEEP, not a spread: settings nest (a banner's slides, backgrounds,
 * translated copy), and the slider editor patches nested objects in place —
 * a shallow copy would leave the copy and its original editing each other,
 * the reason `duplicateSlide` clones too. `id` is the caller's when it must
 * know the copy's id before the copy exists (the builder opens it).
 */
export function cloneSectionInstance(
  instance: SectionInstance,
  id: string = crypto.randomUUID(),
): SectionInstance {
  const copy = structuredClone(instance);
  return {
    ...copy,
    id,
    blocks: copy.blocks?.map((block) => ({
      ...block,
      id: crypto.randomUUID(),
    })),
  };
}

export function buildBlockInstance(
  entry: SectionCatalogEntry,
  blockType: string,
): BlockInstance {
  const fields =
    entry.blocks.find((block) => block.type === blockType)?.fields ?? [];
  return {
    id: crypto.randomUUID(),
    type: blockType,
    visible: true,
    settings: defaultSettings(fields),
  };
}
