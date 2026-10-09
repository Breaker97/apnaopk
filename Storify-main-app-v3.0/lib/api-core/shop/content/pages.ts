import { CONTENT_PAGE_REASONS, ContentPage } from "@/contracts/mobile/shop/v1/content";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import type { NonFaqContentPageKey } from "@/lib/site-config/content-pages-config";
import { getLandingPage } from "@/lib/storefront/pages/get-landing-page";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { appHtml } from "./html";

/** The pages the website shows at an address of their own, with `ContentPageView`. */
const OWN_ADDRESS_PAGES: readonly NonFaqContentPageKey[] = ["privacy", "terms", "cookies", "accessibility"];

const isOwnAddressPage = (handle: string): handle is NonFaqContentPageKey =>
  (OWN_ADDRESS_PAGES as readonly string[]).includes(handle);

function isoTime(value: string): string | undefined {
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

const notFound = () => new MobileApiError(404, "NOT_FOUND", "This page is not available.");

/**
 * GET /pages/{handle}: a page the merchant writes, as the website's
 * `ContentPageView` shows it: /privacy, /terms, /cookies, /accessibility, and
 * the merchant's own pages at /pages/{handle}. Hidden is not found, as on the
 * website. A handle the theme builds as a landing page wins on the website
 * (app/[locale]/(store)/pages/[handle]/page.tsx), and has no `html` to send.
 * Static: expired by the settings tag.
 */
export const contentPageRoute = defineRoute({
  id: "content.pages.detail",
  method: "GET",
  path: "/pages/{handle}",
  auth: "none",
  cache: { kind: "static", revalidate: 60 },
  reasons: { values: CONTENT_PAGE_REASONS },
  output: ContentPage,
  handler: async ({ params }) => {
    const handle = params.handle;
    const { contentPages } = await getStorefrontSettings();

    if (isOwnAddressPage(handle)) {
      const page = contentPages[handle];
      if (!page.visible) throw notFound();
      return { handle, title: page.title, html: appHtml(page.content) };
    }

    if (await getLandingPage(handle)) {
      throw new MobileApiError(404, "NOT_FOUND", "This page is shown on the website only.", {
        reason: "WEB_ONLY",
      });
    }
    const page = contentPages.customPages.find((item) => item.handle === handle && item.visible);
    if (!page) throw notFound();
    const updatedAt = isoTime(page.updatedAt);
    return {
      handle,
      title: page.title,
      html: appHtml(page.content),
      ...(updatedAt ? { updatedAt } : {}),
    };
  },
});
