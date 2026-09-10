import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// Loading frame for the checkout route. Deliberately shared by BOTH
// checkout/loading.tsx (route-level navigation fallback) and the <Suspense>
// fallback inside checkout/page.tsx, because those two render back to back:
// CheckoutContent calls useSearchParams(), so SSR bails out at that boundary
// and the skeleton is what actually ships in the HTML until hydration. Two
// different skeletons there would flash and reflow — one component means the
// frame never changes shape until the real form takes its place.
//
// Dimensions mirror checkout-content.tsx: h-14 rounded-lg inputs
// (FLOATING_INPUT_CLASS), the max-w-120 / max-w-110 columns, and the
// bg-zinc-50 dark:bg-background summary rail on its 112px sticky offset.
// Verified against the live form — every section top matches to the pixel
// except the submit button, which lands 8px low.

// Matches FLOATING_INPUT_CLASS ("peer h-14 rounded-lg ...").
function FieldSkeleton() {
  return <Skeleton className="h-14 w-full rounded-lg" />;
}

// One row of the bordered radio lists (payment methods, billing choice).
function ChoiceRow({ withBorder }: { withBorder?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-h-12 items-center gap-3 px-4 py-3",
        withBorder && "border-t",
      )}
    >
      <Skeleton className="size-4 shrink-0 rounded-full" />
      <Skeleton className="h-5 w-40 max-w-full" />
      <Skeleton className="ml-auto h-4 w-4 shrink-0 rounded-sm" />
    </div>
  );
}

export function CheckoutSkeleton() {
  return (
    <div className="min-h-screen bg-background" aria-busy="true">
      <p className="sr-only" aria-live="polite">
        Loading checkout...
      </p>

      <div className="mx-auto lg:grid lg:grid-cols-2" aria-hidden="true">
        {/* Left column — form */}
        <div className="px-4 py-8 lg:px-10 lg:py-12 lg:pr-16">
          <div className="mx-auto max-w-120 lg:mx-0 lg:ml-auto">
            <div className="space-y-8">
              {/* Contact */}
              <section className="space-y-4 border-b pb-6">
                <div className="space-y-1">
                  <Skeleton className="h-7 w-52" />
                  <Skeleton className="h-5 w-64 max-w-full" />
                </div>
                <div className="space-y-3">
                  {/* h3 text-lg -> 28px line box */}
                  <Skeleton className="h-7 w-36" />
                  <FieldSkeleton />
                  <div className="flex items-center gap-2 pt-1">
                    <Skeleton className="size-4 shrink-0 rounded-sm" />
                    <Skeleton className="h-5 w-56 max-w-full" />
                  </div>
                </div>
              </section>

              {/* Delivery — country, name pair, address, apartment, city pair */}
              <section className="space-y-3">
                <Skeleton className="h-7 w-28" />
                <div className="space-y-3">
                  <FieldSkeleton />
                  <div className="grid grid-cols-2 gap-3">
                    <FieldSkeleton />
                    <FieldSkeleton />
                  </div>
                  <FieldSkeleton />
                  <FieldSkeleton />
                  <div className="grid grid-cols-2 gap-3">
                    <FieldSkeleton />
                    <FieldSkeleton />
                  </div>
                </div>
              </section>

              <Separator />

              {/* Shipping method — one rate row. Stores usually expose a single
                  default rate, and the "shipping unavailable" alert that
                  replaces it is the same ~92px tall, so one row is the closest
                  fit for both states. */}
              <section className="space-y-3">
                <Skeleton className="h-7 w-40" />
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-4 shrink-0 rounded-full" />
                      <Skeleton className="h-5 w-36" />
                    </div>
                    <Skeleton className="h-5 w-14 shrink-0" />
                  </div>
                </div>
              </section>

              {/* Payment */}
              <section className="space-y-4">
                <div className="space-y-2">
                  <Skeleton className="h-7 w-40" />
                  <Skeleton className="h-5 w-64 max-w-full" />
                </div>
                {/* 4 method rows (~48px each) with the selected one expanded by
                    a ~53px detail panel — matches the real RadioGroup, which
                    only ever expands the active method. */}
                <div className="overflow-hidden rounded-lg border bg-background">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <ChoiceRow key={i} withBorder={i > 0} />
                  ))}
                  <div className="border-t">
                    <ChoiceRow />
                    <div className="space-y-1.5 border-t bg-muted/20 px-4 py-3">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                </div>
              </section>

              {/* Billing address */}
              <section className="space-y-3">
                <Skeleton className="h-7 w-40" />
                <div className="overflow-hidden rounded-lg border">
                  <div className="flex items-center gap-3 p-4">
                    <Skeleton className="size-4 shrink-0 rounded-full" />
                    <Skeleton className="h-5 w-52 max-w-full" />
                  </div>
                  <div className="border-t" />
                  <div className="flex items-center gap-3 p-4">
                    <Skeleton className="size-4 shrink-0 rounded-full" />
                    <Skeleton className="h-5 w-56 max-w-full" />
                  </div>
                </div>
              </section>

              {/* Submit */}
              <Skeleton className="h-12 w-full rounded-md" />
            </div>
          </div>
        </div>

        {/* Right column — order summary rail */}
        <aside className="border-t bg-zinc-50 px-4 py-8 lg:border-t-0 lg:px-12 lg:py-12 dark:bg-background">
          {/* lg:top-28 == the 112px default of --checkout-summary-offset */}
          <div className="mx-auto max-w-110 lg:sticky lg:top-28 lg:mx-0">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <Skeleton className="h-7 w-36" />
                <Skeleton className="h-5 w-16" />
              </div>

              {/* Subtotal / shipping / tax / promo rows — text-sm, so h-5
                  keeps the 28px row pitch. The coupon field sits inside this
                  same block in the real summary, not as a sibling. */}
              <div className="space-y-2">
                {[
                  ["w-16", "w-20"],
                  ["w-20", "w-14"],
                  ["w-24", "w-12"],
                  ["w-24", "w-20"],
                ].map(([label, value], i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Skeleton className={cn("h-5", label)} />
                    <Skeleton className={cn("h-5", value)} />
                  </div>
                ))}
                <Skeleton className="h-9 w-full rounded-lg" />
              </div>

              <Separator />

              {/* Total */}
              <div className="flex items-baseline justify-between">
                <Skeleton className="h-6 w-14" />
                <Skeleton className="h-8 w-32" />
              </div>

              <Separator />

              {/* Cart line items — 72px thumb, then title / qty / price all
                  stacked in the same text column (no right-hand price cell) */}
              <div className="space-y-5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-4">
                    <Skeleton className="h-18 w-18 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <Skeleton className="mb-1 h-5 w-4/5" />
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="mt-1 h-5 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
