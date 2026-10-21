import "server-only";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { TemplateEditorScreen } from "@/components/invoice-templates/editor";
import { InvoiceTemplateScopeProvider } from "@/components/invoice-templates/template-scope";
import { NotFoundError } from "@/lib/api/errors";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { getTemplate, listTemplates } from "@/lib/invoice-templates/service";
import { requireVendorTemplatePage } from "@/lib/invoice-templates/vendor-page-access";

/**
 * One of the vendor owner's own templates, in the editor (Phase 7). Another
 * store's id, the platform's, or none is a 404. Without the edit grant the
 * editor opens read-only.
 */
interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditVendorInvoiceTemplatePage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { owner, canEdit } = await requireVendorTemplatePage(locale);

  const template = await getTemplate(owner, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const others = await listTemplates(owner, { category: template.category });
  const takenNames = others.filter((other) => other.id !== template.id).map((other) => other.name);
  return (
    <InvoiceTemplateScopeProvider scope="vendor">
      <TemplateEditorScreen
        demo={isDemoModeEnabled()}
        readOnly={!canEdit}
        source={{ kind: "saved", template }}
        takenNames={takenNames}
        storeId={owner.kind === "vendor" ? owner.vendorId : undefined}
      />
    </InvoiceTemplateScopeProvider>
  );
}
