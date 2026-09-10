import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Lock, ShoppingBag, Store } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { appConfig } from "@/config/app.config";
import type { CheckoutSettings } from "@/lib/checkout/checkout-config";

interface CheckoutChromeProps {
  locale: string;
  settings: CheckoutSettings;
  brand: {
    storeName: string;
    logoUrl: string;
    darkModeLogoUrl: string;
  };
  children: React.ReactNode;
}

/**
 * Wraps the checkout (and success) page content in the admin-chosen chrome.
 *
 * "store" mode renders the children untouched — the normal storefront
 * header/footer from the (store) layout stay visible. "focused" mode hides
 * every layout chrome piece via the same [data-store-chrome] hook the draft
 * preview uses, and renders a minimal logo + secure bar instead, so the
 * shopper has nowhere to go but through the payment.
 */
export async function CheckoutChrome({
  locale,
  settings,
  brand,
  children,
}: CheckoutChromeProps) {
  if (settings.layout.chrome !== "focused") {
    return <>{children}</>;
  }

  const t = await getTranslations({ locale });
  const storeName = brand.storeName.trim() || appConfig.name;
  const logoUrl = brand.logoUrl.trim();
  const darkLogoUrl = brand.darkModeLogoUrl.trim();

  return (
    <>
      {/* Fallback hide for browsers without :has(). The primary hide is the
          (store) layout's shell rule (scoped by the checkout segment's
          marker layout), which applies on first paint — this tag streams
          with the page chunk and would flash the header first on its own. */}
      <style>{`[data-store-chrome]{display:none}`}</style>

      <div className="border-b border-border bg-background">
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
          <Link
            href={`/${locale}`}
            className="flex min-w-0 items-center gap-2"
            aria-label={storeName}
          >
            {logoUrl ? (
              <>
                <AppImage
                  src={logoUrl}
                  alt={storeName}
                  className={
                    darkLogoUrl
                      ? "h-8 w-auto max-w-[160px] object-contain object-left dark:hidden"
                      : "h-8 w-auto max-w-[160px] object-contain object-left"
                  }
                  width={144}
                  height={32}
                  priority
                />
                {darkLogoUrl ? (
                  <AppImage
                    src={darkLogoUrl}
                    alt={storeName}
                    className="hidden h-8 w-auto max-w-[160px] object-contain object-left dark:block"
                    width={144}
                    height={32}
                    priority
                  />
                ) : null}
              </>
            ) : (
              <>
                <Store className="h-6 w-6 shrink-0 text-primary" />
                <span className="truncate text-xl font-bold">{storeName}</span>
              </>
            )}
          </Link>

          <div className="flex shrink-0 items-center gap-4">
            {settings.trust.showSecureBadge ? (
              <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
                <Lock className="h-3.5 w-3.5" />
                {t("product.secureCheckout")}
              </span>
            ) : null}
            <Link
              href={`/${locale}/cart`}
              aria-label={t("checkout.editCart")}
              title={t("checkout.editCart")}
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ShoppingBag className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </div>

      {children}

      <div className="border-t border-border bg-background">
        <p className="container mx-auto px-4 py-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} {storeName}
        </p>
      </div>
    </>
  );
}
