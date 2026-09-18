import { setRequestLocale } from "next-intl/server";
import { CustomerQuotes } from "@/components/account/customer-quotes";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AccountQuotesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="space-y-6">
      {/* Desktop only; the mobile identity strip titles this page. */}
      <div className="hidden lg:block">
        <h1 className="text-xl font-bold sm:text-2xl">Quotes</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Prices you have asked for, and the ones the store has sent back.
        </p>
      </div>

      <CustomerQuotes locale={locale} />
    </div>
  );
}
