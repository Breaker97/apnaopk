import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChangePasswordCard } from "@/components/account/change-password-card";
import { TwoFactorManagementCard } from "@/components/account/two-factor-management-card";
import { RevokeSessionsCard } from "@/components/account/revoke-sessions-card";
import { DeleteAccountCard } from "@/components/account/delete-account-card";
import { isDemoModeEnabled, PROFILE_DEMO_MODE_MESSAGE } from "@/lib/demo-mode";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function SecurityPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const demoMode = {
    enabled: isDemoModeEnabled(),
    message: PROFILE_DEMO_MODE_MESSAGE,
  };

  return (
    <div className="space-y-6">
      {/* Desktop only — the mobile identity strip already titles this page. */}
      <div className="hidden lg:block">
        <h1 className="text-xl font-bold sm:text-2xl">
          {t("account.security")}
        </h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          {t("account.securityDescription")}
        </p>
      </div>

      {/* Demo mode is the server's env flag, known here without a request. */}
      <ChangePasswordCard demoMode={demoMode} />

      {/* Two-Factor Authentication (personal preference; only shown when the
          administrator has enabled the 2FA feature). */}
      <TwoFactorManagementCard />

      <RevokeSessionsCard />

      {/* Last, and apart: deleting the account cannot be undone. */}
      <DeleteAccountCard locale={locale} demoMode={demoMode} />
    </div>
  );
}
