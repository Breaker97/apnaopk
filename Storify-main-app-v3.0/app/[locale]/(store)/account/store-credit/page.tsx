import { getTranslations, setRequestLocale } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientSuspense } from "@/components/common/client-suspense";
import { CustomerStoreCredit } from "@/components/account/customer-store-credit";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AccountStoreCreditPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("account");
  const title = t("storeCredit");
  const description = t("storeCreditDesc");

  return (
    <div className="space-y-6">
      {/* Desktop only; the mobile identity strip titles this page. */}
      <div className="hidden lg:block">
        <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">{description}</p>
      </div>

      <ClientSuspense
        fallback={
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        }
      >
        <CustomerStoreCredit />
      </ClientSuspense>
    </div>
  );
}
