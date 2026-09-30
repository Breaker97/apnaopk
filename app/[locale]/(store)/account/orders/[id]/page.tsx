import Link from "@/components/language/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClientSuspense } from "@/components/common/client-suspense";
import {
  OrderDetails,
  OrderDetailsSkeleton,
} from "@/components/account/order-details";
import { PageMessages } from "@/components/language/page-messages";
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
          <Link href="/account/orders">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("orders.backToOrders")}
          </Link>
        </Button>
      </div>

      {/* Order Details — the only page that shows returns and refunds. Its
          loading state is this boundary's fallback. */}
      <PageMessages paths={["orders.returns"]}>
        <ClientSuspense fallback={<OrderDetailsSkeleton />}>
          <OrderDetails orderId={id} locale={locale} />
        </ClientSuspense>
      </PageMessages>
    </div>
  );
}
