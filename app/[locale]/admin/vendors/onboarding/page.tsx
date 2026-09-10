import { Store } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { getOnboardingTemplate } from "@/models/onboardingTemplate.model";
import { buildEditableTemplate } from "@/lib/vendors/onboarding-template-editor";
import { resolveOnboardingConfig } from "@/lib/vendors/vendor-onboarding";
import { Card, CardContent } from "@/components/ui/card";
import { OnboardingFlowBuilder } from "@/components/admin/onboarding-flow-builder";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminVendorOnboardingPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  await connectDB();
  const settings = await getSettings();
  const marketplaceEnabled = Boolean(settings.multiVendorMode?.enabled);

  if (!marketplaceEnabled) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardContent className="space-y-2 py-10">
            <Store className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Marketplace mode is off</h2>
            <p className="text-sm text-muted-foreground">
              Enable multi-vendor mode to customize the vendor onboarding flow.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stored = await getOnboardingTemplate();
  const template = buildEditableTemplate(
    stored,
    settings.vendorConfig?.requiredDocuments ?? [],
  );
  // The preview tab renders the real plan cards / commission the storefront
  // subscription step would show.
  const onboardingConfig = await resolveOnboardingConfig();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <OnboardingFlowBuilder
        initialTemplate={template}
        plansEnabled={onboardingConfig.plansEnabled}
        marketplaceEnabled={marketplaceEnabled}
        plans={onboardingConfig.plans}
        defaultCommissionRate={onboardingConfig.defaultCommissionRate}
      />
    </div>
  );
}
