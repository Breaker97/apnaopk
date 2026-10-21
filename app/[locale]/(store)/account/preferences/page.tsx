import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientSuspense } from "@/components/common/client-suspense";
import { PreferencesForm } from "@/components/account/preferences-form";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function PreferencesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Desktop only; the mobile identity strip titles this page. */}
      <div className="hidden lg:block">
        <h1 className="text-xl font-bold sm:text-2xl">
          {t("customerProfile.preferences")}
        </h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          {t("customerProfile.preferencesDesc")}
        </p>
      </div>
      <ClientSuspense fallback={<PreferencesSkeleton />}>
        <PreferencesForm />
      </ClientSuspense>
    </div>
  );
}

/** Mirrors the form: one card, three groups of switch rows. */
function PreferencesSkeleton() {
  return (
    <div aria-busy="true">
      <Card className="gap-0 divide-y overflow-hidden py-0">
        {[2, 2, 3].map((rows, group) => (
          <div key={group}>
            <div className="px-4 pt-5 pb-1 sm:px-6">
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="divide-y">
              {Array.from({ length: rows }).map((_, row) => (
                <div
                  key={row}
                  className="flex items-center justify-between gap-6 px-4 py-4 sm:px-6"
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-40 max-w-full" />
                    <Skeleton className="h-4 w-72 max-w-full" />
                  </div>
                  <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
