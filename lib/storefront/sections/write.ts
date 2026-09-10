import "server-only";

import { sanitizeHtml } from "@/lib/sanitize";
import type { StoreTemplateType } from "@/lib/storefront/pages/handles";
import {
  MAX_BLOCKS_PER_SECTION,
  MAX_SECTIONS_PER_PAGE,
  sectionInstanceSchema,
} from "./instances";
import { normalizeSectionInstance } from "./normalize";
import { getSectionDefinition, SECTION_REGISTRY } from "./registry";
import type {
  Field,
  LocalizedText,
  SectionDefinition,
  SectionInstance,
  SectionZone,
} from "./types";

/**
 * Write-side gate for section instances.
 *
 * Reads salvage whatever they can (documents outlive deploys); writes REJECT:
 * the editor runs against the same deploy as this validator, so a malformed
 * or unknown payload is a bug or tampering, never version skew. Everything
 * that survives is normalized against the current definitions, so a document
 * only ever stores what the schema describes — and rich text is sanitized
 * here so stored HTML is already safe, not just safe-at-render.
 */
export class SectionWriteError extends Error {}

function sanitizeRichTextValue(value: unknown): LocalizedText {
  if (typeof value === "string") return sanitizeHtml(value);
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record: Record<string, string> = {};
    for (const [locale, entry] of Object.entries(value)) {
      if (typeof entry === "string") record[locale] = sanitizeHtml(entry);
    }
    return record;
  }
  return "";
}

function sanitizeRichTextFields(
  fields: Field[],
  settings: Record<string, unknown>,
): Record<string, unknown> {
  let next = settings;
  for (const field of fields) {
    if (field.type !== "richtext") continue;
    next = { ...next, [field.key]: sanitizeRichTextValue(next[field.key]) };
  }
  return next;
}

function sanitizeInstanceRichText(
  def: SectionDefinition,
  instance: SectionInstance,
): SectionInstance {
  const blockDefs = new Map(
    (def.blocks ?? []).map((block) => [block.type, block]),
  );
  return {
    ...instance,
    settings: sanitizeRichTextFields(def.fields, instance.settings),
    blocks: instance.blocks?.map((block) => {
      const blockDef = blockDefs.get(block.type);
      if (!blockDef) return block;
      return {
        ...block,
        settings: sanitizeRichTextFields(blockDef.fields, block.settings),
      };
    }),
  };
}

/**
 * Where an editor-submitted sections array is headed. Placement rules differ
 * by destination, so writers name theirs:
 * - `templateType`: set when writing a template page ("home" today) — gates
 *   `templates`-restricted sections and demands every `required` core of
 *   that template. Landing pages omit it, so template-bound sections can
 *   never land there.
 * - `zone`: defaults to "template" (the page body); P8 group writers pass
 *   "header"/"footer".
 * - `purpose: "library"`: saved-section entries — core (`locked`/`required`)
 *   sections are refused, they belong to their template, not a library.
 */
interface SectionWriteTarget {
  templateType?: StoreTemplateType;
  zone?: SectionZone;
  purpose?: "page" | "library";
}

/**
 * Validate and normalize an editor-submitted sections array for storage.
 * Throws SectionWriteError with a human-readable reason on any violation.
 */
export function prepareSectionsForWrite(
  raw: unknown,
  target: SectionWriteTarget = {},
): SectionInstance[] {
  if (!Array.isArray(raw)) {
    throw new SectionWriteError("sections must be an array");
  }
  if (raw.length > MAX_SECTIONS_PER_PAGE) {
    throw new SectionWriteError(
      `a page holds at most ${MAX_SECTIONS_PER_PAGE} sections`,
    );
  }

  const zone: SectionZone = target.zone ?? "template";
  const seenIds = new Set<string>();
  const countPerType = new Map<string, number>();

  const prepared = raw.map((candidate, index) => {
    const parsed = sectionInstanceSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new SectionWriteError(`section ${index + 1} is malformed`);
    }

    const def = getSectionDefinition(parsed.data.type);
    if (!def) {
      throw new SectionWriteError(
        `unknown section type: ${parsed.data.type}`,
      );
    }

    if (target.purpose === "library" && (def.locked || def.required)) {
      throw new SectionWriteError(
        `"${def.type}" is a template core section and cannot be saved to the library`,
      );
    }

    if (!(def.zones ?? ["template"]).includes(zone)) {
      throw new SectionWriteError(
        `"${def.type}" cannot be placed in the ${zone} zone`,
      );
    }

    // Template-bound sections may only be written to a template they list;
    // landing pages (no templateType) are refused outright — they never
    // carry the resource such sections render.
    if (
      def.templates &&
      (!target.templateType || !def.templates.includes(target.templateType))
    ) {
      throw new SectionWriteError(
        `"${def.type}" is not available on this page`,
      );
    }

    if (seenIds.has(parsed.data.id)) {
      throw new SectionWriteError(`duplicate section id: ${parsed.data.id}`);
    }
    seenIds.add(parsed.data.id);

    // Policy caps hold on write as well as render — a crafted payload must
    // not be able to store a second paid rail even if rendering would skip it.
    const count = countPerType.get(def.type) ?? 0;
    if (def.maxPerPage !== undefined && count >= def.maxPerPage) {
      throw new SectionWriteError(
        `at most ${def.maxPerPage} "${def.type}" section(s) per page`,
      );
    }
    countPerType.set(def.type, count + 1);

    if ((parsed.data.blocks?.length ?? 0) > MAX_BLOCKS_PER_SECTION) {
      throw new SectionWriteError(
        `a section holds at most ${MAX_BLOCKS_PER_SECTION} blocks`,
      );
    }

    // NOTE: `available()` is deliberately NOT checked here. A vendor section
    // saved while multi-vendor was on must survive the mode being toggled
    // off — it is skipped at render and comes back with the mode.
    return sanitizeInstanceRichText(
      def,
      normalizeSectionInstance(def, parsed.data),
    );
  });

  // A surface must contain every core section it requires, VISIBLE —
  // "delete (or hide) the product info / the header bar" is not a state the
  // engine allows to be stored, whatever the client sent. Template pages
  // check their template's cores; header/footer groups check their zone's.
  if (target.purpose !== "library") {
    for (const def of SECTION_REGISTRY.values()) {
      if (!def.required) continue;
      const demanded =
        zone === "template"
          ? Boolean(
              target.templateType &&
                def.templates?.includes(target.templateType),
            )
          : Boolean(def.zones?.includes(zone));
      if (!demanded) continue;
      if (
        !prepared.some(
          (section) => section.type === def.type && section.visible,
        )
      ) {
        throw new SectionWriteError(
          `this surface requires a visible "${def.type}" section`,
        );
      }
    }
  }

  return prepared;
}
