import "server-only";

import { getTranslations } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { lt } from "@/lib/storefront/sections/localized";
import type { LocalizedText } from "@/lib/storefront/sections/types";
import { StorePage } from "@/models/store-page.model";

export interface PageSwitcher {
  current: string;
  templates: { value: string; label: string }[];
  landingPages: { value: string; label: string }[];
  globalPages: { value: string; label: string }[];
}

/**
 * The one list of storefront surfaces the editor can switch between —
 * built here rather than inside the Customize route, because the dedicated
 * editors (checkout, product card) show the SAME switcher and must offer
 * the same destinations. A page that only some editors could reach would
 * turn switching into a scavenger hunt.
 *
 * The header and footer are deliberately absent: they are built in
 * Navigation (Header Studio / Footer builder), and listing them twice in
 * two different editors is how a merchant ends up editing the copy that is
 * not the one they are looking at.
 */
type LandingPageRow = { handle?: string; title?: unknown };

/**
 * The landing-page rows the switcher lists. Exported so a page can start
 * this read before it awaits the settings the switcher's LABELS need — the
 * rows themselves do not, and waiting on the settings first put a whole
 * database round trip after another for nothing.
 */
export async function loadPageSwitcherLandingPages(): Promise<LandingPageRow[]> {
  await connectDB();
  return StorePage.find({ kind: "landing" })
    .select("handle title")
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean<LandingPageRow[]>();
}

export async function buildPageSwitcher(
  locale: string,
  current: string,
  defaultLanguage: string,
  landingPages: Promise<LandingPageRow[]> | LandingPageRow[] = loadPageSwitcherLandingPages(),
): Promise<PageSwitcher> {
  const [t, landingDocs] = await Promise.all([
    getTranslations({ locale }),
    landingPages,
  ]);
  return {
    current,
    templates: [
      { value: "home", label: t("admin.storeBuilder.switcher.home") },
      {
        value: "template:product",
        label: t("admin.storeBuilder.switcher.product"),
      },
      {
        value: "template:products",
        label: t("admin.storeBuilder.switcher.products"),
      },
      {
        value: "template:category",
        label: t("admin.storeBuilder.switcher.category"),
      },
      {
        value: "template:collection",
        label: t("admin.storeBuilder.switcher.collection"),
      },
      {
        value: "template:cart",
        label: t("admin.storeBuilder.switcher.cart"),
      },
    ],
    landingPages: landingDocs.flatMap((landing) =>
      landing.handle
        ? [
            {
              value: landing.handle,
              label:
                lt(
                  (landing.title as LocalizedText) ?? "",
                  defaultLanguage,
                  defaultLanguage,
                ) || landing.handle,
            },
          ]
        : [],
    ),
    // Dedicated editors, not sectionized pages: picking one navigates to
    // its own route (`nav:`) instead of switching the builder's page.
    globalPages: [
      {
        value: "nav:/admin/online-store/checkout",
        label: t("admin.storeBuilder.switcher.checkout"),
      },
      {
        value: "nav:/admin/online-store/product-card",
        label: t("admin.storeBuilder.switcher.productCard"),
      },
    ],
  };
}
