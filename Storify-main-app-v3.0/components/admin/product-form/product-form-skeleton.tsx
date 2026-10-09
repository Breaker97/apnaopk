import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";

/**
 * Placeholder for the product editor while the record loads.
 *
 * Mirrors the editor's own shape — sticky header, the 2/3 + 1/3 card grid, and
 * the same card order — so the page keeps its layout and nothing jumps when the
 * real form swaps in. This replaced a centered spinner, which collapsed the
 * page to a short empty box and then reflowed the whole viewport on arrival.
 */

function FieldSkeleton({ labelWidth = "w-24" }: { labelWidth?: string }) {
  return (
    <div className="space-y-2">
      <Skeleton className={`h-4 ${labelWidth}`} />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

function CardSkeleton({
  fields = 3,
  titleWidth = "w-32",
  children,
}: {
  fields?: number;
  titleWidth?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <Skeleton className={`h-5 ${titleWidth}`} />
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from({ length: fields }).map((_, index) => (
          <FieldSkeleton key={index} />
        ))}
        {children}
      </CardContent>
    </Card>
  );
}

/** Switch rows (Featured, Online store, Point of sale) read as bordered rows. */
function ToggleRowSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-5 w-9 rounded-full" />
    </div>
  );
}

export function ProductFormSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title={<Skeleton className="h-6 w-48" />}
        status={<Skeleton className="h-5 w-16 rounded-full" />}
        actions={
          <>
            <Skeleton className="h-8 w-8 sm:w-20" />
            <Skeleton className="h-8 w-8 sm:w-28" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-20" />
          </>
        }
      />

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {/* Details: title, URL handle, summary, description editor */}
          <Card className="gap-2">
            <CardHeader>
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldSkeleton labelWidth="w-16" />
              <FieldSkeleton labelWidth="w-24" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-20 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-48 w-full" />
              </div>
            </CardContent>
          </Card>

          {/* Media: dropzone */}
          <Card className="gap-2">
            <CardHeader>
              <Skeleton className="h-5 w-20" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>

          {/* Pricing */}
          <Card className="gap-2">
            <CardHeader>
              <Skeleton className="h-5 w-20" />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FieldSkeleton labelWidth="w-16" />
                <FieldSkeleton labelWidth="w-28" />
              </div>
              <ToggleRowSkeleton />
            </CardContent>
          </Card>

          {/* Inventory */}
          <CardSkeleton fields={2} titleWidth="w-24">
            <ToggleRowSkeleton />
          </CardSkeleton>

          {/* Shipping */}
          <CardSkeleton fields={2} titleWidth="w-20" />

          {/* Variants */}
          <Card className="gap-2">
            <CardHeader>
              <Skeleton className="h-5 w-20" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>

          {/* Search engine listing preview */}
          <Card className="gap-2">
            <CardHeader>
              <Skeleton className="h-5 w-48" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          {/* Status */}
          <Card className="gap-2">
            <CardHeader>
              <Skeleton className="h-5 w-16" />
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldSkeleton labelWidth="w-16" />
              <ToggleRowSkeleton />
            </CardContent>
          </Card>

          {/* Publishing */}
          <Card className="gap-2">
            <CardHeader>
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="space-y-3">
              <ToggleRowSkeleton />
              <ToggleRowSkeleton />
            </CardContent>
          </Card>

          {/* Organization: category, brand, product type, collections, tags */}
          <CardSkeleton fields={4} titleWidth="w-28">
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            </div>
          </CardSkeleton>
        </div>
      </div>
    </div>
  );
}
