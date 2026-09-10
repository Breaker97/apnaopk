import { cn } from "@/lib/utils";

/**
 * Generic Suspense fallbacks for the newer catalog sections. The original
 * home sections keep their bespoke skeletons; these cover the common "heading
 * plus a row/grid of tiles" shape so a new section doesn't need a custom one.
 */
export function TileRowSkeleton({
  tiles = 4,
  aspectClassName = "aspect-[4/3]",
  columnsClassName = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
}: {
  tiles?: number;
  aspectClassName?: string;
  columnsClassName?: string;
}) {
  return (
    <section className="py-5 lg:py-8" aria-hidden>
      <div className="container mx-auto px-4">
        <div className="mb-6 h-7 w-48 animate-pulse rounded-md bg-black/[0.06] dark:bg-white/[0.08]" />
        <div className={cn("grid gap-3 sm:gap-4", columnsClassName)}>
          {Array.from({ length: tiles }).map((_, index) => (
            <div
              key={index}
              className={cn(
                "animate-pulse rounded-md bg-black/[0.06] dark:bg-white/[0.08]",
                aspectClassName,
              )}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
