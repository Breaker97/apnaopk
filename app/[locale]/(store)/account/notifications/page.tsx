import { setRequestLocale } from "next-intl/server";
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

      <CustomerNotifications locale={locale} />
    </div>
  );
}
