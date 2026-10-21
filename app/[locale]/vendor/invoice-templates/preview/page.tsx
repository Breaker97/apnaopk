import "server-only";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { TemplatePreviewScreen } from "@/components/invoice-templates/preview";
import { InvoiceTemplateScopeProvider } from "@/components/invoice-templates/template-scope";
import { previewPageSource } from "@/lib/invoice-templates/editor-pages";
import { requireVendorTemplatePage } from "@/lib/invoice-templates/vendor-page-access";

/**
 * The vendor owner's template preview (Phase 7): `?id=` one of the store's own
 * templates (another's is a 404) or `?preset=&lang=`; `?items=`; `?order=` one
 * of the store's own orders, read through the vendor `print-context` (their
 * consignment, their store as the business). Read-only.
 */
interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function VendorInvoiceTemplatePreviewPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  const { owner } = await requireVendorTemplatePage(locale);

  const preview = await previewPageSource(owner, { locale, search });
  if (!preview) notFound();
  return (
    <InvoiceTemplateScopeProvider scope="vendor">
      <TemplatePreviewScreen source={preview.source} items={preview.items} order={preview.order} />
    </InvoiceTemplateScopeProvider>
  );
}
