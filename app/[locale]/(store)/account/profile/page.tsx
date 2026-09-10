import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileForm } from "@/components/account/profile-form";
import { setRequestLocale, getTranslations } from "next-intl/server";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function ProfilePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale });

  return (
    <div className="space-y-6">
      {/* Page Header — desktop only. On mobile the account layout's sticky
          identity strip already carries this title and a back affordance. */}
      <div className="hidden lg:block">
        <h1 className="text-xl font-bold sm:text-2xl">{t("profile.title")}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          {t("profile.subtitle")}
        </p>
      </div>

      {/* Profile Form */}
      <Suspense fallback={<ProfileFormSkeleton />}>
        <ProfileForm />
      </Suspense>
    </div>
  );
}

function ProfileFormSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
      <Skeleton className="h-10 w-32 ml-auto" />
    </div>
  );
}
