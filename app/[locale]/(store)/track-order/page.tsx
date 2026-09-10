import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { TrackOrderContent } from "@/components/store/track-order-content";

interface TrackOrderPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ orderId?: string; orderNumber?: string }>;
}

export const metadata: Metadata = {
  title: "Track Order",
  description: "Track your order using your order number and checkout contact details.",
};

export default async function TrackOrderPage({
  params,
  searchParams,
}: TrackOrderPageProps) {
  const { locale } = await params;
  const { orderId, orderNumber } = await searchParams;
  setRequestLocale(locale);

  return (
    <TrackOrderContent
      initialOrderNumber={orderNumber || orderId || ""}
    />
  );
}
