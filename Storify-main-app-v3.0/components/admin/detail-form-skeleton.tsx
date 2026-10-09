import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface DetailFormSkeletonProps {
  /** Number of cards in the responsive grid. Defaults to 2. */
  cards?: number;
  /** Skeleton fields rendered inside each card. Defaults to 4. */
  fieldsPerCard?: number;
  className?: string;
}

/**
 * Placeholder for an editable detail tab (Profile, Access, Account, …) while the
 * record loads. Mirrors the shared two-column labeled-field card layout so the
 * page keeps its shape and only the data-bound controls swap to skeletons —
 * matching the "label stays, value is a skeleton" behaviour of the stat cards.
 */
export function DetailFormSkeleton({
  cards = 2,
  fieldsPerCard = 4,
  className,
}: DetailFormSkeletonProps) {
  return (
    <div className={cn("grid grid-cols-1 gap-6 lg:grid-cols-2", className)}>
      {Array.from({ length: cards }).map((_, cardIndex) => (
        <Card key={cardIndex}>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: fieldsPerCard }).map((_, fieldIndex) => (
              <div key={fieldIndex} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
