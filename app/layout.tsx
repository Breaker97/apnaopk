import "./globals.css";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { unstable_cache } from "next/cache";
import {
  defaultLocale,
  getLocaleDirection,
  isValidLocale,
  type Locale,
} from "@/config/i18n.config";
import { REQUEST_PATH_HEADER } from "@/lib/auth/return-path";
import { isSectionPreviewPath } from "@/lib/storefront/pages/section-preview-path";
import { appConfig } from "@/config/app.config";
import localFont from "next/font/local";
import { AppProviders } from "@/providers/app-providers";
import type { InitialAppSettings } from "@/providers/app-settings-provider";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { resolveShareSettings } from "@/lib/site-config/share-config";
import {
  getStorefrontIcons,
  getStorefrontMetadataSettings,
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

// Self-hosted (latin subset, variable weight, SIL OFL — see app/fonts/OFL-*.txt)
// so `next build` no longer reaches Google Fonts: an offline or firewalled
// build host used to fail on a transient fetch.
const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

// Resolved per request so the app identity — name and icon — is the store's,
// never this app's. Icons are omitted entirely when no favicon is configured:
// a `<link rel="icon">` pointing at a missing file would send browsers and
// link-preview crawlers back to `/favicon.ico`.
export async function generateMetadata(): Promise<Metadata> {
  const storeMetadata = await getStorefrontMetadataSettings();
  const { storeName, storeDescription } = storeMetadata;

  return {
    title: {
      default: storeName,
      template: `%s | ${storeName}`,
    },
    description: storeDescription || appConfig.description,
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
    icons: getStorefrontIcons(storeMetadata),
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

const getInitialAppSettings = unstable_cache(
  async (): Promise<InitialAppSettings> => {
    try {
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
          contrast: Boolean(appearance?.contrast),
          rtl: Boolean(appearance?.rtl),
          collapsedSidebar: Boolean(appearance?.collapsedSidebar),
          navLayout: appearance?.navLayout || "mini",
          navColor: appearance?.navColor || "integrate",
          presetColor: appearance?.presetColor || "default",
          primaryColor: appearance?.primaryColor || DEFAULT_PRIMARY_COLOR,
          secondaryColor: appearance?.secondaryColor || DEFAULT_SECONDARY_COLOR,
          accentColor: appearance?.accentColor || DEFAULT_ACCENT_COLOR,
        },
      };
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Failed to preload app settings:", error);
      }

      return {
        isLoading: false,
        storeName: DEFAULT_STORE_NAME,
        defaultCurrency: DEFAULT_CURRENCY,
      };
    }
  },
  ["initial-app-settings"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.settings],
  },
);

/**
 * The locale this request is actually for.
 *
 * Only the root layout may render `<html>`, and it has no route params — so it
 * hard-coded `lang="en"` and emitted no `dir` at all. Everything downstream
 * corrected itself after hydration, which left the server-rendered first paint
 * of an Arabic storefront in English and left-to-right: wrong for anyone who
 * sees the page before JavaScript runs, and wrong for crawlers, which never do.
 * The proxy already stamps the requested path on every page request, so the
 * locale is right there to be read.
 */
async function resolveRequestPath(): Promise<{
  locale: Locale;
  sectionPreview: boolean;
}> {
  const requestPath = (await headers()).get(REQUEST_PATH_HEADER);
  const candidate = (requestPath || "").split("?")[0].split("/")[1];
  return {
    locale: candidate && isValidLocale(candidate) ? candidate : defaultLocale,
    sectionPreview: isSectionPreviewPath(requestPath),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [initialSettings, { locale, sectionPreview }] = await Promise.all([
    getInitialAppSettings(),
    resolveRequestPath(),
  ]);

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

  return (
    <html
      lang={locale}
      dir={getLocaleDirection(locale)}
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
        <AppProviders
          initialSettings={initialSettings}
          sectionPreview={sectionPreview}
        >
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
