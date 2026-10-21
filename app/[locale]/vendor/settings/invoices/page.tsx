import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { InvoiceTemplateManager } from "@/components/invoice-templates/manager";
import { InvoiceTemplateScopeProvider } from "@/components/invoice-templates/template-scope";
import Link from "@/components/language/link";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { requireVendorTemplatePage } from "@/lib/invoice-templates/vendor-page-access";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Store settings → Invoice Settings (Phase 7, D-07): the vendor owner's own
 * templates for their order page and their POS, in the admin's manager on the
 * vendor scope. Without the edit grant, or on a demo site, it is read-only:
 * the tabs, New (a draft), Edit and Preview still work.
 */
export default async function VendorInvoiceSettingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { canEdit } = await requireVendorTemplatePage(locale);
  const t = await getTranslations({ locale });

  return (
    <div className="w-full space-y-4" data-vendor-invoice-settings="">
      <Link
        href="/vendor/settings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="h-4 w-4 rtl:rotate-180" />
        {t("vendor.settings")}
      </Link>
      <InvoiceTemplateScopeProvider scope="vendor">
        <InvoiceTemplateManager readOnly={isDemoModeEnabled() || !canEdit} />
      </InvoiceTemplateScopeProvider>
    </div>
  );
}
