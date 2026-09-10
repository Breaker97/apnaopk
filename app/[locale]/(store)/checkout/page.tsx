import { Suspense } from "react";
import { CheckoutChrome } from "@/components/checkout/checkout-chrome";
import { CheckoutContent } from "@/components/checkout/checkout-content";
import { CheckoutSkeleton } from "@/components/checkout/checkout-skeleton";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string }>;
}

// CheckoutContent reads useSearchParams(), so this boundary is required — SSR
// bails out here and the skeleton is what ships in the HTML until hydration.
// It shares the fallback with checkout/loading.tsx so navigating in and then
// hydrating shows one continuous frame instead of two different skeletons.
export default async function CheckoutPage({ params }: PageProps) {
  const { locale } = await params;
  const { checkoutSettings, storeName, logoUrl, darkModeLogoUrl } =
    await getStorefrontSettings();

  return (
    <CheckoutChrome
      locale={locale}
      settings={checkoutSettings}
      brand={{ storeName, logoUrl, darkModeLogoUrl }}
    >
      <Suspense fallback={<CheckoutSkeleton />}>
        <CheckoutContent />
      </Suspense>
    </CheckoutChrome>
  );
}
