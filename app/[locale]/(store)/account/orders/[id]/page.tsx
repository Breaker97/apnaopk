import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OrderDetails } from "@/components/account/order-details";
import { setRequestLocale, getTranslations } from "next-intl/server";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function OrderDetailPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale });

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Back link */}
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/${locale}/account/orders`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("orders.backToOrders")}
          </Link>
        </Button>
      </div>

      {/* Order Details */}
      <Suspense fallback={<OrderDetailsSkeleton />}>
        <OrderDetails orderId={id} locale={locale} />
      </Suspense>
    </div>
  );
}

function OrderDetailsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-6 w-24" />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>

      <div className="space-y-4">
        <Skeleton className="h-6 w-24" />
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}
