import { ReturnPolicyPage, type PageSection } from "@/contracts/mobile/shop/v1/content";
import { defineRoute } from "@/lib/api-core/registry";
import { fillContentPagePlaceholders } from "@/lib/site-config/content-pages-config";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { emailLine, pageNotFound, pagePlaceholders, phoneLine, words } from "./store-contact";

type Entry = { id: string; title?: string; label?: string; description?: string; text?: string };

/** A list of the page, with the entries that have words in them; none when none do. */
function section(title: string, text: string | undefined, entries: Entry[]): PageSection | undefined {
  const items = entries.flatMap((entry) => {
    const heading = words(entry.title ?? entry.label);
    const body = words(entry.description ?? entry.text);
    return heading || body ? [{ id: entry.id, title: heading, text: body }] : [];
  });
  return items.length > 0 ? { title, text: words(text), items } : undefined;
}

const action = (label: string, path: string) => (words(label) ? { label: label.trim(), path } : undefined);

/**
 * GET /return-policy: the website's /returns
 * (components/store/return-policy-page-view.tsx), with every line the
 * merchant wrote filled in: `{windowDays}` is the window the store enforces
 * (Settings → Orders → Returns), so the page cannot promise another. The
 * website's buttons open the shopper's orders and order tracking. Hidden is
 * not found. Static: expired by the settings tag.
 */
export const returnPolicyRoute = defineRoute({
  id: "content.return-policy",
  method: "GET",
  path: "/return-policy",
  auth: "none",
  cache: { kind: "static", revalidate: 60 },
  output: ReturnPolicyPage,
  handler: async () => {
    const settings = await getStorefrontSettings();
    if (!settings.contentPages.returns.visible) throw pageNotFound();
    const page = fillContentPagePlaceholders(settings.contentPages.returns, pagePlaceholders(settings));
    const contact = settings.contentPages.contact;

    return {
      title: page.title,
      eyebrow: words(page.eyebrow),
      description: words(page.description),
      primaryAction: action(page.primaryActionLabel, "/account/orders"),
      secondaryAction: action(page.secondaryActionLabel, "/track-order"),
      window: { label: page.returnWindowLabel, value: page.returnWindowValue },
      summary: page.summaryItems.flatMap((item) => {
        const text = words(item.text);
        return text ? [text] : [];
      }),
      howItWorks: section(page.howItWorksTitle, page.howItWorksDescription, page.steps),
      eligible: section(page.eligibleTitle, undefined, page.eligibleItems),
      excluded: section(page.excludedTitle, undefined, page.excludedItems),
      refundRules: section(page.refundRulesTitle, page.refundRulesDescription, page.refundRules),
      statuses: section(page.statusesTitle, page.statusesDescription, page.statuses),
      beforeReturn: words(page.beforeReturnTitle)
        ? { title: page.beforeReturnTitle.trim(), text: words(page.beforeReturnDescription) }
        : undefined,
      help: {
        title: page.helpTitle,
        email: emailLine(contact.emailTitle, settings.storeEmail),
        phone: phoneLine(contact.phoneTitle, settings.storePhone),
      },
      closing: words(page.ctaTitle)
        ? {
            title: page.ctaTitle.trim(),
            text: words(page.ctaDescription),
            primaryAction: action(page.ctaPrimaryLabel, "/account/orders"),
            secondaryAction: action(page.ctaSecondaryLabel, "/track-order"),
          }
        : undefined,
    };
  },
});
