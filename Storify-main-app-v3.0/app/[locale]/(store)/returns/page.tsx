import { getLocaleRouting } from "@/lib/i18n/locale-routing";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ReturnPolicyPageView } from "@/components/store/return-policy-page-view";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string }>;
}

// Resolved per request so the description names the store, not this app.
export async function generateMetadata(): Promise<Metadata> {
  const { storeName } = await getStorefrontSettings();

  return {
    title: "Return and Refund Policy",
    // No exchanges: the store does not offer them.
    description: `Learn how returns, refunds, eligibility, and refund timing work at ${storeName}.`,
  };
}

export default async function ReturnsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { storeDefault } = await getLocaleRouting();

  const { contentPages, returnWindowDays, storeEmail, storeName, storePhone } =
    await getStorefrontSettings();
  if (!contentPages.returns.visible) {
    notFound();
  }

  return (
    <ReturnPolicyPageView
      locale={locale}
      storeDefault={storeDefault}
      page={contentPages.returns}
      storeName={storeName}
      windowDays={returnWindowDays}
      supportEmail={storeEmail}
      supportPhone={storePhone}
    />
  );
}
