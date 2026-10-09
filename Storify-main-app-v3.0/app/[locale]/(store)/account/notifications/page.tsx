import { setRequestLocale } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientSuspense } from "@/components/common/client-suspense";
import { CustomerNotifications } from "@/components/account/customer-notifications";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NotificationsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="space-y-6">
      {/* Desktop only; the mobile identity strip titles this page. */}
      <div className="hidden lg:block">
        <h1 className="text-xl font-bold sm:text-2xl">Notifications</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Follow every update for your orders.
        </p>
      </div>

      <ClientSuspense fallback={<NotificationsSkeleton />}>
        <CustomerNotifications locale={locale} />
      </ClientSuspense>
    </div>
  );
}

/** Mirrors the panel: its header, the tab row, then a few rows. */
function NotificationsSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border bg-card" aria-busy="true">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>
      <div className="flex gap-2 border-b px-5 py-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24" />
        ))}
      </div>
      <div className="divide-y">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3 px-5 py-4">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
