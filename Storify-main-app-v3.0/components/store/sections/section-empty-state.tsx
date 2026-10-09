import { ImageOff } from "lucide-react";
import type { SectionRenderContext } from "@/lib/storefront/sections/types";

/**
 * What a section shows when it has nothing to show.
 *
 * On the LIVE storefront that is nothing at all — an empty box reads as a
 * broken store, and always has. But in the admin's draft preview the same
 * silence is the problem: a merchant who has just applied a theme sees gaps
 * where sections are, with no way to tell whether the design is missing or
 * merely un-fed. So preview renders a labelled outline in the section's
 * place, naming what it needs.
 *
 * Call it through `sectionEmptyState(ctx, …)`: the null-on-live decision
 * then lives in ONE place rather than at every empty-return site.
 */
export function sectionEmptyState(
  // Only the flag is read, so a caller holding a narrower context can pass
  // what it has instead of threading the whole thing through.
  ctx: Pick<SectionRenderContext, "preview">,
  copy: { title: string; hint: string },
) {
  if (!ctx.preview) return null;
  return <SectionEmptyState {...copy} />;
}

function SectionEmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <section className="py-4 lg:py-6" data-section-empty>
      <div className="container mx-auto px-4">
        <div className="flex flex-col items-center gap-1.5 rounded-[var(--radius-lg)] border border-dashed border-border bg-muted/30 px-6 py-10 text-center">
          <ImageOff className="h-5 w-5 text-muted-foreground" aria-hidden />
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="max-w-md text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
    </section>
  );
}
