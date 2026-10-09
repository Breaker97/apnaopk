import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AboutPageView } from "@/components/store/about-page-view";
import { fetchTestimonials } from "@/lib/storefront/section-data/content";
import {
  fillContentPlaceholders,
  windowPlaceholders,
} from "@/lib/site-config/content-pages-config";
import { JsonLd, generateOrganizationJsonLd } from "@/lib/site-config/seo";
import { getAboutStatCounts } from "@/lib/storefront/about-stat-counts";
import {
  liveAboutStatKeys,
  resolveAboutStats,
} from "@/lib/storefront/about-stats";
import { getLocaleRouting } from "@/lib/i18n/locale-routing";
import { buildStorefrontUrl } from "@/lib/storefront/storefront-metadata";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const { contentPages, returnWindowDays, storeName } = await getStorefrontSettings();
  const page = contentPages.about;
  const placeholders = {
    storeName,
    returnWindow: contentPages.returns.returnWindowValue,
    ...windowPlaceholders(returnWindowDays),
  };

  return {
    title: page.metaTitle || page.title || "About Us",
    description:
      page.metaDescription ||
      fillContentPlaceholders(page.description, placeholders) ||
      `Learn about ${storeName}, the sellers on it, and how it works.`,
  };
}

/**
 * /about — the structured company page. Content comes from
 * `settings.contentPages.about` (Admin → Online Store → Pages), the numbers
 * from live counts, the reviews from the same approved-review query the
 * testimonials section uses, and the contact block from General settings.
 */
export default async function AboutPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const settings = await getStorefrontSettings();
  const page = settings.contentPages.about;
  if (!page.visible) {
    notFound();
  }

  const liveStatKeys = page.showStats ? liveAboutStatKeys(page.stats) : [];
  const [counts, testimonials, { enabled: availableLocales, storeDefault }, tHome, tNav] =
    await Promise.all([
      liveStatKeys.length > 0
        ? getAboutStatCounts(liveStatKeys)
        : Promise.resolve(null),
      page.showTestimonials
        ? fetchTestimonials(page.testimonialsMinRating, 3)
        : Promise.resolve([]),
      getLocaleRouting(),
      getTranslations({ locale, namespace: "home" }),
      getTranslations({ locale, namespace: "nav" }),
    ]);

  const placeholders = {
    storeName: settings.storeName,
    returnWindow: settings.contentPages.returns.returnWindowValue,
    ...windowPlaceholders(settings.returnWindowDays),
  };
  const stats = resolveAboutStats(page.stats, counts, locale);
  const statsDateLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(new Date());

  const organization = generateOrganizationJsonLd({
    storeName: settings.storeName,
    storeDescription: settings.storeDescription,
    logoUrl: settings.logoUrl,
    storePhone: settings.storePhone,
    socialUrls: [
      settings.social.facebookUrl,
      settings.social.twitterUrl,
      settings.social.instagramUrl,
      settings.social.youtubeUrl,
      settings.social.linkedinUrl,
      settings.social.tiktokUrl,
    ],
    availableLocales,
  });
  const founded = page.stats.find(
    (stat) => stat.key === "founded" && stat.enabled && stat.manualValue,
  );
  const { "@context": _context, ...organizationNode } = organization;
  const aboutJsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: page.title,
    url: await buildStorefrontUrl(locale, "/about"),
    mainEntity: {
      ...organizationNode,
      foundingDate: founded?.manualValue || undefined,
    },
  };

  const contactPage = settings.contentPages.contact;

  return (
    <>
      <JsonLd data={aboutJsonLd} id="about-page-jsonld" />
      <AboutPageView
        locale={locale}
        storeDefault={storeDefault}
        page={page}
        placeholders={placeholders}
        isMultiVendorEnabled={settings.isMultiVendorEnabled}
        stats={stats}
        statsDateLabel={statsDateLabel}
        testimonials={testimonials}
        verifiedCustomerLabel={tHome("verifiedCustomer")}
        contact={{
          address: settings.storeAddress,
          email: settings.storeEmail,
          phone: settings.storePhone,
          supportHours: contactPage.supportHours,
          social: settings.social,
          labels: {
            address: contactPage.headOfficeTitle,
            email: contactPage.emailTitle,
            phone: contactPage.phoneTitle,
            hours: contactPage.hoursTitle,
          },
        }}
        contactCtaLabel={tNav("contactUs")}
      />
    </>
  );
}
