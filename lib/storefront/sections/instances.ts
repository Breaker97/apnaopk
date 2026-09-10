import { z } from "zod";
import {
  MAX_BLOCKS_PER_SECTION,
  MAX_SECTIONS_PER_PAGE,
  type SectionInstance,
} from "./types";

// Re-exported so existing importers (the write gate, the tests) keep their
// path; the values live in `types.ts` because the client editor needs them
// and must not pull the zod schemas below into its bundle.
export { MAX_BLOCKS_PER_SECTION, MAX_SECTIONS_PER_PAGE };

/**
 * Boundary validation for section instances stored on StorePage documents.
 *
 * The document stores sections as a Mixed subtree (the Menu.items precedent),
 * so this schema is the only thing standing between the renderer and whatever
 * a past write left behind. Reads salvage per element: one malformed entry is
 * dropped, the rest of the page still renders.
 */

const idSchema = z.string().min(1).max(64);

const blockInstanceSchema = z.object({
  id: idSchema,
  type: idSchema,
  visible: z.boolean().catch(true),
  settings: z.record(z.string(), z.unknown()).catch({}),
});

export const sectionInstanceSchema = z.object({
  id: idSchema,
  type: idSchema,
  version: z.number().int().min(1).catch(1),
  visible: z.boolean().catch(true),
  settings: z.record(z.string(), z.unknown()).catch({}),
  blocks: z.array(blockInstanceSchema).optional(),
});

/**
 * Parse an untrusted sections array. Invalid elements are dropped, blocks
 * and sections are truncated to their caps, and a non-array yields [].
 */
export function sanitizeSectionInstances(raw: unknown): SectionInstance[] {
  if (!Array.isArray(raw)) return [];
  const sections: SectionInstance[] = [];
  for (const candidate of raw) {
    if (sections.length >= MAX_SECTIONS_PER_PAGE) break;
    const parsed = sectionInstanceSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const { blocks, ...section } = parsed.data;
    sections.push(
      blocks
        ? { ...section, blocks: blocks.slice(0, MAX_BLOCKS_PER_SECTION) }
        : section,
    );
  }
  return sections;
}
