import { AboutPage, type PageItem } from "@/contracts/mobile/shop/v1/content";
import { BENEFIT_ICONS } from "@/contracts/mobile/shop/v1/home";
import { defineRoute } from "@/lib/api-core/registry";
import { fillContentPagePlaceholders } from "@/lib/site-config/content-pages-config";
import { getAboutStatCounts } from "@/lib/storefront/about-stat-counts";
import { liveAboutStatKeys, resolveAboutStats } from "@/lib/storefront/about-stats";
import { fetchTestimonials } from "@/lib/storefront/section-data/content";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { imageSet } from "../images";
import { appHtml } from "./html";
import { pageNotFound, pagePlaceholders, storeContact, words } from "./store-contact";

/** How many reviews the website's About page quotes. */
const TESTIMONIALS = 3;

type Entry = { id: string; title?: string; description?: string; text?: string; year?: string };

/** The entries with words in them, as the website lists them. */
function items(entries: Entry[]): PageItem[] {
  return entries.flatMap((entry) => {
    const title = words(entry.title ?? entry.year);
    const text = words(entry.description ?? entry.text);
    return title || text ? [{ id: entry.id, title, text }] : [];
  });
}

const benefitIcon = (icon: string) =>
  (BENEFIT_ICONS as readonly string[]).includes(icon.toUpperCase())
    ? (icon.toUpperCase() as (typeof BENEFIT_ICONS)[number])
    : "SHIELD";

/**
 * GET /about: the website's /about (components/store/about-page-view.tsx),
 * part by part: the merchant's copy with its placeholders filled, the live
 * figures counted and written in the shopper's language, the reviews it
 * quotes, and the store's contact rows. A part the website leaves out is left
 * out. Hidden is not found. Static: expired by the settings tag; the counts
 * and the reviews are as fresh as the website's (five minutes).
 */
export const aboutRoute = defineRoute({
  id: "content.about",
  method: "GET",
  path: "/about",
  auth: "none",
  cache: { kind: "static", revalidate: 60 },
  output: AboutPage,
  handler: async ({ locale }) => {
    const settings = await getStorefrontSettings();
    if (!settings.contentPages.about.visible) throw pageNotFound();
    const page = fillContentPagePlaceholders(settings.contentPages.about, pagePlaceholders(settings));

    const liveStatKeys = page.showStats ? liveAboutStatKeys(page.stats) : [];
    const [counts, testimonials] = await Promise.all([
      liveStatKeys.length > 0 ? getAboutStatCounts(liveStatKeys) : Promise.resolve(null),
      page.showTestimonials ? fetchTestimonials(page.testimonialsMinRating, TESTIMONIALS) : Promise.resolve([]),
    ]);
    const stats = page.showStats ? resolveAboutStats(page.stats, counts, locale) : [];

    const multiVendor = settings.isMultiVendorEnabled;
    const contactPage = settings.contentPages.contact;
    const contactAction = contactPage.visible ? { label: contactPage.title, path: "/contact" } : undefined;
    const secondaryAction = multiVendor
      ? words(page.secondaryCtaLabel) && { label: page.secondaryCtaLabel.trim(), path: "/become-vendor" }
      : contactAction;
    const closingSecondary = multiVendor
      ? words(page.ctaSecondaryLabel) && { label: page.ctaSecondaryLabel.trim(), path: "/become-vendor" }
      : contactAction;
    const shopAction = (label: string) => (words(label) ? { label: label.trim(), path: "/products" } : undefined);

    const shopperSteps = items(page.shopperSteps);
    const sellerSteps = multiVendor && page.showSellerSteps ? items(page.sellerSteps) : [];
    const values = page.values.filter((item) => item.title || item.text);
    const storyHtml = appHtml(page.storyBody);
    const milestones = items(page.milestones);
    const members = page.showTeam ? page.members.filter((member) => member.name.trim()) : [];
    const details = storeContact(settings, { social: true });
    const hasContact = Boolean(details.address || details.email || details.phone);

    return {
      title: page.title,
      eyebrow: words(page.eyebrow),
      headline: words(page.headline) ?? page.title,
      description: words(page.description),
      image: imageSet(page.heroImageUrl),
      primaryAction: shopAction(page.primaryCtaLabel),
      secondaryAction: secondaryAction || undefined,
      stats: stats.length >= 2 ? stats.map((stat) => ({ id: stat.key, label: stat.label, value: stat.value })) : [],
      statsFootnote: stats.length >= 2 ? words(page.statsFootnote) : undefined,
      howItWorks:
        shopperSteps.length > 0 || sellerSteps.length > 0
          ? {
              title: page.howItWorksTitle,
              text: words(page.howItWorksDescription),
              shoppers:
                shopperSteps.length > 0 ? { title: page.shopperStepsTitle, items: shopperSteps } : undefined,
              sellers:
                sellerSteps.length > 0
                  ? {
                      title: page.sellerStepsTitle,
                      items: sellerSteps,
                      action: words(page.sellerCtaLabel)
                        ? { label: page.sellerCtaLabel.trim(), path: "/become-vendor" }
                        : undefined,
                    }
                  : undefined,
              protections: items(page.protectionItems),
            }
          : undefined,
      values:
        values.length > 0 || words(page.missionStatement)
          ? {
              title: page.valuesTitle,
              mission: words(page.missionStatement),
              items: values.map((item) => ({
                id: item.id,
                icon: benefitIcon(item.icon),
                title: item.title,
                text: words(item.text),
              })),
            }
          : undefined,
      story: storyHtml.trim() ? { title: page.storyTitle, html: storyHtml } : undefined,
      milestones:
        storyHtml.trim() && milestones.length > 0 ? { title: page.milestonesTitle, items: milestones } : undefined,
      team:
        members.length > 0
          ? {
              title: page.teamTitle,
              text: words(page.teamDescription),
              members: members.map((member) => ({
                id: member.id,
                name: member.name.trim(),
                role: words(member.role),
                bio: words(member.bio),
                image: imageSet(member.imageUrl, member.name),
                url: words(member.linkUrl),
              })),
            }
          : undefined,
      testimonials:
        page.showTestimonials && testimonials.length > 0
          ? {
              title: page.testimonialsTitle,
              text: words(page.testimonialsDescription),
              items: testimonials.map((entry) => ({
                id: entry.id,
                rating: entry.rating,
                title: words(entry.title),
                comment: entry.comment,
                reviewerName: words(entry.reviewerName),
              })),
            }
          : undefined,
      contact:
        page.showContact && hasContact
          ?{ title: page.contactTitle, text: words(page.contactDescription), details, action: contactAction }
          : undefined,
      closing: words(page.ctaTitle)
        ? {
            title: page.ctaTitle.trim(),
            text: words(page.ctaDescription),
            primaryAction: shopAction(page.ctaPrimaryLabel),
            secondaryAction: closingSecondary || undefined,
          }
        : undefined,
    };
  },
});
