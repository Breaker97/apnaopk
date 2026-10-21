import "server-only";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { TemplateEditorScreen } from "@/components/invoice-templates/editor";
import { InvoiceTemplateScopeProvider } from "@/components/invoice-templates/template-scope";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { draftEditorSource } from "@/lib/invoice-templates/editor-pages";
import { requireVendorTemplatePage } from "@/lib/invoice-templates/vendor-page-access";

/**
 * A new template for the vendor owner's store, as an unsaved draft (Phase 7):
 * the admin's `?category=&preset=&lang=`, the suggested name free among the
 * store's own templates. The first Save creates it under the store.
 */
interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function NewVendorInvoiceTemplatePage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  const { owner, canEdit } = await requireVendorTemplatePage(locale);

  const draft = await draftEditorSource(owner, { locale, search });
  if (!draft) notFound();
  return (
    <InvoiceTemplateScopeProvider scope="vendor">
      <TemplateEditorScreen
        demo={isDemoModeEnabled()}
        readOnly={!canEdit}
        takenNames={draft.takenNames}
        source={draft.source}
        storeId={owner.kind === "vendor" ? owner.vendorId : undefined}
      />
    </InvoiceTemplateScopeProvider>
  );
}
