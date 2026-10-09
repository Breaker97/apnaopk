import { getTranslations, setRequestLocale } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientSuspense } from "@/components/common/client-suspense";
import { CustomerQuotes } from "@/components/account/customer-quotes";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AccountQuotesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("account");

  return (
    <div className="space-y-6">
      {/* Desktop only; the mobile identity strip titles this page. */}
      <div className="hidden lg:block">
        <h1 className="text-xl font-bold sm:text-2xl">{t("quotes")}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          {t("quotesDesc")}
        </p>
      </div>

      <ClientSuspense
        fallback={
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-xl" />
            ))}
          </div>
        }
      >
        <CustomerQuotes />
      </ClientSuspense>
    </div>
  );
}
