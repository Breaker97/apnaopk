import { CartProvider } from "@/hooks/use-cart";
import { type Locale } from "@/config/i18n.config";
import { setRequestLocale } from "next-intl/server";
import { StoreSections } from "@/components/store/store-sections";
import { StoreThemeBodySync } from "@/components/store/store-theme-body-sync";
import { getGroupSections } from "@/lib/storefront/pages/get-template";
import type { SectionRenderContext } from "@/lib/storefront/sections/types";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { compileTheme } from "@/lib/storefront/themes/compile";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export const dynamic = "force-dynamic";

/**
 * Sign-in, sign-up and the rest of the account flow wear the store's own
 * chrome: the header and footer GROUP documents (store)/layout.tsx renders,
 * through the same sections, so the header bar here is the one on the home
 * page — the same linked side-drawer menus, announcement bar and footer
 * columns — and never a copy of it that drifts.
 */
export default async function AuthLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [
    { theme, brand, defaultLanguage, isMultiVendorEnabled },
    headerGroup,
    footerGroup,
  ] = await Promise.all([
    getStorefrontSettings(),
    getGroupSections("header"),
    getGroupSections("footer"),
  ]);
  // Auth pages wear the store THEME too — same tokens and custom sheet as
  // (store)/layout.tsx, or /login renders different corners and accents
  // than the shop around it.
  const themeSurface = compileTheme(theme.tokens, brand.colors);

  const groupCtx: SectionRenderContext = {
    locale: locale as Locale,
    defaultLanguage,
    isMultiVendorEnabled,
    themeId: theme.id,
    themeSettings: theme.settings,
  };

  return (
    <CartProvider>
      <StoreThemeBodySync
        themeId={theme.id}
        dataAttributes={themeSurface.attributes}
        vars={themeSurface.vars}
      />
      <div
        className="store-surface min-h-screen flex flex-col bg-background"
        data-store-theme={theme.id}
        {...themeSurface.attributes}
        style={themeSurface.vars as React.CSSProperties}
      >
        {theme.customCss ? (
          <style
            data-store-custom-css=""
            dangerouslySetInnerHTML={{ __html: theme.customCss }}
          />
        ) : null}
        {/* "contents", as on the store: a real box would bound the sticky
            header bar to its own height and it would never stick. */}
        <StoreSections
          sections={headerGroup.sections}
          ctx={groupCtx}
          className="contents"
        />
        <main className="flex min-h-[calc(100svh-4rem)] items-center justify-center p-4 md:min-h-[calc(100svh-7.25rem)]">
          <div className="auth-stage w-full max-w-5xl [&>*:not(.auth-wide)]:mx-auto [&>*:not(.auth-wide)]:max-w-md">
            {children}
          </div>
        </main>
        <StoreSections sections={footerGroup.sections} ctx={groupCtx} />
      </div>
    </CartProvider>
  );
}
