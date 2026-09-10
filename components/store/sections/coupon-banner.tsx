import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { type Locale } from "@/config/i18n.config";
import { getStoreMoneyFormatter } from "@/lib/intl/server-currency";
import { backgroundCss, type SlideBackground } from "@/lib/sliders/types";
import {
  describeCouponCondition,
  describeCouponOffer,
  formatCouponEnds,
  getStorefrontCoupon,
  isCouponLive,
} from "@/lib/storefront/storefront-coupon";
import { sectionEmptyState } from "./section-empty-state";
import { CouponCodeButton } from "./coupon-code-button";
import { isExternalSectionHref, resolveSectionHref } from "./section-shell";
import type { SectionRenderContext } from "@/lib/storefront/sections/types";

interface CouponBannerProps {
  locale: Locale;
  /** The discount this banner advertises; everything else is derived from it. */
  code: string;
  /** Overrides the offer line. Empty means "say what the discount is worth". */
  heading: string;
  /** Overrides the condition line. Empty means "say what the discount needs". */
  subheading: string;
  showExpiry: boolean;
  ctaLabel: string;
  href: string;
  /** A colour, a gradient or an image; unset keeps the dark plate. */
  background: SlideBackground;
  ctx: Pick<SectionRenderContext, "preview">;
}

/**
 * The "GET 20% OFF — use code VIBE20" strip, built the way promotional
 * banners are built everywhere: the offer as a number, the condition under
 * it, the code as a ticket you can copy, and one button.
 *
 * The discount is the source of truth, not the copy. A merchant used to type
 * both the headline and the code, so a banner could advertise 20% over a code
 * worth 15, or a code checkout had never heard of. Now the offer, the minimum
 * spend and the end date are all read from the discount itself, and the
 * section hides when that discount stops working — a banner for a dead code
 * is worse than no banner.
 */
export async function CouponBanner({
  locale,
  code,
  heading,
  subheading,
  showExpiry,
  ctaLabel,
  href,
  background,
  ctx,
}: CouponBannerProps) {
  const [tHome, tCommon] = await Promise.all([
    getTranslations({ locale, namespace: "home" }),
    getTranslations({ locale, namespace: "common" }),
  ]);
  const say = (key: string, fallback: string, values?: Record<string, string>) =>
    tHome.has(key) ? tHome(key, values) : fallback;

  if (!code.trim()) {
    return sectionEmptyState(ctx, {
      title: "Coupon banner",
      hint: "Pick a discount for this banner to advertise. The offer, the minimum spend and the end date all come from it.",
    });
  }

  const coupon = await getStorefrontCoupon(code);

  // A discount that has ended, been paused, or has not started yet: the strip
  // goes quiet rather than sending shoppers to a rejection at checkout.
  if (coupon && !isCouponLive(coupon)) {
    return sectionEmptyState(ctx, {
      title: "Coupon banner",
      hint: `${coupon.code} is not running right now, so this banner is hidden on the storefront.`,
    });
  }

  const money = await getStoreMoneyFormatter();
  // A code with no discount behind it is left as the merchant wrote it —
  // some stores run codes this system never sees — so their own copy carries
  // the banner instead of derived text that would be a guess.
  const offer =
    heading.trim() || (coupon ? describeCouponOffer(coupon, money, say) : "");
  const condition =
    subheading.trim() ||
    (coupon ? describeCouponCondition(coupon, money, say) : "");
  const endsOn =
    showExpiry && coupon?.endDate
      ? formatCouponEnds(coupon.endDate, locale, say)
      : "";

  if (!offer) return null;

  const resolvedHref = href ? resolveSectionHref(locale, href) : "";
  // One muted line under the offer: two levels of type, never three.
  const meta = [condition, endsOn].filter(Boolean).join(" · ");

  return (
    <section className="py-5 lg:py-8">
      <div className="container mx-auto px-4">
        <div
          // The dark plate stays UNDER whatever is chosen: a colour or a
          // gradient covers it anyway, and an image that fails to load leaves
          // the strip its own look instead of white copy on nothing.
          className="relative overflow-hidden rounded-xl bg-foreground text-background"
          style={backgroundCss(background)}
        >
          {/* Copy on this strip is white, so artwork needs a scrim under it.
              A colour or a gradient the merchant chose does not — dimming
              their pick would make the control lie about the result. */}
          {background.type === "image" && background.image ? (
            <div className="absolute inset-0 bg-black/60" aria-hidden />
          ) : null}

          {/* Copy left, actions right: the eye reads the offer and its
              condition, then meets the code and the button as one cluster.
              A short band, not a hero — the padding is what keeps it from
              growing into one. */}
          <div className="relative flex flex-col gap-4 p-5 text-white sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:px-8 sm:py-6">
            <div className="min-w-0 space-y-1">
              <h2 className="text-[length:var(--sec-title,1.5rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.875rem)]">
                {offer}
              </h2>
              {meta ? (
                <p className="text-sm text-white/70">{meta}</p>
              ) : null}
            </div>

            {/* On a phone the code and the CTA are the row, not two chips in
                one: full width each, stacked, so neither ends up as a 117px
                button hanging under a 253px pill. */}
            <div className="flex w-full shrink-0 flex-col items-stretch gap-2.5 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
              <CouponCodeButton
                code={coupon?.code || code}
                copyLabel={tHome("copyCode")}
                copiedLabel={tCommon("copiedToClipboard")}
                className="border-white/60 bg-transparent text-white hover:bg-white/10 hover:text-white"
              />
              {ctaLabel && resolvedHref ? (
                <Button
                  asChild
                  className="h-11 w-full rounded-full bg-white px-6 text-sm font-medium text-black hover:bg-white/90 sm:w-auto"
                >
                  <Link
                    href={resolvedHref}
                    {...(isExternalSectionHref(href)
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    {ctaLabel}
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
