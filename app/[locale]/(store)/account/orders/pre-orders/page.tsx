import { Suspense } from "react";
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

export default async function PreOrdersPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale });

  return (
    <div className="space-y-6">
      {/* Kept on mobile: this route sits under /account/orders, so the identity
          strip reads "My Orders" and cannot title this page for us. */}
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">
          {t("orders.preOrders")}
        </h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          {t("orders.preOrdersSubtitle")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {t("orders.preOrderHistory")}
          </CardTitle>
          <CardDescription>
            {t("orders.preOrderHistoryDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<OrdersListSkeleton />}>
            <CustomerOrdersList
              locale={locale}
              filter="preorders"
              emptyTitle={t("orders.noPreOrders")}
              emptyDescription={t("orders.preOrdersStartShopping")}
            />
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
