import { Fragment, Suspense } from "react";
import { normalizeSectionInstance } from "@/lib/storefront/sections/normalize";
import { sectionTitleVars } from "@/lib/storefront/sections/title-size";
import {
  getSectionDefinition,
  resolveSectionVariant,
} from "@/lib/storefront/sections/registry";
import { resolveSectionRender } from "@/lib/storefront/themes/overrides";
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
 * Which component actually runs is decided in this order:
 *
 *   1. the instance's own VARIANT — a stored merchant choice, so it wins;
 *   2. a per-theme override for the type;
 *   3. the section's base renderer.
 *
 * Variants outrank themes on purpose: "I picked the promo-row design for
 * this shelf" must survive switching theme, or the choice is not a choice.
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
        const variant = resolveSectionVariant(def, instance.settings);
        // The active theme may skin this type; unresolved types fall through
        // the manifest's extends chain to the base component.
        const Render = variant?.Render ?? resolveSectionRender(ctx.themeId, def);
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
