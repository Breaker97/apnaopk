import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { appConfig } from "@/config/app.config";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { pickStorefrontMessages } from "@/lib/i18n/surface-messages";
import { locales, localeConfig, type Locale } from "@/config/i18n.config";
import { HtmlLangSync } from "@/components/language/html-lang-sync";
import { REQUEST_PATH_HEADER } from "@/lib/auth/return-path";
import {
  buildStorefrontAlternates,
  canonicalPageFromRequestPath,
  isIndexablePage,
  getStorefrontIcons,
  getStorefrontMetadataSettings,
  resolveStorefrontBaseUrl,
} from "@/lib/storefront/storefront-metadata";

// Deliberately no `generateStaticParams` here. With it, `next build` tried to
// prerender every page under this layout for all 18 locales — 3,729 render
// tasks — and every one of them bailed out to dynamic rendering anyway,
// because the storefront and dashboards read cookies/headers (session, cart,
// currency) in their layouts. The route table is identical without it (558
// dynamic routes, and the two static ones live outside `[locale]`), while
// static generation drops from ~30 s and two extra render workers' worth of
// memory to ~5 s. If a page under here is ever made genuinely static, add
// `generateStaticParams` to THAT segment, not to this layout.
// Generate metadata
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const baseUrl = resolveStorefrontBaseUrl();
  const storeMetadata = await getStorefrontMetadataSettings();

  // Canonical/hreflang for whatever URL is actually being served. Pages that
  // know their own path (product, category, vendor) still export their own
  // `alternates` and win; this covers everything else, which is most of the
  // storefront — a fixed `page: "/"` here used to tell Google that every
  // listing, brand and blog post was a duplicate of the home page.
  //
  // `x-request-path` is stamped by the proxy on every page request and
  // overwrites any client-sent value, so it is safe to build URLs from. When
  // it is absent (no proxy in the request path) no canonical is emitted at
  // all: a wrong canonical de-indexes a page, a missing one does not.
  const canonicalPage = canonicalPageFromRequestPath(
    (await headers()).get(REQUEST_PATH_HEADER),
  );
  const alternates =
    canonicalPage === null
      ? undefined
      : await buildStorefrontAlternates({ locale, page: canonicalPage });
  const canonicalUrl =
    typeof alternates?.canonical === "string"
      ? alternates.canonical
      : `${baseUrl}/${locale}`;
  // The store's own name, never this app's tagline appended to it: a buyer's
  // storefront advertises the buyer's business. Anything longer than the name
  // is the admin's to write, in Settings → SEO.
  const title = storeMetadata.seo.metaTitle || storeMetadata.storeName;
  const description =
    storeMetadata.seo.metaDescription ||
    storeMetadata.storeDescription ||
    appConfig.description;

  return {
    title: {
      // `absolute` so the home/default title isn't suffixed with the store
      // name again by a parent template (avoids "Storify | Storify").
      absolute: title,
      template: `%s | ${storeMetadata.storeName}`,
    },
    description,
    keywords: storeMetadata.seo.metaKeywords,
    authors: [{ name: storeMetadata.storeName }],
    creator: storeMetadata.storeName,
    publisher: storeMetadata.storeName,
    metadataBase: new URL(baseUrl),
    alternates,
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: storeMetadata.storeName,
      images: storeMetadata.seo.ogImage
        ? [{ url: storeMetadata.seo.ogImage, width: 1200, height: 630, alt: title }]
        : undefined,
      locale: locale,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: storeMetadata.seo.ogImage ? [storeMetadata.seo.ogImage] : undefined,
    },
    // The back office, the auth flow and the shopper's own session pages are
    // kept out of the index. Decided from the path because several of them
    // (the cart above all) are client components, which cannot export
    // metadata of their own.
    robots:
      canonicalPage !== null && !isIndexablePage(canonicalPage)
        ? { index: false, follow: false }
        : { index: true, follow: true },
    icons: getStorefrontIcons(storeMetadata),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Validate that the incoming `locale` parameter is valid
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  // Enable static rendering
  setRequestLocale(locale);

  // Only what storefront client components can translate. The dashboards
  // (admin/vendor/staff layouts) mount their own provider with the full
  // bundle; shipping it here put 286 KB of back-office strings in every
  // storefront page's HTML. (A smaller "shell" here with a storefront
  // provider below it was measured and reverted: React Flight already
  // dedupes the namespaces the two bundles share, so it saved nothing.)
  const messages = pickStorefrontMessages(await getMessages());

  // Get locale direction (for RTL support)
  const direction = localeConfig[locale as Locale]?.direction || "ltr";

  return (
    <div lang={locale} dir={direction} className="min-h-screen">
      <HtmlLangSync locale={locale} direction={direction} />
      <NextIntlClientProvider messages={messages}>
        {children}
      </NextIntlClientProvider>
    </div>
  );
}
