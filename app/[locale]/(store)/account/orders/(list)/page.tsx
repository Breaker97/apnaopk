import { Suspense } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { CustomerOrdersList } from "@/components/account/orders-list";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function OrdersPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale });

  return (
    <div className="space-y-6">
      {/* Page Header. The title block is desktop-only — the mobile identity
          strip carries it — but Pre-orders stays reachable on every viewport. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="hidden lg:block">
          <h1 className="text-xl font-bold sm:text-2xl">{t("orders.title")}</h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            {t("orders.subtitle")}
          </p>
        </div>
        <Button variant="outline" className="min-h-11 sm:min-h-9" asChild>
          <Link href={`/${locale}/account/orders/pre-orders`}>
            <CalendarClock className="mr-2 h-4 w-4" />
            {t("orders.preOrders")}
          </Link>
        </Button>
      </div>

      {/* Orders List */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("orders.orderHistory")}
          </CardTitle>
          <CardDescription>
            {t("orders.historyDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<OrdersListSkeleton />}>
            <CustomerOrdersList locale={locale} filter="regular" />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

function OrdersListSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border p-4 space-y-3">
          <div className="flex justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-6 w-20" />
          </div>
          <Skeleton className="h-4 w-48" />
          <div className="flex justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}
