import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { getStorefrontProductCards } from "@/lib/products/storefront-product-cards";
import { getProductDiscountPercentage } from "@/lib/products/price-display";
import {
  backgroundCss,
  hasBackground,
  type SlideBackground,
} from "@/lib/sliders/types";
import type { DealLayout } from "@/lib/storefront/sections/deal-layouts";
import { CountdownTimer } from "@/components/store/sections/countdown-timer";
import { ElectronicsDealsProducts } from "@/components/store/sections/themes/electronics-deals-products";
import {
  isExternalSectionHref,
  resolveSectionHref,
} from "@/components/store/sections/section-shell";
import { cn } from "@/lib/utils";

/**
 * The design's field with its 54% scrim already folded into the stops, so
 * the panel needs no overlay to look as it always has — and a merchant's
 * own colour or gradient is painted exactly as picked, undimmed.
 */
const DESIGN_FIELD =
  "linear-gradient(180deg, #171d75 0%, #522b75 100%)";

/**
 * Whether the deadline has passed. A function rather than a comparison in
 * the render body: the compiler's purity rule forbids reading the clock
 * there, and the server decides expiry once per request in any case.
 */
function hasPassed(deadline: number): boolean {
  return deadline <= Date.now();
}

/**
 * Electronics' deadline strip: the DEALS panel — a two-tone heading, white
 * countdown cards and a "view all" pill on a coloured field, with the
 * products the deadline is about laid out beneath in the arrangement the
 * merchant chose.
 *
 * Built the way deals panels are built everywhere: the sale named, the
 * deadline as the anchor, the deals with their maths shown, one button, and
 * the two signals that make urgency credible — the biggest saving on show
 * and how few are left — both read off the products rather than typed, so
 * neither can be switched on to say something untrue.
 *
 * The panel hides once the deadline passes, the way the image banner
 * already did: a countdown frozen at zero is the worst state this section
 * can be in.
 */
export async function ElectronicsDeals({
  locale,
  heading,
  subheading,
  endsAt,
  ctaLabel,
  href,
  productIds = [],
  layout,
  background,
  foreground,
  showSavings,
  showStock,
  minHeight,
  emptyState = null,
  expiredState = null,
}: {
  locale: Locale;
  heading: string;
  subheading: string;
  endsAt: string;
  ctaLabel: string;
  href: string;
  /** Hand-picked deals in slot order; empty means "whatever is on sale". */
  productIds?: string[];
  layout: DealLayout;
  /** Unset keeps the design's own field. */
  background: SlideBackground;
  /** "" keeps white, the design's own copy colour. */
  foreground: string;
  showSavings: boolean;
  showStock: boolean;
  /** Desktop floor in px; the panel grows past it to fit its content. */
  minHeight: number;
  /** Labelled outline for the admin preview; null on the live storefront. */
  emptyState?: React.ReactNode;
  expiredState?: React.ReactNode;
}) {
  const deadline = Date.parse(endsAt);
  const hasDeadline = Boolean(endsAt) && !Number.isNaN(deadline);

  // A countdown with no deadline has nothing to say. Live storefronts stay
  // silent; the admin preview shows which field is missing.
  if (!hasDeadline) return emptyState;
  if (hasPassed(deadline)) return expiredState;

  const t = await getTranslations({ locale, namespace: "home" });
  const chosen = productIds.filter(Boolean).slice(0, layout.slots);

  const products = await getStorefrontProductCards(
    chosen.length > 0
      ? { ids: chosen, limit: chosen.length }
      : { onSale: true, limit: layout.slots },
  ).catch(() => []);

  // The biggest saving on show — read, never typed.
  const topSaving = products.reduce(
    (best, product) => Math.max(best, getProductDiscountPercentage(product)),
    0,
  );
  const savingsLabel =
    showSavings && topSaving > 0
      ? t.has("dealsUpTo")
        ? t("dealsUpTo", { percent: topSaving })
        : `Up to ${topSaving}% off`
      : "";

  const target = href ? resolveSectionHref(locale, href) : "";
  const external = isExternalSectionHref(href);
  const painted = hasBackground(background);
  const fg = foreground || "#ffffff";

  return (
    <section className="py-5 lg:py-8">
      <div className="container mx-auto px-4">
        <div
          // The floor applies from lg only: on a phone the panel is a head
          // and a rail, and a thousand pixels of field under them would be
          // empty screen. Slack goes to the product plane, which stretches
          // its cards into it — a taller panel means bigger cards, not a
          // wider margin.
          className="relative flex flex-col overflow-hidden rounded-2xl px-4 pb-5 pt-7 sm:px-5 lg:px-6 lg:pt-10 lg:[min-height:var(--deal-min-h)]"
          style={{
            ...(painted
              ? backgroundCss(background)
              : { backgroundImage: DESIGN_FIELD }),
            color: fg,
            // Every tinted surface inside reads its colour from here, so a
            // merchant who picks a light field gets dark copy everywhere.
            ["--deal-fg" as string]: fg,
            ["--deal-min-h" as string]: `${minHeight}px`,
          }}
        >
          {/* Copy over a photo needs a scrim; a colour or gradient the
              merchant chose is shown as picked. */}
          {background.type === "image" && background.image ? (
            <div className="absolute inset-0 bg-black/55" aria-hidden />
          ) : null}

          {/* The head: what the sale is (left), when it ends (middle), and
              where to see all of it (right). On a phone it is two lines —
              the name with the link beside it, then the ticker. */}
          <div className="relative flex flex-wrap items-end gap-x-3 gap-y-4 pb-6 sm:flex-col sm:flex-nowrap sm:items-stretch sm:gap-6 sm:pb-8 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:px-6 lg:pb-10">
            <div className="min-w-0 flex-1 sm:flex-none">
              {subheading ? (
                <p className="text-[15px] leading-snug tracking-[-0.02em] opacity-90">
                  {subheading}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {heading ? (
                  // Fluid, because 38px is only safe for the word the design
                  // was drawn with: a merchant's longer heading ran to three
                  // lines on a phone and pushed the countdown off the panel.
                  // The fade runs from the copy colour into its own 45%.
                  <h2
                    className="-mt-1 bg-clip-text text-[clamp(26px,8.5vw,38px)] font-bold uppercase leading-[1.15] tracking-[-0.03em] text-transparent sm:text-[46px]"
                    style={{
                      backgroundImage:
                        "linear-gradient(90deg, var(--deal-fg) 30%, color-mix(in srgb, var(--deal-fg) 45%, transparent))",
                    }}
                  >
                    {heading}
                  </h2>
                ) : null}
                {savingsLabel ? (
                  // The sale's size, beside its name: the number a shopper
                  // is deciding on, before they read a single card.
                  <span className="rounded-full border border-current/25 px-3 py-1 text-[12px] font-bold tracking-[-0.01em] sm:text-[13px] bg-[color-mix(in_srgb,var(--deal-fg)_14%,transparent)]">
                    {savingsLabel}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="order-2 flex w-full flex-wrap items-center gap-2.5 sm:order-none sm:w-auto sm:gap-4 lg:gap-7">
              <span className="text-[12px] font-bold tracking-[-0.03em] opacity-45 sm:text-[15px]">
                {t("countdownEndsIn")}
              </span>
              <CountdownTimer
                endsAt={endsAt}
                appearance="cards"
                labels={{
                  days: t("countdownDays"),
                  hours: t("countdownHours"),
                  minutes: t("countdownMinutes"),
                  seconds: t("countdownSeconds"),
                }}
              />
            </div>

            {ctaLabel && target ? (
              <Link
                href={target}
                {...(external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                data-slot="button"
                className={cn(
                  "order-1 flex shrink-0 items-center gap-1 self-end pb-1 text-[12px] font-bold opacity-90 transition-opacity hover:opacity-100",
                  "sm:order-none sm:h-10 sm:w-fit sm:min-w-[190px] sm:justify-center sm:gap-0 sm:self-auto sm:rounded-full sm:pb-0 sm:px-8 sm:opacity-100",
                  "sm:bg-[color-mix(in_srgb,var(--deal-fg)_18%,transparent)] sm:hover:bg-[color-mix(in_srgb,var(--deal-fg)_28%,transparent)]",
                )}
              >
                {ctaLabel}
                <ArrowRight className="size-3.5 sm:hidden rtl:rotate-180" aria-hidden />
              </Link>
            ) : null}
          </div>

          {products.length > 0 ? (
            <div className="relative lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
              <ElectronicsDealsProducts
                products={products}
                locale={locale}
                layout={layout}
                showStock={showStock}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
