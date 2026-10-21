import "server-only";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { TemplateEditorScreen } from "@/components/invoice-templates/editor";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { NotFoundError } from "@/lib/api/errors";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { PLATFORM_OWNER } from "@/lib/invoice-templates/owner";
import { getTemplate, listTemplates } from "@/lib/invoice-templates/service";

/**
 * A saved platform template, where the editor opens (docs §4.10). Another
 * owner's id, or none, is a 404. The editor gets the category's other names
 * so a rename or Save as… to one of them is refused before it is sent.
 */
interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditInvoiceTemplatePage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);

  const template = await getTemplate(PLATFORM_OWNER, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const others = await listTemplates(PLATFORM_OWNER, { category: template.category });
  const takenNames = others.filter((other) => other.id !== template.id).map((other) => other.name);
  return <TemplateEditorScreen demo={isDemoModeEnabled()} source={{ kind: "saved", template }} takenNames={takenNames} />;
}
