import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
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

      {/* Address Manager */}
      <Suspense fallback={<AddressesSkeleton />}>
        <AddressManager />
      </Suspense>
    </div>
  );
}

function AddressesSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-52 rounded-xl" />
      ))}
    </div>
  );
}
