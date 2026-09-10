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
 * saved-sections library inserts, so two placements of the same entry never
 * collide on React keys, preview targeting, or write-side id uniqueness.
 */
export function cloneSectionInstance(
  instance: SectionInstance,
): SectionInstance {
  return {
    ...instance,
    id: crypto.randomUUID(),
    settings: { ...instance.settings },
    blocks: instance.blocks?.map((block) => ({
      ...block,
      id: crypto.randomUUID(),
      settings: { ...block.settings },
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
