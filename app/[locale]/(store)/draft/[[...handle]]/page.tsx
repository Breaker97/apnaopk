import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth/auth";
import { USER_ROLES } from "@/config/app.config";
import { type Locale } from "@/config/i18n.config";
import { DraftPreviewPill } from "@/components/store/draft-preview-pill";
import { SectionPreviewBridge } from "@/components/store/section-preview-bridge";
import { StoreSections } from "@/components/store/store-sections";
import { resolveDraftPage } from "@/lib/storefront/pages/draft-preview";
import { getHomePageSections } from "@/lib/storefront/pages/get-home-page";
import { getDraftGroupSections } from "@/lib/storefront/pages/get-template";
import {
  STORE_GROUP_TYPES,
  type StoreGroupType,
} from "@/lib/storefront/pages/handles";
import type { SectionRenderContext } from "@/lib/storefront/sections/types";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string; handle?: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Admin-only DRAFT rendering, on its own route so the real storefront pages
 * never touch a request API for it: `/draft` previews the home draft,
 * `/draft/<handle>` a landing page's, `/draft/template/<type>` a template's
 * — against a sample resource. Living inside the (store) layout keeps the
 * preview honest (real header, footer, theme tokens), and being a separate
 * URL — not a draft-mode cookie — means an admin's ordinary browsing is
 * never silently switched to drafts. One section on its own is a different
 * document — see the chrome-less /section-preview route.
 */
export default async function DraftPreviewPage({
  params,
  searchParams,
}: PageProps) {
  const { locale, handle: handleParts } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user?.role !== USER_ROLES.ADMIN) {
    notFound();
  }

  const settings = await getStorefrontSettings();
  const baseCtx: SectionRenderContext = {
    locale: locale as Locale,
    defaultLanguage: settings.defaultLanguage,
    isMultiVendorEnabled: settings.isMultiVendorEnabled,
    themeId: settings.theme.id,
    themeSettings: settings.theme.settings,
    preview: true,
  };

  if (handleParts?.[0] === "group") {
    // Chrome-group preview: the layout's LIVE copy of this chrome piece is
    // hidden (via data-store-chrome) and the DRAFT group renders in its
    // place, with the published home body as context. Publishing is what
    // changes the real storefront — this page only looks like it.
    const group = handleParts[1];
    if (
      handleParts.length !== 2 ||
      !(STORE_GROUP_TYPES as readonly string[]).includes(group)
    ) {
      notFound();
    }
    const [draftGroup, home] = await Promise.all([
      getDraftGroupSections(group as StoreGroupType),
      getHomePageSections(),
    ]);
    const bodyCtx: SectionRenderContext = { ...baseCtx, templateType: "home" };

    return (
      <>
        <style>{`[data-store-chrome="${group}"]{display:none}`}</style>
        {group === "header" ? (
          <>
            <StoreSections sections={draftGroup} ctx={baseCtx} editable />
            <StoreSections sections={home.sections} ctx={bodyCtx} />
          </>
        ) : (
          <>
            <StoreSections sections={home.sections} ctx={bodyCtx} />
            <StoreSections sections={draftGroup} ctx={baseCtx} editable />
          </>
        )}
        <DraftPreviewPill locale={locale as Locale} livePath={`/${locale}`} />
        <SectionPreviewBridge />
      </>
    );
  }

  const page = await resolveDraftPage(handleParts, await searchParams, baseCtx);
  if (!page) notFound();

  return (
    <>
      <StoreSections sections={page.sections} ctx={page.ctx} editable />
      <DraftPreviewPill
        locale={locale as Locale}
        livePath={page.livePath === "/" ? `/${locale}` : `/${locale}${page.livePath}`}
      />
      <SectionPreviewBridge />
    </>
  );
}
