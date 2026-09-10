import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth/auth";
import { USER_ROLES } from "@/config/app.config";
import { type Locale } from "@/config/i18n.config";
import { SectionPreviewSizer } from "@/components/store/section-preview-sizer";
import { StoreSections } from "@/components/store/store-sections";
import {
  pickPreviewSection,
  resolveDraftPage,
} from "@/lib/storefront/pages/draft-preview";
import type { SectionRenderContext } from "@/lib/storefront/sections/types";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string; handle?: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** Admin-only scaffolding; never something a crawler should keep. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * ONE draft section, rendered by the storefront's own component with live
 * data — the frame at the top of a builder row (`?section=<id>`), or one
 * block of it beside a block-list row (`&block=<id>`). The same handles as
 * /draft (home, `template/<type>`, `<landing-handle>`), minus the chrome
 * groups, which have no per-section frames.
 *
 * Reached only through /api/admin/store-pages/preview; anyone else 404s
 * rather than learning the section id space exists.
 */
export default async function SectionPreviewPage({
  params,
  searchParams,
}: PageProps) {
  const { locale, handle: handleParts } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user?.role !== USER_ROLES.ADMIN) {
    notFound();
  }

  const query = await searchParams;
  const sectionId = typeof query.section === "string" ? query.section : "";
  const blockId = typeof query.block === "string" ? query.block : "";
  if (!sectionId || handleParts?.[0] === "group") notFound();

  const settings = await getStorefrontSettings();
  const baseCtx: SectionRenderContext = {
    locale: locale as Locale,
    defaultLanguage: settings.defaultLanguage,
    isMultiVendorEnabled: settings.isMultiVendorEnabled,
    themeId: settings.theme.id,
    themeSettings: settings.theme.settings,
    preview: true,
  };
  const page = await resolveDraftPage(handleParts, query, baseCtx);
  if (!page) notFound();

  return (
    <div data-section-preview>
      <StoreSections
        sections={pickPreviewSection(page.sections, sectionId, blockId)}
        ctx={page.ctx}
      />
      <SectionPreviewSizer />
    </div>
  );
}
