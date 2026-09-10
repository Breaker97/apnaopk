import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Shared route-level fallback for account pages that don't define their own
// loading.tsx (profile, addresses, wishlist, notifications, preferences, etc.).
// The account layout (sidebar) is preserved around this; it just fills the
// content area with a section-shaped skeleton on navigation instead of leaving
// the previous page frozen while the segment loads.
export default function AccountLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <p className="sr-only" aria-live="polite">
        Loading...
      </p>

      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
