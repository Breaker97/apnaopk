import { Suspense } from "react";
import { CheckoutChrome } from "@/components/checkout/checkout-chrome";
import { CheckoutSuccessContent } from "@/components/checkout/success-content";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function CheckoutSuccessPage({ params }: PageProps) {
  const { locale } = await params;
  const { checkoutSettings, storeName, logoUrl, darkModeLogoUrl } =
    await getStorefrontSettings();

  return (
    <CheckoutChrome
      locale={locale}
      settings={checkoutSettings}
      brand={{ storeName, logoUrl, darkModeLogoUrl }}
    >
      <Suspense fallback={<SuccessSkeleton />}>
        <CheckoutSuccessContent />
      </Suspense>
    </CheckoutChrome>
  );
}

function SuccessSkeleton() {
  return (
    <div className="container mx-auto px-4 py-16">
      <Card className="max-w-lg mx-auto text-center">
        <CardContent className="pt-8 pb-8">
          <Skeleton className="h-20 w-20 mx-auto rounded-full mb-4" />
          <Skeleton className="h-8 w-48 mx-auto mb-2" />
          <Skeleton className="h-4 w-64 mx-auto mb-6" />
          <Skeleton className="h-12 w-full mb-4" />
          <div className="flex gap-3 justify-center">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
