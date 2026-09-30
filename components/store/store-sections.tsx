import { Fragment, Suspense } from "react";
import { normalizeSectionInstance } from "@/lib/storefront/sections/normalize";
import { sectionTitleVars } from "@/lib/storefront/sections/title-size";
import {
  getSectionDefinition,
  resolveSectionVariant,
} from "@/lib/storefront/sections/registry";
import { getThemePreferredVariants } from "@/lib/storefront/themes/registry";
import type {
  SectionDefinition,
  SectionInstance,
  SectionRenderContext,
} from "@/lib/storefront/sections/types";

/** A section the page will draw: normalized, in the design it resolved to. */
interface DrawnSection {
  instance: SectionInstance;
  Render: SectionDefinition["Render"];
  Skeleton: SectionDefinition["Skeleton"];
  /** Its own configuration leaves it nothing to draw (`isEmpty`). */
  empty: boolean;
}

/**
 * The sections a page will actually draw, in order. The visibility, feature
 * gate, per-page cap and design rules live here once, so a page and its
 * loading frame can never disagree about what is on it.
 */
function drawnSections(
  sections: SectionInstance[],
  ctx: SectionRenderContext,
): DrawnSection[] {
  const renderedPerType = new Map<string, number>();
  const preferredVariants = getThemePreferredVariants(ctx.themeId);
  const drawn: DrawnSection[] = [];

  for (const raw of sections) {
    if (!raw.visible) continue;

    const def = getSectionDefinition(raw.type);
    if (!def) continue;
    if (def.available && !def.available(ctx)) continue;

    // maxPerPage is a policy cap (e.g. the paid sponsored rail must stay
    // a singleton), enforced here so a hand-edited document can't bypass
    // it — the editor enforcing it on write is UX, this is the invariant.
    const count = renderedPerType.get(def.type) ?? 0;
    if (def.maxPerPage !== undefined && count >= def.maxPerPage) continue;
    renderedPerType.set(def.type, count + 1);

    const instance = normalizeSectionInstance(def, raw);
    const variant = resolveSectionVariant(
      def,
      instance.settings,
      preferredVariants,
    );
    drawn.push({
      instance,
      Render: variant?.Render ?? def.Render,
      Skeleton: variant?.Skeleton ?? def.Skeleton,
      empty:
        def.isEmpty?.({
          settings: instance.settings,
          blocks: instance.blocks ?? [],
        }) ?? false,
    });
  }
  return drawn;
}

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
  page,
  ctx,
  editable = false,
  className,
}: {
  sections: SectionInstance[];
  /**
   * The whole page, when `sections` is only a piece of it (the builder's
   * single-section preview frame), so `ctx.pageSectionTypes` still
   * describes the page the section sits on.
   */
  page?: SectionInstance[];
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
  const drawn = drawnSections(sections, ctx);
  const pageCtx: SectionRenderContext = {
    ...ctx,
    pageSectionTypes: new Set(
      (page ? drawnSections(page, ctx) : drawn).map(({ instance }) => instance.type),
    ),
  };
  return (
    <div className={className}>
      {drawn.map(({ instance, Render, Skeleton, empty }) => {
        const node = (
          <Render
            sectionId={instance.id}
            settings={instance.settings}
            blocks={instance.blocks ?? []}
            ctx={pageCtx}
          />
        );

        // A section configured empty keeps its boundary but not its
        // skeleton: a placeholder for content that never arrives is exactly
        // the flash a shopper should not see.
        const body = !Skeleton ? (
          node
        ) : (
          <Suspense
            fallback={
              empty ? null : <Skeleton settings={instance.settings} ctx={pageCtx} />
            }
          >
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

/**
 * A section page's route-level loading frame: the skeleton of every section
 * the page is about to draw, in the page's order. A hidden, gated-off or
 * empty-configured section adds nothing, and neither does a synchronous one
 * (it has no skeleton) — so the frame shows what the store is set up to
 * show, not one default arrangement of it.
 */
export function StoreSectionSkeletons({
  sections,
  ctx,
}: {
  sections: SectionInstance[];
  ctx: SectionRenderContext;
}) {
  return (
    <>
      {drawnSections(sections, ctx).map(({ instance, Skeleton, empty }) =>
        Skeleton && !empty ? (
          <Skeleton key={instance.id} settings={instance.settings} ctx={ctx} />
        ) : null,
      )}
    </>
  );
}
