import { getTranslations, setRequestLocale } from "next-intl/server";
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
      <PreferencesForm />
    </div>
  );
}
