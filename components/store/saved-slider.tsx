"use client";

import Link from "next/link";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import { CountdownTimer } from "@/components/store/sections/countdown-timer";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import { useTranslations } from "next-intl";
import Autoplay from "embla-carousel-autoplay";
import Fade from "embla-carousel-fade";
import useEmblaCarousel from "embla-carousel-react";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { RenderSliderSlide } from "@/lib/sliders/render";
import {
  buildGradientCss,
  cqw,
  ctaBoxCss,
  ctaVariantChrome,
  fixedSizeVars,
  imageLayerStyle,
  resolveImageLayout,
  resolveSlideLayout,
  resolveTextStyle,
  SLIDE_PRICE_PX,
  SLIDE_TEXT_CSS,
  textStyleVars,
  type SliderSlide,
  type SlideTextElement,
} from "@/lib/sliders/types";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/**
 * Storefront renderer for a saved Slider (the reusable, admin-authored slide
 * groups under Online Store → Sliders). Rich per-slide model: solid/gradient/
 * image backgrounds, per-text styling, per-device content placement (via the
 * `.sl-content` CSS-var machinery in globals.css), reveal animations, and a
 * product cutout beside the copy. Price arrives resolved server-side — see
 * lib/sliders/render.ts.
 */

interface SavedSliderProps {
  slides: RenderSliderSlide[];
  className?: string;
  transition?: "slide" | "fade";
  autoplayDelayMs?: number;
}

const JUSTIFY: Record<string, string> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};
const ALIGN: Record<string, string> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

/** One custom-property set per shape; the container queries pick between them. */
const SHAPE_KEYS = [
  ["l", "landscape"],
  ["s", "square"],
  ["p", "portrait"],
] as const;

function layoutVars(slide: SliderSlide): CSSProperties {
  const vars: Record<string, string> = {};
  for (const [suffix, shape] of SHAPE_KEYS) {
    const layout = resolveSlideLayout(slide, shape);
    vars[`--sl-jc-${suffix}`] = JUSTIFY[layout.h];
    vars[`--sl-ai-${suffix}`] = ALIGN[layout.v];
    vars[`--sl-ta-${suffix}`] = layout.h;
    vars[`--sl-gap-${suffix}`] = cqw(layout.gap, shape);
    vars[`--sl-scale-${suffix}`] = `${layout.scale / 100}`;
  }
  return vars as CSSProperties;
}

/** The artwork layer's per-device placement, as CSS custom properties. */
function artVars(slide: SliderSlide): CSSProperties {
  const vars: Record<string, string> = {};
  for (const [suffix, shape] of SHAPE_KEYS) {
    const { container, art } = imageLayerStyle(
      resolveImageLayout(slide, shape),
    );
    vars[`--sl-art-jc-${suffix}`] = container.justifyContent;
    vars[`--sl-art-ai-${suffix}`] = container.alignItems;
    vars[`--sl-art-w-${suffix}`] = art.width;
    vars[`--sl-art-t-${suffix}`] = art.transform;
  }
  return vars as CSSProperties;
}

/**
 * Every text renders from CSS custom properties rather than baked values, so
 * one DOM serves all three bands: the element carries -l/-s/-p sets and the
 * `.sl-text` rules in globals.css alias whichever the cell's aspect selects.
 */
function textStyleCss(
  slide: SliderSlide,
  element: SlideTextElement,
  fallbackColor: string,
): CSSProperties {
  return {
    ...textStyleVars(slide, element, fallbackColor),
    ...SLIDE_TEXT_CSS,
    width: "var(--wd)",
    maxWidth: "100%",
  } as CSSProperties;
}

function slideHasContent(slide: RenderSliderSlide): boolean {
  const e = slide.elements;
  return Boolean(
    (e.tagline && slide.texts.tagline) ||
      (e.heading && slide.texts.heading) ||
      (e.description && slide.texts.description) ||
      (e.cta && slide.texts.cta) ||
      slide.price ||
      (e.countdown && slide.countdownEndsAt),
  );
}

function SlidePrice({
  price,
  label,
  style,
  className,
}: {
  price: NonNullable<RenderSliderSlide["price"]>;
  label: string;
  style: CSSProperties;
  className?: string;
}) {
  const { formatPrice } = useCurrency();
  return (
    <p className={cn("flex flex-wrap items-baseline gap-x-2", className)} style={style}>
      <span className="text-[0.6em] opacity-80">{label}</span>
      <span className="font-bold">{formatPrice(price.amount)}</span>
      {price.compareAt !== undefined ? (
        <span className="text-[0.6em] opacity-60 line-through">
          {formatPrice(price.compareAt)}
        </span>
      ) : null}
    </p>
  );
}

export function SavedSlider({
  slides,
  className,
  transition = "slide",
  autoplayDelayMs = 5000,
}: SavedSliderProps) {
  const t = useTranslations("home");
  const tf = useFallbackTranslator(t);

  const validSlides = slides.filter(
    (slide) =>
      slideHasContent(slide) ||
      slide.background.type !== "solid" ||
      slide.productImage,
  );

  // One slide has nowhere to go: no drag, no loop, no autoplay — a swipe
  // that rubber-bands back reads as a broken carousel, not a still image.
  const canScroll = validSlides.length > 1;
  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: canScroll, watchDrag: canScroll },
    [
      ...(canScroll
        ? [
            Autoplay({
              delay: autoplayDelayMs,
              stopOnInteraction: false,
              stopOnMouseEnter: true,
            }),
          ]
        : []),
      ...(transition === "fade" ? [Fade()] : []),
    ],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi, onSelect]);

  if (!validSlides.length) {
    return (
      <div
        className={cn(
          "relative grid place-items-center overflow-hidden rounded-md border border-dashed border-border bg-muted/40",
          "aspect-[1360/314]",
          className,
        )}
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(15,23,42,0.08) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      >
        <ImageOff className="h-10 w-10 text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div
      // `sl-frame` makes this the query container: every slide inside picks
      // its arrangement from THIS box's aspect, so the same slider adapts to
      // whatever cell it was dropped into.
      className={cn(
        "sl-frame relative overflow-hidden rounded-md bg-muted",
        "aspect-[1360/314]",
        className,
      )}
    >
      <div ref={emblaRef} className="h-full overflow-hidden">
        <div className="flex h-full">
          {validSlides.map((slide, index) => {
            const isImageBg = slide.background.type === "image";
            // Copy defaults to light-on-dark only over artwork (where the
            // scrim guarantees contrast); solid and gradient plates default
            // to dark copy. Explicit per-text colors always win.
            const fallbackColor = isImageBg ? "#ffffff" : "#1f2937";
            const isActive = index === selectedIndex;
            const reveal =
              slide.reveal !== "none" && isActive
                ? `sl-reveal-${slide.reveal}`
                : undefined;

            const content = slideHasContent(slide) ? (
              <div
                // Re-mounting on activation restarts the reveal animation
                // each time the slide comes around.
                key={isActive ? "active" : "idle"}
                // `sl-stack` spans the padded slide and carries the band's
                // alignment and gap, so each text's stored width is a share of
                // the same box the editor measured it against.
                className={cn("sl-stack min-w-0", reveal)}
              >
                {slide.elements.tagline && slide.texts.tagline ? (
                  <p
                    className="sl-text uppercase tracking-[0.2em]"
                    style={textStyleCss(slide, "tagline", fallbackColor)}
                  >
                    {slide.texts.tagline}
                  </p>
                ) : null}
                {slide.elements.heading && slide.texts.heading ? (
                  <h2
                    className="sl-text whitespace-pre-line"
                    style={textStyleCss(slide, "heading", fallbackColor)}
                  >
                    {slide.texts.heading}
                  </h2>
                ) : null}
                {slide.elements.description && slide.texts.description ? (
                  <p
                    className="sl-text whitespace-pre-line"
                    style={textStyleCss(slide, "description", fallbackColor)}
                  >
                    {slide.texts.description}
                  </p>
                ) : null}
                {slide.price ? (
                  <SlidePrice
                    price={slide.price}
                    label={tf("startingAt", "Starting at")}
                    // Needs its own -l/-s/-p set: `.sl-text` only aliases
                    // properties the element itself declares, so without these
                    // the size expression resolved against nothing and the
                    // price silently fell back to the inherited font.
                    className="sl-text"
                    style={{
                      ...fixedSizeVars(SLIDE_PRICE_PX),
                      color: fallbackColor,
                      fontSize: SLIDE_TEXT_CSS.fontSize,
                    }}
                  />
                ) : null}
                {slide.elements.countdown && slide.countdownEndsAt ? (
                  <CountdownTimer
                    endsAt={slide.countdownEndsAt}
                    size="sm"
                    hideWhenExpired
                    labels={{
                      days: tf("countdownDays", "Days"),
                      hours: tf("countdownHours", "Hours"),
                      minutes: tf("countdownMinutes", "Mins"),
                      seconds: tf("countdownSeconds", "Secs"),
                    }}
                  />
                ) : null}
                {slide.elements.cta && slide.texts.cta ? (
                  // The width sits on the BUTTON, not a wrapper: `auto` has to
                  // mean "as wide as the label", and a `w-full` child of an
                  // auto-width parent collapses to nothing instead.
                  <Button
                    asChild={Boolean(slide.href)}
                    className="sl-text h-auto rounded-md transition-opacity hover:opacity-90"
                    style={{
                      ...textStyleVars(
                        slide,
                        "cta",
                        ctaVariantChrome(slide.ctaVariant).textColor,
                      ),
                      fontSize: SLIDE_TEXT_CSS.fontSize,
                      fontWeight: SLIDE_TEXT_CSS.fontWeight,
                      fontStyle: SLIDE_TEXT_CSS.fontStyle,
                      color: SLIDE_TEXT_CSS.color,
                      // The button base class carries a FIXED text-sm line
                      // height; at cqw-driven sizes that squeezed (or padded)
                      // the label relative to the editor's 1.2.
                      lineHeight: SLIDE_TEXT_CSS.lineHeight,
                      backgroundColor: ctaVariantChrome(slide.ctaVariant)
                        .background,
                      border: ctaVariantChrome(slide.ctaVariant).border,
                      width: "var(--wd)",
                      // `em` so the chrome grows and shrinks with the label
                      // instead of staying a fixed pill in a small tile —
                      // unless the merchant set a px padding.
                      ...ctaBoxCss(resolveTextStyle(slide, "cta")),
                    }}
                  >
                    {slide.href ? (
                      <Link href={slide.href}>{slide.texts.cta}</Link>
                    ) : (
                      <span>{slide.texts.cta}</span>
                    )}
                  </Button>
                ) : null}
              </div>
            ) : null;

            const body = (
              <>
                {/* Background layers */}
                {slide.background.type === "solid" && slide.background.color ? (
                  <div
                    className="absolute inset-0"
                    style={{ backgroundColor: slide.background.color }}
                    aria-hidden
                  />
                ) : null}
                {slide.background.type === "gradient" &&
                slide.background.gradient ? (
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: buildGradientCss(
                        slide.background.gradient,
                      ),
                    }}
                    aria-hidden
                  />
                ) : null}
                {isImageBg && slide.background.image ? (
                  <>
                    {/* The bg takes the frame's exact width AND height: the
                        full image always shows, conforming to whatever size
                        the section's Width/Height settings produce — never
                        cropped to the frame's shape. */}
                    <AppImage
                      src={slide.background.image}
                      alt={slide.alt || ""}
                      fill
                      sizes="100vw"
                      priority={index === 0}
                      className="object-fill"
                    />
                    {content ? (
                      <div
                        className="absolute inset-0 bg-black/25"
                        aria-hidden
                      />
                    ) : null}
                  </>
                ) : null}

                {/* Artwork layer — its own placement, BEHIND the copy and
                    free to be overlapped, exactly as arranged in the editor. */}
                {slide.productImage ? (
                  <div
                    // Placement and inset both come from the container-query
                    // blocks in globals.css, keyed on this frame's aspect.
                    className="sl-art absolute inset-0"
                    style={artVars(slide)}
                  >
                    <div className="sl-art-box relative">
                      <AppImage
                        src={slide.productImage}
                        alt={slide.alt || ""}
                        width={800}
                        height={800}
                        // The first slide's shot is the home page's LCP element;
                        // lazy, it waited for layout and the slider chunk before
                        // the browser even requested it.
                        priority={index === 0}
                        sizes="(max-width: 640px) 60vw, 40vw"
                        className="h-auto w-full object-contain"
                      />
                    </div>
                  </div>
                ) : null}

                {/* Copy layer — placed against the same canvas, on top. */}
                <div
                  className="sl-content absolute inset-0"
                  style={layoutVars(slide)}
                >
                  {content}
                </div>
              </>
            );

            return (
              <div
                key={slide.id}
                className="relative h-full min-w-0 flex-[0_0_100%]"
              >
                {/* The whole slide is the link only when no CTA competes. */}
                {slide.href && !(slide.elements.cta && slide.texts.cta) ? (
                  <Link href={slide.href} className="block h-full w-full">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </div>
            );
          })}
        </div>
      </div>

      {validSlides.length > 1 && (
        <div className="absolute bottom-2 right-3 flex items-center gap-1.5 sm:bottom-4 sm:right-4">
          {validSlides.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => emblaApi?.scrollTo(index)}
              aria-label={`Go to slide ${index + 1}`}
              aria-current={selectedIndex === index}
              className={cn(
                // The dot stays 6px tall — it is a position indicator, not a
                // button people should see — but the pseudo-element gives it
                // a 40px reach, which is what a thumb needs to jump slides.
                "relative h-1.5 rounded-full transition-all duration-300 before:absolute before:-inset-x-1 before:-inset-y-4 before:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                selectedIndex === index
                  ? "w-6 bg-foreground"
                  : "w-1.5 bg-foreground/30 hover:bg-foreground/50",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
