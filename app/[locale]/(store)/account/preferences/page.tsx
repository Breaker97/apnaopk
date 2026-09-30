import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
    <div className="space-y-6">
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

/** Mirrors the form: the Save bar, then the switch cards. */
function PreferencesSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex justify-end">
        <Skeleton className="h-8 w-20" />
      </div>
      {[5, 1].map((rows, card) => (
        <Card key={card}>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent className="divide-y">
            {Array.from({ length: rows }).map((_, row) => (
              <div
                key={row}
                className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-4 w-72 max-w-full" />
                </div>
                <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
