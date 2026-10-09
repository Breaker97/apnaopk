import { ShieldCheck } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { Card, CardContent } from "@/components/ui/card";
import { AccessRequestsTable } from "@/components/admin/access-requests-table";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminAccessRequestsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);
  const t = await getTranslations("admin.accessRequests");

  await connectDB();
  const settings = await getSettings();

  // The queue only exists in a marketplace. In single-store mode there is no
  // vendor to ask for anything.
  if (!settings.multiVendorMode?.enabled) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardContent className="space-y-2 py-10">
            <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{t("marketplaceOffTitle")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("marketplaceOffBody")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <AccessRequestsTable locale={locale} />
    </div>
  );
}
