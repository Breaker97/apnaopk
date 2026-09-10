import { connectDB } from "@/lib/db";
import { setRequestLocale } from "next-intl/server";
import { getSettings } from "@/models/settings.model";
import { StorePage } from "@/models/store-page.model";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { normalizeContentPagesSettings } from "@/lib/site-config/content-pages-config";
import { PagesManager } from "@/components/admin/online-store/pages-manager";
import {
  LandingPagesCard,
  type LandingPageSummary,
} from "@/components/admin/store-pages/landing-pages-card";
import type { LocalizedText } from "@/lib/storefront/sections/types";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function OnlineStorePagesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);
  await connectDB();
  const [settings, landingDocs] = await Promise.all([
    getSettings(),
    StorePage.find({ kind: "landing" })
      .select("handle title published updatedAt")
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean(),
  ]);
  const contentPages = normalizeContentPagesSettings(settings.contentPages);
  // `handle` is optional at the type level (templates/groups carry none) but
  // every landing document has one — the flatMap just encodes that.
  const landingPages: LandingPageSummary[] = landingDocs.flatMap((page) =>
    page.handle
      ? [
          {
            handle: page.handle,
            title: (page.title as LocalizedText) ?? "",
            isPublished: Boolean(page.published),
          },
        ]
      : [],
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <LandingPagesCard
        locale={locale}
        defaultLanguage={settings.general?.defaultLanguage || "en"}
        initialPages={landingPages}
      />
      <PagesManager locale={locale} initialContentPages={contentPages} />
    </div>
  );
}
