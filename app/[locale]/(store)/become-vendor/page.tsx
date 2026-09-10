import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { VendorRegistrationForm } from "@/components/vendor/vendor-registration-form";
import { isMultiVendorEnabled } from "@/lib/vendors/multi-vendor";
import { resolveOnboardingConfig } from "@/lib/vendors/vendor-onboarding";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function BecomeVendorPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const multiVendorEnabled = await isMultiVendorEnabled();
  if (!multiVendorEnabled) {
    redirect(`/${locale}`);
  }

  // Seeded server-side so the wizard renders the right number of steps with no
  // flash; the onboarding GET echoes the same shape for deep-link resume.
  const onboardingConfig = await resolveOnboardingConfig();

  const t = await getTranslations({ locale });

  return (
    <div className="bg-muted/30 px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto w-full max-w-4xl">
        <StoreBreadcrumb
          className="mb-8"
          locale={locale}
          items={[{ label: t("vendor.becomeVendor") }]}
        />

        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t("vendor.registration.startSelling")}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {t("vendor.registration.joinUs")}
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-xl shadow-black/4 sm:p-6">
          <Suspense fallback={<FormSkeleton />}>
            <VendorRegistrationForm
              locale={locale}
              config={onboardingConfig}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
    </div>
  );
}
