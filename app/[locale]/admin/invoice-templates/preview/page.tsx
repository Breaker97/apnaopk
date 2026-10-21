import "server-only";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { TemplatePreviewScreen } from "@/components/invoice-templates/preview";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { previewPageSource } from "@/lib/invoice-templates/editor-pages";
import { PLATFORM_OWNER } from "@/lib/invoice-templates/owner";

/**
 * Template preview (docs/INVOICE_TEMPLATE_BUILDER.md §4.2, §7 Phase 2):
 * `?id=` a saved platform template, or `?preset=&lang=` a built-in preset;
 * `?items=` the sample order's length; `?order=` a real order by number or
 * id, read through `print-context`. Admin only; read-only.
 */
interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function InvoiceTemplatePreviewPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);

  const preview = await previewPageSource(PLATFORM_OWNER, { locale, search });
  if (!preview) notFound();
  return <TemplatePreviewScreen source={preview.source} items={preview.items} order={preview.order} />;
}
