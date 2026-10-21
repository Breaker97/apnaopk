import "server-only";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { TemplateEditorScreen } from "@/components/invoice-templates/editor";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { draftEditorSource } from "@/lib/invoice-templates/editor-pages";
import { PLATFORM_OWNER } from "@/lib/invoice-templates/owner";

/**
 * A new template, as an unsaved draft (docs §4.10): `?category=` online | pos |
 * sticker, `?preset=` a built-in preset of that category (otherwise a blank
 * canvas on the category's default size), `?lang=` en | bn for the preset's
 * text. Nothing is created until the draft's first Save.
 */
interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function NewInvoiceTemplatePage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);

  const draft = await draftEditorSource(PLATFORM_OWNER, { locale, search });
  if (!draft) notFound();
  return <TemplateEditorScreen demo={isDemoModeEnabled()} takenNames={draft.takenNames} source={draft.source} />;
}
