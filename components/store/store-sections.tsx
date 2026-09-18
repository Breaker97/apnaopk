import { Fragment, Suspense } from "react";
import { normalizeSectionInstance } from "@/lib/storefront/sections/normalize";
import { sectionTitleVars } from "@/lib/storefront/sections/title-size";
import {
  getSectionDefinition,
  resolveSectionVariant,
} from "@/lib/storefront/sections/registry";
import { getThemePreferredVariants } from "@/lib/storefront/themes/registry";
import type {
  SectionInstance,
  SectionRenderContext,
} from "@/lib/storefront/sections/types";

/**
 * Render a page's section instances through the registry.
 *
 * Data-fetching sections get their own <Suspense> boundary (the definition
 * supplies the skeleton) so the shell streams immediately and each section
 * pops in independently; synchronous sections render inline — the exact
 * boundaries the hand-wired home page drew.
 *
 * Documents can outlive code in both directions, so unknown section types
 * render nothing rather than crash, and every instance is re-normalized
 * against the CURRENT definition before rendering.
 *
 * Which component actually runs is decided by data alone:
 *
 *   1. a design stored on the instance — a merchant choice, so it wins;
 *   2. for sections that follow the template, the design the active
 *      template's manifest names (`preferredVariants`);
 *   3. the section's first design, or its base renderer when it has none.
 *
 * No theme has renderers of its own. A template is its tokens, its presets
 * and the designs it names — so every section, and every feature a section
 * has, exists under every template.
 */
export function StoreSections({
  sections,
  ctx,
  editable = false,
  className,
}: {
  sections: SectionInstance[];
  ctx: SectionRenderContext;
  /**
   * Draft-preview renders wrap every section in a `data-section-id` block so
   * the builder's embedded preview can target them. The LIVE page never
   * carries the wrappers — its DOM stays exactly as before.
   */
  editable?: boolean;
  /**
   * The header group passes "contents": a plain box here would become the
   * sticky header's containing block — exactly as tall as the header — and
   * `position: sticky` inside it would have no room to travel.
   */
  className?: string;
}) {
  const renderedPerType = new Map<string, number>();
  const preferredVariants = getThemePreferredVariants(ctx.themeId);

  return (
    <div className={className}>
      {sections.map((raw) => {
        if (!raw.visible) return null;

        const def = getSectionDefinition(raw.type);
        if (!def) return null;
        if (def.available && !def.available(ctx)) return null;

        // maxPerPage is a policy cap (e.g. the paid sponsored rail must stay
        // a singleton), enforced here so a hand-edited document can't bypass
        // it — the editor enforcing it on write is UX, this is the invariant.
        const count = renderedPerType.get(def.type) ?? 0;
        if (def.maxPerPage !== undefined && count >= def.maxPerPage) {
          return null;
        }
        renderedPerType.set(def.type, count + 1);

        const instance = normalizeSectionInstance(def, raw);
        const variant = resolveSectionVariant(
          def,
          instance.settings,
          preferredVariants,
        );
        const Render = variant?.Render ?? def.Render;
        const Skeleton = variant?.Skeleton ?? def.Skeleton;
        const node = (
          <Render
            sectionId={instance.id}
            settings={instance.settings}
            blocks={instance.blocks ?? []}
            ctx={ctx}
          />
        );

        const body = !Skeleton ? (
          node
        ) : (
          <Suspense fallback={<Skeleton settings={instance.settings} ctx={ctx} />}>
            {node}
          </Suspense>
        );

        // The title size travels as inherited custom properties. The carrier
        // is `display: contents` so it generates no box: the live DOM keeps
        // exactly the shape it had, and a section that made no choice gets no
        // wrapper at all.
        const titleVars = sectionTitleVars(instance.settings);
        const sized = titleVars ? (
          <div style={{ display: "contents", ...titleVars }}>{body}</div>
        ) : (
          body
        );

        if (editable) {
          return (
            <div key={instance.id} data-section-id={instance.id}>
              {sized}
            </div>
          );
        }
        return <Fragment key={instance.id}>{sized}</Fragment>;
      })}
    </div>
  );
}
