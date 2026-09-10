import { setRequestLocale } from "next-intl/server";
import { ProductCardConfigProvider } from "@/components/products/product-card-config-context";
import { CartProvider } from "@/hooks/use-cart";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { compileTheme } from "@/lib/storefront/themes/compile";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * The chrome-less shell for the builder's per-section preview frames.
 *
 * A section frame needs exactly what a section renders with — the theme
 * surface (tokens, attributes, container rules), the card configurator and a
 * cart context for the product cards — and nothing a shopper's page carries
 * around it: no header/footer groups, no analytics scripts, no assistant,
 * bottom nav, compare bar or scroll/refresh helpers, no JSON-LD. Under the
 * store layout each frame was a 366 KB document that booted the whole
 * storefront (session, cart, profile, assistant config, analytics pageview)
 * and did it again after every autosave.
 *
 * The cart provider is inert here: cards call `useCart()` at render, but a
 * frame is `pointer-events: none` and never adds anything, so it has no
 * reason to fetch the cart. The root providers skip the session and PWA
 * work for this route as well (see `isSectionPreviewPath`).
 */
export default async function SectionPreviewLayout({
  children,
  params,
}: LayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { theme, brand, productCardConfig } = await getStorefrontSettings();
  const themeSurface = compileTheme(theme.tokens, brand.colors);

  return (
    <ProductCardConfigProvider config={productCardConfig}>
      <CartProvider inert>
        <div
          className="store-surface bg-background"
          data-store-theme={theme.id}
          {...themeSurface.attributes}
          style={themeSurface.vars as React.CSSProperties}
        >
          {children}
        </div>
      </CartProvider>
    </ProductCardConfigProvider>
  );
}
