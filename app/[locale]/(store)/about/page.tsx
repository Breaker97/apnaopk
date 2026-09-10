import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  AboutPageView,
  fillAboutPlaceholders,
} from "@/components/store/about-page-view";
import { fetchTestimonials } from "@/components/store/sections/testimonials";
import { JsonLd, generateOrganizationJsonLd } from "@/lib/site-config/seo";
import { getAboutStatCounts } from "@/lib/storefront/about-stat-counts";
import { resolveAboutStats } from "@/lib/storefront/about-stats";
import {
  getEnabledLocales,
  resolveStorefrontBaseUrl,
} from "@/lib/storefront/storefront-metadata";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const { contentPages, storeName } = await getStorefrontSettings();
  const page = contentPages.about;
  const placeholders = {
    storeName,
    returnWindow: contentPages.returns.returnWindowValue,
  };

  return {
    title: page.metaTitle || page.title || "About Us",
    description:
      page.metaDescription ||
      fillAboutPlaceholders(page.description, placeholders) ||
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

  const [counts, testimonials, { enabled: availableLocales }, tHome, tNav] =
    await Promise.all([
      page.showStats ? getAboutStatCounts() : Promise.resolve(null),
      page.showTestimonials
        ? fetchTestimonials(page.testimonialsMinRating, 3)
        : Promise.resolve([]),
      getEnabledLocales(),
      getTranslations({ locale, namespace: "home" }),
      getTranslations({ locale, namespace: "nav" }),
    ]);

  const placeholders = {
    storeName: settings.storeName,
    returnWindow: settings.contentPages.returns.returnWindowValue,
  };
  const stats = resolveAboutStats(page.stats, counts, locale);
  const statsDateLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(new Date());

  const baseUrl = resolveStorefrontBaseUrl();
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
    url: `${baseUrl}/${locale}/about`,
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
