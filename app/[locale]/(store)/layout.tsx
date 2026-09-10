import { Suspense } from "react";
import Script from "next/script";
import { CartProvider } from "@/hooks/use-cart";
import { QuickViewProvider } from "@/components/products/quick-view-context";
import { ProductCardConfigProvider } from "@/components/products/product-card-config-context";
import { StoreChromeHeight } from "@/components/store/store-chrome-height";
import { type Locale } from "@/config/i18n.config";
import { setRequestLocale } from "next-intl/server";
import { StoreBottomNav } from "@/components/layout/store-bottom-nav";
import { CompareBar } from "@/components/store/compare/compare-bar";
import { StoreSections } from "@/components/store/store-sections";
import { TemplateDemoPill } from "@/components/store/template-demo-pill";
import { THEME_MANIFESTS } from "@/lib/storefront/themes/registry";
import { getDemoTemplateUrls } from "@/lib/storefront/demo-links";
import { AISalesAgentWidget } from "@/components/ai-sales-agent/ai-sales-agent-widget";
import { StorefrontAnalytics } from "@/components/analytics/storefront-analytics";
import { StorefrontRefresh } from "@/components/store/storefront-refresh";
import { StoreThemeBodySync } from "@/components/store/store-theme-body-sync";
import { ThemePreviewBridge } from "@/components/store/theme-preview-bridge";
import { ScrollResetOnNavigate } from "@/components/store/scroll-reset-on-navigate";
import {
  JsonLd,
  generateOrganizationJsonLd,
  generateWebsiteJsonLd,
} from "@/lib/site-config/seo";
import { getGroupSections } from "@/lib/storefront/pages/get-template";
import type { SectionRenderContext } from "@/lib/storefront/sections/types";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { compileTheme } from "@/lib/storefront/themes/compile";
import { getEnabledLocales } from "@/lib/storefront/storefront-metadata";
import { getAuthPageSettings } from "@/lib/auth/auth-page-settings";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function StoreLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Everything here is a cached getter — one round trip on a cold cache.
  // The header's menu assembly moved into the header-bar SECTION
  // (components/store/sections/header-chrome.tsx): the layout only decides
  // WHICH sections render in each chrome zone, via the header/footer group
  // documents (announcement bar, top tags, the bars themselves).
  const [
    {
      analytics,
      theme,
      brand,
      storeName,
      storeDescription,
      storePhone,
      logoUrl,
      social,
      defaultLanguage,
      isMultiVendorEnabled,
      checkoutSettings,
      productCardConfig,
    },
    headerGroup,
    footerGroup,
    { enabled: enabledLocales },
    authSettings,
  ] = await Promise.all([
    getStorefrontSettings(),
    getGroupSections("header"),
    getGroupSections("footer"),
    getEnabledLocales(),
    // The bottom nav's guest account drawer renders the real sign-in/sign-up
    // forms, so it needs the same server-resolved flags /login and /register
    // get. `getSettings` is request-deduped, so this rides along with the
    // storefront settings read above.
    getAuthPageSettings(),
  ]);

  // The theme's tokens become CSS custom properties / data attributes on
  // the surface below — the only place a token turns into CSS is
  // compileTheme, which the editor's live preview runs too.
  const themeSurface = compileTheme(theme.tokens, brand.colors);

  const groupCtx: SectionRenderContext = {
    locale: locale as Locale,
    defaultLanguage,
    isMultiVendorEnabled,
    themeId: theme.id,
    themeSettings: theme.settings,
  };

  // Demo deployments only. Each template demo is its own deployment
  // (subdomain + database), so the pill cross-links the hosts from
  // DEMO_TEMPLATE_URLS; a template the map does not name would be a dead
  // card, so only the current deployment lists without one.
  const demoTemplates =
    process.env.DEMO_TEMPLATES === "1"
      ? (() => {
          const demoUrls = getDemoTemplateUrls();
          return THEME_MANIFESTS.filter(
            (manifest) =>
              manifest.status === "stable" &&
              (manifest.id === theme.id || demoUrls[manifest.id]),
          ).map((manifest) => ({
            id: manifest.id,
            name: manifest.name,
            description: manifest.description,
            preview: manifest.preview?.card,
            url: demoUrls[manifest.id],
          }));
        })()
      : null;

  // Strip protocol and trailing slash — Plausible data-domain must be bare hostname
  const plausibleDomain = analytics?.plausibleDomain
    ? analytics.plausibleDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : null;
  const plausibleScriptSrc = plausibleDomain
    ? analytics?.plausibleSelfHosted && analytics?.plausibleBaseUrl
      ? `${analytics.plausibleBaseUrl.replace(/\/$/, "")}/js/script.js`
      : "https://plausible.io/js/script.js"
    : null;

  return (
    <>
      <JsonLd
        id="organization-jsonld"
        data={generateOrganizationJsonLd({
          storeName,
          storeDescription,
          logoUrl,
          storePhone,
          socialUrls: [
            social.facebookUrl,
            social.twitterUrl,
            social.instagramUrl,
            social.youtubeUrl,
            social.linkedinUrl,
            social.tiktokUrl,
          ],
          availableLocales: enabledLocales,
        })}
      />
      <JsonLd
        id="website-jsonld"
        data={generateWebsiteJsonLd({ storeName, locale })}
      />
      <StorefrontRefresh />
      {/* Portaled overlays (sheets, dropdowns) mount on <body>, outside the
          surface div below — this mirrors the theme attributes/vars there so
          they wear the same radius, accent, and button shape. */}
      <StoreThemeBodySync
        themeId={theme.id}
        dataAttributes={themeSurface.attributes}
        vars={themeSurface.vars}
      />
      {/* Framed by the admin's Themes editor only: re-applies the unsaved
          tokens it posts, so the preview beside the controls is live. */}
      <ThemePreviewBridge brand={brand.colors} defaults={theme.defaults} />
      <ScrollResetOnNavigate />
      {/* Every storefront card renders the ONE configurator card; a theme
          seeds its own template into the config on activation. */}
      <ProductCardConfigProvider config={productCardConfig}>
      <CartProvider>
      {/* One quick-view modal for the whole storefront; cards without a
          surface-level handler fall back to it. Inside CartProvider — the
          modal's add-to-cart needs it. */}
      <QuickViewProvider locale={locale as Locale}>
        {/* Plausible Analytics */}
        {plausibleDomain && plausibleScriptSrc && (
          <Script
            defer
            data-domain={plausibleDomain}
            src={plausibleScriptSrc}
            strategy="afterInteractive"
          />
        )}
        <Suspense fallback={null}>
          <StorefrontAnalytics
            googleAnalyticsId={analytics?.googleAnalyticsId}
            googleTagManagerId={analytics?.googleTagManagerId}
            facebookPixelId={analytics?.facebookPixelId}
            tiktokPixelId={analytics?.tiktokPixelId}
          />
        </Suspense>
        {/* data-container releases the `.container` width cap when the theme
            says "full"; data-store-theme keys the active theme's design
            tokens — both rules live in globals.css so every section obeys
            without knowing the settings exist. */}
        {/* Focused checkout, decided in the SHELL: the checkout segment's
            marker layout flushes with this one, so this :has() rule hides
            the chrome on the first paint of any /checkout page — the late
            <style> inside CheckoutChrome (kept as a non-:has() fallback)
            used to arrive after the header had already painted. */}
        {checkoutSettings.layout.chrome === "focused" ? (
          <style>{`.store-surface:has([data-checkout-segment]) [data-store-chrome]{display:none}`}</style>
        ) : null}
        <div
          className="store-surface min-h-screen flex flex-col bg-background"
          data-store-theme={theme.id}
          {...themeSurface.attributes}
          style={themeSurface.vars as React.CSSProperties}
        >
          {/* data-store-chrome lets the group draft preview hide the live
              chrome piece it is previewing a replacement for. Both wrappers
              are display:contents — a real box here would bound the sticky
              header bar to its own height and it would never stick. */}
          <div data-store-chrome="header" className="contents">
            <StoreSections
              sections={headerGroup.sections}
              ctx={groupCtx}
              className="contents"
            />
          </div>
          {/* Measures the chrome above so a full-height hero fills exactly
              the first viewport under it. */}
          <StoreChromeHeight />
          <main className="flex-1">{children}</main>
          <div data-store-chrome="footer">
            <StoreSections sections={footerGroup.sections} ctx={groupCtx} />
          </div>
          {/* "extras" groups the floating chrome (bottom nav + its height
              reservation + assistant) so the focused-checkout mode can hide
              everything chrome in one [data-store-chrome] rule. */}
          {demoTemplates ? (
            <TemplateDemoPill
              locale={locale}
              activeThemeId={theme.id}
              templates={demoTemplates}
            />
          ) : null}
          <div data-store-chrome="extras" className="shrink-0">
            {/* Reserves the space the fixed bottom nav occupies so it never
                covers the end of the footer. */}
            <div
              aria-hidden="true"
              className="h-[calc(3.75rem+env(safe-area-inset-bottom))] xl:hidden"
            />
            <CompareBar locale={locale as Locale} />
            <AISalesAgentWidget locale={locale as Locale} />
            <StoreBottomNav
              locale={locale as Locale}
              oauthEnabled={{
                google: authSettings.googleOAuthEnabled,
                facebook: authSettings.facebookOAuthEnabled,
              }}
              demoModeEnabled={authSettings.demoMode}
              emailVerificationRequired={authSettings.emailVerificationRequired}
            />
          </div>
        </div>
      </QuickViewProvider>
      </CartProvider>
      </ProductCardConfigProvider>
    </>
  );
}
