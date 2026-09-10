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
    description: `Learn how returns, refunds, exchanges, eligibility, and refund timing work at ${storeName}.`,
  };
}

export default async function ReturnsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { contentPages, storeEmail, storeName, storePhone } =
    await getStorefrontSettings();
  if (!contentPages.returns.visible) {
    notFound();
  }

  return (
    <ReturnPolicyPageView
      locale={locale}
      page={contentPages.returns}
      storeName={storeName}
      supportEmail={storeEmail}
      supportPhone={storePhone}
    />
  );
}
