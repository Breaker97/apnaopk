import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { cn } from "@/lib/utils";

/**
 * Placeholder for the admin's record editors (category, collection, brand, …)
 * while the record loads.
 *
 * Every one of those forms is the same shape — sticky header, then a
 * `lg:grid-cols-3` body with a two-column main stack and a one-column side
 * stack of cards — so they share one skeleton instead of each shipping its own.
 * Callers describe their cards block by block so the placeholder keeps the real
 * page's height and rhythm; a generic "four grey bars" would still reflow the
 * whole viewport when the form arrives, which is what the centered spinner
 * these replaced already did.
 */

type AdminFormSkeletonBlock =
  /** Label over a single-line input. */
  | { type: "field"; labelWidth?: string }
  /** Label over a multi-line input; `lines` scales the box height. */
  | { type: "textarea"; lines?: number; labelWidth?: string }
  /** Label row with a trailing action button, over a multi-line input. */
  | { type: "textareaWithAction"; lines?: number; labelWidth?: string }
  /** Dashed media dropzone. */
  | { type: "dropzone"; height?: string }
  /** Bordered row with a label and a switch. */
  | { type: "toggle" }
  /** Bordered muted row with a label on the left and a value on the right. */
  | { type: "stat" }
  /** Two side-by-side selectable tiles (e.g. Manual / Automated). */
  | { type: "tiles" }
  /** Search-engine listing preview: banded header, preview box, 3 fields. */
  | { type: "seo" }
  /** A bordered inner table with `columns` columns and `rows` rows. */
  | { type: "table"; columns?: number; rows?: number }
  /** Free-height filler for anything that doesn't decompose usefully. */
  | { type: "block"; height?: string };

export interface AdminFormSkeletonCard {
  titleWidth?: string;
  /** Renders a second, lighter line under the card title. */
  description?: boolean;
  blocks: AdminFormSkeletonBlock[];
}

interface AdminFormSkeletonProps {
  mainCards: AdminFormSkeletonCard[];
  sideCards?: AdminFormSkeletonCard[];
  /** Number of buttons in the sticky header's action group. */
  headerActions?: number;
  /** Number of status badges beside the title. */
  badges?: number;
  /** Renders a subtitle line under the title, for headers that carry one. */
  headerDescription?: boolean;
  /** The form's outer `space-y-*`. */
  spacing?: "4" | "6";
  /**
   * The body grid's own gap, when it differs from the outer spacing — the
   * category and brand forms are `space-y-6` outside but `gap-4` inside.
   */
  gridSpacing?: "4" | "6";
  className?: string;
}

function Block({ block }: { block: AdminFormSkeletonBlock }) {
  switch (block.type) {
    case "field":
      return (
        <div className="space-y-2">
          <Skeleton className={cn("h-4", block.labelWidth ?? "w-24")} />
          <Skeleton className="h-9 w-full" />
        </div>
      );

    case "textarea":
      return (
        <div className="space-y-2">
          <Skeleton className={cn("h-4", block.labelWidth ?? "w-24")} />
          <Skeleton className={cn("w-full", heightForLines(block.lines))} />
        </div>
      );

    case "textareaWithAction":
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className={cn("h-4", block.labelWidth ?? "w-24")} />
            <Skeleton className="h-7 w-24 rounded-md" />
          </div>
          <Skeleton className={cn("w-full", heightForLines(block.lines))} />
          <Skeleton className="h-3 w-28" />
        </div>
      );

    case "dropzone":
      return (
        <Skeleton
          className={cn("w-full rounded-lg", block.height ?? "h-40")}
        />
      );

    case "toggle":
      return (
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
        </div>
      );

    case "stat":
      return (
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-36" />
          </div>
          <Skeleton className="h-5 w-8 shrink-0" />
        </div>
      );

    case "tiles":
      return (
        <div className="grid grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="space-y-2 rounded-md border-2 p-4 text-center"
            >
              <Skeleton className="mx-auto h-5 w-24" />
              <Skeleton className="mx-auto h-3 w-32" />
            </div>
          ))}
        </div>
      );

    case "seo":
      return (
        <div className="space-y-4">
          {/* Google-style listing preview */}
          <div className="space-y-2 rounded-sm border p-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-3 w-64" />
            <Skeleton className="h-5 w-72" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          {/* Always-open editor beneath it */}
          <div className="space-y-4 border-t pt-5">
            <Block block={{ type: "field", labelWidth: "w-20" }} />
            <Block block={{ type: "textarea", lines: 3, labelWidth: "w-28" }} />
            <Block block={{ type: "field", labelWidth: "w-24" }} />
          </div>
        </div>
      );

    case "table": {
      const columns = block.columns ?? 4;
      const rows = block.rows ?? 3;
      return (
        <div className="overflow-hidden rounded-lg border">
          <div
            className="grid gap-4 border-b bg-muted/40 px-4 py-3"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-20" />
            ))}
          </div>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <div
              key={rowIndex}
              className="grid gap-4 border-b px-4 py-3 last:border-b-0"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
            >
              {Array.from({ length: columns }).map((_, colIndex) => (
                <Skeleton key={colIndex} className="h-4 w-full max-w-24" />
              ))}
            </div>
          ))}
        </div>
      );
    }

    case "block":
      return <Skeleton className={cn("w-full", block.height ?? "h-24")} />;
  }
}

function heightForLines(lines = 4) {
  if (lines <= 2) return "h-16";
  if (lines === 3) return "h-20";
  if (lines <= 5) return "h-24";
  return "h-40";
}

function CardBlock({
  card,
  spacing,
}: {
  card: AdminFormSkeletonCard;
  spacing: "4" | "6";
}) {
  return (
    <Card className="gap-2">
      <CardHeader className="space-y-2">
        <Skeleton className={cn("h-5", card.titleWidth ?? "w-32")} />
        {card.description ? <Skeleton className="h-3 w-52" /> : null}
      </CardHeader>
      <CardContent className={spacing === "6" ? "space-y-5" : "space-y-4"}>
        {card.blocks.map((block, index) => (
          <Block key={index} block={block} />
        ))}
      </CardContent>
    </Card>
  );
}

export function AdminFormSkeleton({
  mainCards,
  sideCards = [],
  headerActions = 2,
  badges = 1,
  headerDescription = false,
  spacing = "4",
  gridSpacing,
  className,
}: AdminFormSkeletonProps) {
  const grid = gridSpacing ?? spacing;
  const gap = grid === "6" ? "gap-6" : "gap-4";
  const outerStack = spacing === "6" ? "space-y-6" : "space-y-4";
  const columnStack = grid === "6" ? "space-y-6" : "space-y-4";

  return (
    <div className={cn("mx-auto w-full max-w-6xl", outerStack, className)}>
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title={<Skeleton className="h-6 w-44" />}
        description={
          headerDescription ? (
            // A span, not <Skeleton/>: the header renders its description
            // inside a <p>, and a nested <div> is invalid HTML that React
            // reports as a hydration mismatch.
            <span className="block h-4 w-64 animate-pulse rounded-md bg-black/[0.06] dark:bg-white/[0.08]" />
          ) : undefined
        }
        status={
          badges > 0 ? (
            <div className="flex items-center gap-2">
              {Array.from({ length: badges }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-16 rounded-full" />
              ))}
            </div>
          ) : null
        }
        actions={Array.from({ length: headerActions }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20" />
        ))}
      />

      <div className={cn("grid min-w-0 grid-cols-1 lg:grid-cols-3", gap)}>
        <div className={cn("min-w-0 lg:col-span-2", columnStack)}>
          {mainCards.map((card, index) => (
            <CardBlock key={index} card={card} spacing={grid} />
          ))}
        </div>

        {sideCards.length > 0 && (
          <div className={cn("min-w-0", columnStack)}>
            {sideCards.map((card, index) => (
              <CardBlock key={index} card={card} spacing={grid} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
