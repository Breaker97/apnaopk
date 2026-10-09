import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { cn } from "@/lib/utils";

/**
 * Loading placeholders for the Online Store sales channel — one per screen in
 * the sidebar (Customize, Themes, Pages, Navigation, Sliders, Checkout,
 * Product Card) and for the editors those screens open.
 *
 * Every skeleton here is used TWICE, and the pair is the point:
 *
 *  - the route's `loading.tsx` paints it the moment a link is clicked, so a
 *    navigation streams a shell instead of holding the old screen while the
 *    server answers;
 *  - the client editor's own loading branch renders the SAME element while it
 *    fetches its settings.
 *
 * With only the first, every studio would swap the shell for the centered
 * spinner it used to show and the screen would read as two separate loads.
 * With only the second, nothing appears until the RSC payload lands.
 *
 * They stand in for real layout, not for "content is coming": each mirrors its
 * screen's wrapper width, sticky bar and card rhythm so the arriving page
 * settles into the same boxes instead of reflowing the viewport.
 */

const MAX_WIDTH = {
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-7xl",
} as const;

type StudioWidth = keyof typeof MAX_WIDTH;

/** Label over a single-line control. */
function Field({ labelWidth = "w-24" }: { labelWidth?: string }) {
  return (
    <div className="space-y-2">
      <Skeleton className={cn("h-4", labelWidth)} />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

/** Bordered row with a label pair on the left and a switch on the right. */
function ToggleRow({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-lg border p-3",
        className,
      )}
    >
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
      <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
    </div>
  );
}

function SkeletonCard({
  titleWidth = "w-32",
  description = false,
  className,
  contentClassName,
  children,
}: {
  titleWidth?: string;
  description?: boolean;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("gap-2", className)}>
      <CardHeader className="space-y-2">
        <Skeleton className={cn("h-5", titleWidth)} />
        {description ? <Skeleton className="h-3 w-52" /> : null}
      </CardHeader>
      <CardContent className={cn("space-y-4", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * The shell every studio in this area shares: a centered column, the sticky
 * action bar (`AdminFormStickyHeader` with the same flush overrides the real
 * editors pass it), an optional subtitle, then the body.
 */
function StudioShell({
  width = "6xl",
  actions = 3,
  badge = true,
  titleWidth = "w-40",
  headerDescription = false,
  subtitle = false,
  spacing = "6",
  children,
}: {
  width?: StudioWidth;
  actions?: number;
  badge?: boolean;
  titleWidth?: string;
  headerDescription?: boolean;
  subtitle?: boolean;
  spacing?: "4" | "6";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full",
        MAX_WIDTH[width],
        spacing === "6" ? "space-y-6" : "space-y-4",
      )}
    >
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title={<Skeleton className={cn("h-6", titleWidth)} />}
        description={
          headerDescription ? (
            // A span, not <Skeleton/>: the bar renders its description inside
            // a <p>, and a nested <div> hydrates as a mismatch.
            <span className="block h-4 w-64 animate-pulse rounded-md bg-black/[0.06] dark:bg-white/[0.08]" />
          ) : undefined
        }
        status={badge ? <Skeleton className="h-5 w-16 rounded-full" /> : null}
        actions={Array.from({ length: actions }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-20" />
        ))}
      />

      {subtitle ? <Skeleton className="h-4 w-full max-w-2xl" /> : null}

      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Sidebar screens
 * ---------------------------------------------------------------------- */

/** Online Store — the channel hub's four section cards. */
export function OnlineStoreHubSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-28 rounded-md" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-full max-w-3xl" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="border-border/70 bg-card/95">
            <CardHeader className="space-y-3">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-36" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * Customize — the section builder. The page bar is pinned and bleeds through
 * the admin shell's padding exactly as the real one does, so the rows below it
 * do not jump when the builder mounts.
 */
export function StorePageBuilderSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="space-y-4">
        <div className="sticky top-[var(--dashboard-header-height,4rem)] z-30 -mx-6 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-6 py-2">
          <Skeleton className="h-7 w-48" />
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-9 w-9" />
            <Skeleton className="hidden h-9 w-32 xl:block" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>

        {/* The publish-state notice the builder always carries. */}
        <Skeleton className="h-11 w-full rounded-md" />

        <div className="space-y-4">
          <div>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index}>
                <Card className="gap-0 rounded-md p-0">
                  <div className="flex items-center gap-1.5 px-4 py-3.5">
                    <Skeleton className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-60 max-w-full" />
                    </div>
                    <Skeleton className="h-8 w-8 shrink-0" />
                    <Skeleton className="h-8 w-8 shrink-0" />
                    <Skeleton className="h-8 w-8 shrink-0" />
                  </div>
                </Card>
                {/* The hairline + "Add section" affordance between rows. */}
                <div className="flex items-center gap-2 py-2">
                  <span className="h-px flex-1 bg-border" />
                  <Skeleton className="h-7 w-28 rounded-full" />
                  <span className="h-px flex-1 bg-border" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Themes — the tab strip over the theme card gallery. */
export function ThemeGallerySkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-5 w-full max-w-3xl" />
      </div>

      <div className="space-y-6">
        <div className="flex gap-1 border-b px-1">
          {["w-28", "w-24", "w-32"].map((width, index) => (
            <div key={index} className="px-4 py-3">
              <Skeleton className={cn("h-4", width)} />
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card
              key={index}
              className="h-full gap-3 border-border/70 bg-card/95 py-4"
            >
              <CardHeader className="gap-3 px-4">
                <Skeleton className="aspect-[4/3] w-full rounded-lg" />
                <div className="space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </CardHeader>
              <CardContent className="px-4">
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Themes → Theme settings — the token workspace. It owns the viewport height,
 * so the placeholder claims the same box or the page grows a scrollbar it will
 * lose a moment later.
 */
export function ThemeEditorSkeleton() {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[560px] flex-col overflow-hidden rounded-xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-48" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="hidden h-4 w-28 sm:block" />
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>

      <div className="flex shrink-0 gap-1 overflow-hidden border-b border-border/70 px-3">
        {["w-16", "w-20", "w-14", "w-20", "w-16"].map((width, index) => (
          <div key={index} className="px-3 py-2.5">
            <Skeleton className={cn("h-4", width)} />
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col border-r border-border/70">
          <div className="space-y-2 border-b border-border/70 px-4 py-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-56" />
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-hidden px-4 py-4">
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-6 w-full rounded-md" />
            {Array.from({ length: 5 }).map((_, index) => (
              <Field key={index} labelWidth="w-28" />
            ))}
          </div>
        </div>
        <div className="hidden min-h-0 p-4 xl:block">
          <Skeleton className="h-full w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** Pages — the landing-page card over the store pages manager. */
export function PagesManagerSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <Card className="border-border/70">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-full max-w-md" />
          </div>
          <Skeleton className="h-8 w-28 shrink-0" />
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border rounded-md border border-border">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-5 w-14 rounded-md" />
                <Skeleton className="h-8 w-8" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <div className="rounded-xl border border-border bg-card px-5 py-5 shadow-sm md:px-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <Skeleton className="h-8 w-44" />
              <Skeleton className="h-5 w-full max-w-lg" />
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {["w-24", "w-20", "w-20"].map((width, index) => (
                  <Skeleton
                    key={index}
                    className={cn("h-6 rounded-full", width)}
                  />
                ))}
              </div>
            </div>
            <Skeleton className="h-9 w-full rounded-lg sm:w-32" />
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-4 px-4 pt-4 sm:px-5">
            <Skeleton className="h-5 w-28" />
            <div className="flex items-center gap-1">
              <Skeleton className="size-8 rounded-md" />
              <Skeleton className="size-8 rounded-md" />
            </div>
          </div>

          <div className="flex items-center gap-5 border-b border-border px-4 sm:px-5">
            {["w-16", "w-20", "w-16"].map((width, index) => (
              <div key={index} className="py-3">
                <Skeleton className={cn("h-4", width)} />
              </div>
            ))}
          </div>

          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center gap-4 px-4 py-4 sm:px-5"
              >
                <Skeleton className="size-10 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56 max-w-full" />
                </div>
                <Skeleton className="hidden h-4 w-24 md:block" />
                <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
                <Skeleton className="h-8 w-8 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Navigation — the three surface cards (header, footer, mega menu). */
export function NavigationHubSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} className="h-full gap-3">
            <CardHeader>
              <Skeleton className="mb-2 h-10 w-10 rounded-lg" />
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-4 w-4" />
              </div>
              <div className="space-y-2 pt-1">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </CardHeader>
            <CardContent />
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * The slider list on its own — collapsed cards, each previewing its
 * slideshow, plus the add button. Split out because the manager already knows
 * its own heading by the time it fetches: it keeps the real title and swaps
 * only the list, so the copy does not blink in behind a grey bar.
 */
export function SliderCardsSkeleton() {
  return (
    <>
      {Array.from({ length: 2 }).map((_, index) => (
        <div
          key={index}
          className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5"
        >
          <Skeleton className="mb-2 h-4 w-36" />
          <Skeleton className="h-56 w-full rounded-xl sm:h-64" />
        </div>
      ))}

      <Skeleton className="h-11 w-44 rounded-full" />
    </>
  );
}

/** Sliders — the whole screen, for the route's first paint. */
export function SlidersManagerSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>

      <SliderCardsSkeleton />
    </div>
  );
}

/** Checkout — the branding form behind the fixed checkout flow. */
export function CheckoutBuilderSkeleton() {
  return (
    <StudioShell width="4xl" actions={3} subtitle>
      <SkeletonCard titleWidth="w-24" description contentClassName="pt-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </SkeletonCard>

      <SkeletonCard titleWidth="w-40" description>
        <Field labelWidth="w-32" />
        <ToggleRow />
        <Field labelWidth="w-28" />
      </SkeletonCard>

      <SkeletonCard titleWidth="w-28" description contentClassName="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            <Skeleton className="h-9 w-full sm:w-48" />
            <Skeleton className="h-9 w-full sm:flex-1" />
            <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
          </div>
        ))}
      </SkeletonCard>
    </StudioShell>
  );
}

/** Product Card — the live card preview beside its control stack. */
export function ProductCardBuilderSkeleton() {
  return (
    <StudioShell actions={2} subtitle>
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div>
          <Skeleton className="mb-2 h-4 w-28" />
          <div className="flex justify-center rounded-xl border border-border bg-background px-4 py-10">
            <div className="w-[228px] max-w-full space-y-2">
              <Skeleton className="aspect-square w-full rounded-lg" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
          <Skeleton className="mt-2 h-3 w-56" />
        </div>

        <div className="space-y-6">
          <SkeletonCard titleWidth="w-20">
            <Field labelWidth="w-20" />
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded-lg border p-3"
              >
                <Skeleton className="h-4 w-4 shrink-0" />
                <Skeleton className="h-4 flex-1 max-w-40" />
                <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
              </div>
            ))}
          </SkeletonCard>

          <SkeletonCard titleWidth="w-16">
            <Field labelWidth="w-24" />
            <Field labelWidth="w-28" />
            <ToggleRow />
          </SkeletonCard>
        </div>
      </div>
    </StudioShell>
  );
}

/** Navigation → Header — the pinned header preview over its control stack. */
export function HeaderStudioSkeleton() {
  return (
    <StudioShell width="7xl" actions={3} spacing="4">
      <div className="space-y-3 pb-4 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-8 w-44" />
        </div>
        {/* The storefront header as it will paint: bar, row, category rail. */}
        <div className="overflow-hidden rounded-xl border border-border">
          <Skeleton className="h-8 w-full rounded-none" />
          <div className="flex items-center gap-4 px-4 py-4">
            <Skeleton className="h-8 w-32 shrink-0" />
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          </div>
          <div className="flex items-center gap-4 border-t border-border px-4 py-3">
            {["w-24", "w-20", "w-16", "w-20"].map((width, index) => (
              <Skeleton key={index} className={cn("h-4", width)} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <SkeletonCard titleWidth="w-24" description>
            <div className="grid gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          </SkeletonCard>
          <SkeletonCard titleWidth="w-28" description>
            {Array.from({ length: 3 }).map((_, index) => (
              <ToggleRow key={index} />
            ))}
          </SkeletonCard>
        </div>
        <div className="space-y-4">
          <SkeletonCard titleWidth="w-24">
            {Array.from({ length: 4 }).map((_, index) => (
              <Field key={index} labelWidth="w-20" />
            ))}
          </SkeletonCard>
        </div>
      </div>
    </StudioShell>
  );
}

/** Navigation → Footer — column builder on the left, settings rail right. */
export function FooterBuilderSkeleton() {
  return (
    <StudioShell actions={3}>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <SkeletonCard titleWidth="w-20" description>
            <Field labelWidth="w-24" />
            <Field labelWidth="w-32" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </SkeletonCard>
          <SkeletonCard titleWidth="w-32" description contentClassName="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="space-y-2 rounded-lg border p-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </SkeletonCard>
        </div>
        <div className="space-y-4">
          <SkeletonCard titleWidth="w-28" description>
            {Array.from({ length: 3 }).map((_, index) => (
              <ToggleRow key={index} />
            ))}
          </SkeletonCard>
          <SkeletonCard titleWidth="w-24">
            {Array.from({ length: 3 }).map((_, index) => (
              <Field key={index} labelWidth="w-24" />
            ))}
          </SkeletonCard>
        </div>
      </div>
    </StudioShell>
  );
}

/** Navigation → Mega menu — the menu form's tab strip over its canvas. */
export function MenuFormSkeleton() {
  return (
    <StudioShell width="7xl" actions={2} badge={false} spacing="4">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg border p-1">
            {["w-20", "w-16", "w-20"].map((width, index) => (
              <Skeleton key={index} className={cn("h-9 rounded-md", width)} />
            ))}
          </div>
          <Skeleton className="h-9 w-36" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-2 rounded-xl border border-border p-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full rounded-md" />
            ))}
          </div>
          <div className="rounded-xl border border-border p-4">
            <Skeleton className="mb-4 h-5 w-40" />
            <div className="grid gap-4 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  {Array.from({ length: 4 }).map((_, row) => (
                    <Skeleton key={row} className="h-4 w-full" />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </StudioShell>
  );
}

/* -------------------------------------------------------------------------
 * Pages → editors
 * ---------------------------------------------------------------------- */

/**
 * The plain content pages (Terms, Privacy, Cookies, Accessibility) and the
 * FAQ editor: one card holding a title field, the rich-text editor, and the
 * storefront visibility switch. The editor box is deliberately tall — the
 * real one is `min-h-[360px]`, and a short placeholder would drop the page
 * height by a third the moment it mounts.
 */
export function ContentPageEditorSkeleton() {
  return (
    <StudioShell actions={3} badge={false} headerDescription spacing="4">
      <Card className="rounded-sm border border-border bg-card p-4 shadow-[0_3px_14px_rgba(15,23,42,0.06)] md:p-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-[360px] w-full rounded-md" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <ToggleRow className="rounded-xl" />
          </div>
        </div>
      </Card>
    </StudioShell>
  );
}

/**
 * The composed page editors — About, Contact, Return & Refund, and the custom
 * page forms. They differ only in how wide the side rail is, so they share one
 * placeholder: `side` picks the grid, `none` for About's even split.
 */
export function PageEditorSkeleton({
  side = "wide",
  mainCards = 2,
  actions = 3,
}: {
  side?: "none" | "wide" | "narrow";
  mainCards?: number;
  actions?: number;
}) {
  const grid =
    side === "none"
      ? "xl:grid-cols-2"
      : side === "narrow"
        ? "lg:grid-cols-[1fr_360px]"
        : "xl:grid-cols-[minmax(0,1fr)_420px]";

  return (
    <StudioShell actions={actions} badge={false} headerDescription>
      <div className={cn("grid gap-4", grid)}>
        <div className="space-y-4">
          {Array.from({ length: mainCards }).map((_, index) => (
            <SkeletonCard key={index} titleWidth="w-24" description>
              <Field labelWidth="w-28" />
              <Field labelWidth="w-24" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </SkeletonCard>
          ))}
        </div>
        <div className="space-y-4">
          <SkeletonCard titleWidth="w-28" description>
            <Skeleton className="h-40 w-full rounded-lg" />
            <Field labelWidth="w-20" />
          </SkeletonCard>
          <SkeletonCard titleWidth="w-24">
            <ToggleRow className="rounded-xl" />
          </SkeletonCard>
        </div>
      </div>
    </StudioShell>
  );
}
