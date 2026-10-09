import "../storefront.css";
import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { pickStorefrontMessages } from "@/lib/i18n/surface-messages";
import { getLocaleDirection, locales, type Locale } from "@/config/i18n.config";
import { LocaleCookieSync } from "@/components/language/locale-cookie-sync";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import { AppProviders } from "@/providers/app-providers";
import type { InitialAppSettings } from "@/providers/app-settings-provider";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { resolveShareSettings } from "@/lib/site-config/share-config";
import {
  getStorefrontMetadataSettings,
  storefrontPageMetadata,
} from "@/lib/storefront/storefront-metadata";
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_CURRENCY,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  DEFAULT_STORE_NAME,
  normalizeThemeMode,
  resolveFaviconUrl,
} from "@/config/branding.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { buildCustomColorVars } from "@/lib/site-config/appearance-colors";
import { normalizeCountryAvailability } from "@/lib/intl/country-availability";
import { mtnMomoPhoneExample } from "@/lib/payments/mtn-momo";
import { resolveMtnMomoCredentials } from "@/lib/settings/credentials";
import { withFallback } from "@/lib/storefront/cached-read";

/**
 * The root layout. It lives inside `[locale]` so that `<html lang dir>` comes
 * from the route itself: a root layout above this segment has no params, and
 * reading the locale from the request instead made every page — the cached
 * home page included — depend on the request.
 *
 * So nothing here may read the request (headers, cookies, search params):
 * a page below that reads nothing either can be served from the cache
 * (the home page and a product page, see their `generateStaticParams`). Every
 * other route reads the request somewhere of its own and is rendered per
 * request, as before.
 *
 * Deliberately no `generateStaticParams` here. With it, `next build` would
 * prerender every page under this layout for every listed locale, and each of
 * them read the database. A page that should be cached lists its own (empty)
 * set instead, so it is rendered on its first visit rather than at build.
 */

// Self-hosted (latin subset, variable weight, SIL OFL — see app/fonts/OFL-*.txt)
// so `next build` no longer reaches Google Fonts: an offline or firewalled
// build host used to fail on a transient fetch.
const geistMono = localFont({
  src: "../fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

const inter = localFont({
  src: "../fonts/inter-latin.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

// The store's name, icon and SEO copy, for every page. The canonical,
// hreflang and robots depend on which page it is, so they come from below:
// the home page states its own, every other route reads its request path
// (lib/storefront/request-path-metadata.tsx).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [page, { storeName }] = await Promise.all([
    storefrontPageMetadata(locale, null),
    getStorefrontMetadataSettings(),
  ]);

  return {
    ...page,
    manifest: "/manifest.webmanifest",
    applicationName: storeName,
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: storeName,
    },
    formatDetection: {
      telephone: false,
    },
  };
}

/**
 * What a visitor with JavaScript switched off is left with.
 *
 * The storefront server-renders its header, footer and page content, but any
 * section behind a `<Suspense>` boundary — which is most of them, plus every
 * route with a `loading.tsx` — arrives in a `<div hidden>` that React swaps
 * into place with an inline script. No script, no swap: the skeleton sits
 * there pulsing forever, which reads as a broken store rather than a disabled
 * feature. So the placeholders are hidden and replaced with a straight answer.
 *
 * The nav and footer are deliberately left alone: they are real server-rendered
 * links, so the site stays navigable.
 *
 * Rendered through `dangerouslySetInnerHTML` because a browser with scripting
 * enabled keeps `<noscript>` content as inert text rather than parsing it into
 * the DOM, which is not a tree React can hydrate.
 */
function noscriptFallback(storeName: string) {
  const name = storeName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `
<style>
  [aria-busy="true"], [data-slot="skeleton"] { display: none !important; }
  .nojs-notice {
    margin: 2rem auto;
    max-width: 40rem;
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 0.75rem;
    background: var(--card, #fff);
    color: var(--foreground, #212b36);
    font-size: 0.95rem;
    line-height: 1.6;
    text-align: center;
  }
  .nojs-notice h2 { margin: 0 0 0.5rem; font-size: 1.05rem; font-weight: 600; }
  .nojs-notice p { margin: 0; color: var(--muted-foreground, #637381); }
</style>
<div class="nojs-notice" role="alert">
  <h2>${name} needs JavaScript</h2>
  <p>Browsing products, the cart and checkout are all interactive, so this page
  cannot finish loading with JavaScript turned off. Enable it in your browser
  settings and reload. The menu and footer links below still work.</p>
</div>`;
}

export const viewport: Viewport = {
  themeColor: "#111111",
  // Light only. Declaring "light dark" would let the UA render native widgets
  // (scrollbars, form controls, the pre-paint canvas) from the OS preference
  // before hydration; the app never follows the OS. ThemeProvider raises
  // `style.color-scheme: dark` on <html> when dark is explicitly chosen, which
  // outranks this declaration.
  colorScheme: "light",
};

const getInitialAppSettings = withFallback(
  unstable_cache(
    async (): Promise<InitialAppSettings> => {
      await connectDB();
      const settings = await getSettings();
      const general = settings.general;
      const appearance = settings.appearance;

      return {
        isMultiVendor: Boolean(settings.multiVendorMode?.enabled),
        isLoading: false,
        posEnabled: Boolean(settings.pos?.enabled),
        // Boosting is a multi-vendor-only feature, so the gate is both flags —
        // the same expression `/api/settings/public` serves. This payload is
        // the only source the provider reads when it is present, so leaving the
        // flag out silently hides every boost entry point in the UI.
        boostingEnabled: Boolean(
          settings.multiVendorMode?.enabled && settings.boosting?.enabled,
        ),
        // Same gate, and the same trap the comment above describes: the vendor
        // sidebar's billing entry reads this flag, so omitting it here hides the
        // billing screen entirely no matter what /api/settings/public reports.
        vendorPlansEnabled: Boolean(
          settings.multiVendorMode?.enabled && settings.vendorConfig?.plansEnabled,
        ),
        storeName:
          typeof general?.storeName === "string" && general.storeName.trim()
            ? general.storeName.trim()
            : DEFAULT_STORE_NAME,
        storeDescription: general?.storeDescription || undefined,
        storeEmail: general?.storeEmail || undefined,
        storePhone: general?.storePhone || undefined,
        storeAddress: general?.storeAddress || undefined,
        defaultCurrency: general?.defaultCurrency || DEFAULT_CURRENCY,
        defaultLanguage: general?.defaultLanguage || undefined,
        supportedLanguages: Array.isArray(general?.supportedLanguages)
          ? general.supportedLanguages
          : [],
        countryAvailability: normalizeCountryAvailability(
          general?.countryAvailability,
        ),
        // Server-rendered alongside the policy so checkout's address form opens
        // on the store's own country instead of flipping to it on hydration.
        shippingOriginCountry: settings.shipping?.origin?.country || "",
        // Same value /api/settings/public serves; without it here every store
        // would show the fallback number whatever its MTN country.
        mtnMomoPhoneExample: mtnMomoPhoneExample(
          resolveMtnMomoCredentials(settings.payment?.mtn_momo)
            .targetEnvironment,
        ),
        logoUrl: general?.logoUrl || undefined,
        darkModeLogoUrl: general?.darkModeLogoUrl || undefined,
        faviconUrl: resolveFaviconUrl(general?.faviconUrl),
        socialLinks: {
          facebookUrl: settings.social?.facebookUrl || undefined,
          twitterUrl: settings.social?.twitterUrl || undefined,
          instagramUrl: settings.social?.instagramUrl || undefined,
          youtubeUrl: settings.social?.youtubeUrl || undefined,
          linkedinUrl: settings.social?.linkedinUrl || undefined,
          tiktokUrl: settings.social?.tiktokUrl || undefined,
        },
        shareSettings: resolveShareSettings(settings.social?.share),
        appearance: {
          themeMode: normalizeThemeMode(appearance?.theme),
          presetColor: appearance?.presetColor || "default",
          primaryColor: appearance?.primaryColor || DEFAULT_PRIMARY_COLOR,
          secondaryColor: appearance?.secondaryColor || DEFAULT_SECONDARY_COLOR,
          accentColor: appearance?.accentColor || DEFAULT_ACCENT_COLOR,
        },
      };
    },
    ["initial-app-settings"],
    {
      revalidate: 60,
      tags: [CACHE_TAGS.settings],
    },
  ),
  (error) => {
    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to preload app settings:", error);
    }

    return {
      isLoading: false,
      storeName: DEFAULT_STORE_NAME,
      defaultCurrency: DEFAULT_CURRENCY,
    };
  },
);

export default async function RootLayout({
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

  setRequestLocale(locale);

  const initialSettings = await getInitialAppSettings();

  // Inline the configured brand colors on <html> so the very first paint uses
  // them — without this the stylesheet defaults flash until the client-side
  // settings applier runs after hydration. The applier keeps runtime edits live.
  const appearance = initialSettings.appearance;
  const customColorVars = buildCustomColorVars({
    primary: appearance?.primaryColor ?? DEFAULT_PRIMARY_COLOR,
    secondary: appearance?.secondaryColor ?? DEFAULT_SECONDARY_COLOR,
    accent: appearance?.accentColor ?? DEFAULT_ACCENT_COLOR,
    skeleton: appearance?.skeletonColor ?? "",
  });

  // Only what storefront client components can translate. The dashboards
  // (admin/vendor/staff layouts) mount their own provider with the full
  // bundle; shipping it here put 286 KB of back-office strings in every
  // storefront page's HTML. (A smaller "shell" here with a storefront
  // provider below it was measured and reverted: React Flight already
  // dedupes the namespaces the two bundles share, so it saved nothing.)
  const messages = pickStorefrontMessages(await getMessages());

  const direction = getLocaleDirection(locale as Locale);

  return (
    <html
      lang={locale}
      dir={direction}
      suppressHydrationWarning
      style={customColorVars as React.CSSProperties}
    >
      <body
        className={`${inter.className} ${inter.variable} ${geistMono.variable} antialiased`}
      >
        <noscript
          dangerouslySetInnerHTML={{
            __html: noscriptFallback(
              initialSettings.storeName || DEFAULT_STORE_NAME,
            ),
          }}
        />
        <AppProviders initialSettings={initialSettings}>
          <div lang={locale} dir={direction} className="min-h-screen">
            <LocaleCookieSync locale={locale} />
            {/* useSearchParams: kept out of the page's own render path. */}
            <Suspense fallback={null}>
              <NavigationProgress />
            </Suspense>
            <NextIntlClientProvider messages={messages}>
              {children}
            </NextIntlClientProvider>
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
