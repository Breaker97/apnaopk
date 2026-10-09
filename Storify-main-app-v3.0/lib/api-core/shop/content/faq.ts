import { FaqPage } from "@/contracts/mobile/shop/v1/content";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import {
  fillContentPagePlaceholders,
  windowPlaceholders,
} from "@/lib/site-config/content-pages-config";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

/**
 * GET /faq: the questions of the website's /faq, with the placeholders the
 * website fills (the store's name, its return window) filled the same way.
 * Hidden is not found. Static: expired by the settings tag.
 */
export const faqRoute = defineRoute({
  id: "content.faq",
  method: "GET",
  path: "/faq",
  auth: "none",
  cache: { kind: "static", revalidate: 60 },
  output: FaqPage,
  handler: async () => {
    const { contentPages, returnWindowDays, storeName } = await getStorefrontSettings();
    if (!contentPages.faq.visible) {
      throw new MobileApiError(404, "NOT_FOUND", "This page is not available.");
    }
    const faq = fillContentPagePlaceholders(contentPages.faq, {
      storeName,
      returnWindow: contentPages.returns.returnWindowValue,
      ...windowPlaceholders(returnWindowDays),
    });
    const subtitle = faq.subtitle.trim();
    return {
      title: faq.title,
      ...(subtitle ? { subtitle } : {}),
      items: faq.items
        .filter((item) => item.question.trim())
        .map((item) => ({ id: item.id, question: item.question, answer: item.answer })),
    };
  },
});
