import { Skeleton } from "@/components/ui/skeleton";
import { ClientSuspense } from "@/components/common/client-suspense";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { AddressManager } from "@/components/account/address-manager";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AddressesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale });

  return (
    <div className="space-y-6">
      {/* Page Header — desktop only; the mobile identity strip carries it. */}
      <h1 className="hidden text-xl font-bold sm:text-2xl lg:block">
        {t("addresses.title")}
      </h1>

      {/* Address Manager — its loading state is this boundary's fallback. */}
      <ClientSuspense fallback={<AddressesSkeleton />}>
        <AddressManager />
      </ClientSuspense>
    </div>
  );
}

/** Same grid and card height as the address cards it stands in for. */
function AddressesSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="min-h-[220px] rounded-xl" />
      ))}
    </div>
  );
}
