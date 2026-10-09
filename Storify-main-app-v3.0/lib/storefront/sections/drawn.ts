import "server-only";

import { normalizeSectionInstance } from "./normalize";
import { getSectionDefinition, resolveSectionVariant } from "./registry";
import { getThemePreferredVariants } from "@/lib/storefront/themes/registry";
import type {
  SectionAvailabilityContext,
  SectionDefinition,
  SectionInstance,
  SectionVariant,
} from "./types";

/** A section a page will draw: normalized, in the design it resolved to. */
export interface DrawnSection {
  instance: SectionInstance;
  definition: SectionDefinition;
  /** The design it renders in; absent for a section without designs. */
  variant?: SectionVariant;
  /** Its own configuration leaves it nothing to draw (`isEmpty`). */
  empty: boolean;
}

/**
 * The sections a page will actually draw, in order. The visibility, feature
 * gate, per-page cap and design rules live here once, so a page, its loading
 * frame and the shopper app's home (GET /home) can never disagree about what
 * is on it.
 */
export function drawnSections(
  sections: SectionInstance[],
  ctx: SectionAvailabilityContext & { themeId: string },
): DrawnSection[] {
  const renderedPerType = new Map<string, number>();
  const preferredVariants = getThemePreferredVariants(ctx.themeId);
  const drawn: DrawnSection[] = [];

  for (const raw of sections) {
    if (!raw.visible) continue;

    const definition = getSectionDefinition(raw.type);
    if (!definition) continue;
    if (definition.available && !definition.available(ctx)) continue;

    // maxPerPage is a policy cap (e.g. the paid sponsored rail must stay
    // a singleton), enforced here so a hand-edited document can't bypass
    // it — the editor enforcing it on write is UX, this is the invariant.
    const count = renderedPerType.get(definition.type) ?? 0;
    if (definition.maxPerPage !== undefined && count >= definition.maxPerPage) continue;
    renderedPerType.set(definition.type, count + 1);

    const instance = normalizeSectionInstance(definition, raw);
    const variant = resolveSectionVariant(
      definition,
      instance.settings,
      preferredVariants,
    );
    drawn.push({
      instance,
      definition,
      ...(variant ? { variant } : {}),
      empty:
        definition.isEmpty?.({
          settings: instance.settings,
          blocks: instance.blocks ?? [],
        }) ?? false,
    });
  }
  return drawn;
}
