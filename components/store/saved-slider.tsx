"use client";

import Link from "next/link";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import {
  SlideView,
  slideHasContent,
  type SlideCtaBox,
  type SlideImageProps,
  type SlideViewLabels,
} from "@/components/store/slide-view";
import {
  trackSliderClick,
  useSliderImpressions,
} from "@/components/store/slider-tracker";
import { ChevronLeft, ChevronRight, ImageOff, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import { useTranslations } from "next-intl";
import Autoplay from "embla-carousel-autoplay";
import Fade from "embla-carousel-fade";
import useEmblaCarousel from "embla-carousel-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RenderSliderSlide } from "@/lib/sliders/render";
import {
  DEFAULT_SLIDER_CONTROLS,
  SLIDE_SHAPE_ASPECT_CLASS,
  type SliderControls,
} from "@/lib/sliders/types";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/**
 * Storefront renderer for a saved Slider (the reusable, admin-authored slide
 * groups under Online Store → Sliders): the carousel around `SlideView`,
 * which draws each slide exactly as the editor's artboard does. This file
 * adds only what a shop needs on top — optimised images, links, autoplay
 * with its pause control, arrows and indicators, the carousel's
 * accessibility, and the impression and click counts. Price arrives resolved
 * server-side — see lib/sliders/render.ts.
 */

interface SavedSliderProps {
  slides: RenderSliderSlide[];
  className?: string;
  transition?: "slide" | "fade";
  autoplayDelayMs?: number;
  controls?: SliderControls;
  /** The slider's handle; with one, views and clicks are counted per slide. */
  handle?: string;
}

/** The storefront's pictures: optimised, and the first slide's eager. */
function storeImage(
  kind: "background" | "art",
  { src, alt, className, style, priority }: SlideImageProps,
): ReactNode {
  return kind === "background" ? (
    <AppImage
      src={src}
      alt={alt}
      fill
      sizes="100vw"
      priority={priority}
      className={className}
      style={style}
    />
  ) : (
    <AppImage
      src={src}
      alt={alt}
      width={800}
      height={800}
      // The first slide's shot is the home page's LCP element; lazy, it
      // waited for layout and the slider chunk before the browser even
      // requested it.
      priority={priority}
      sizes="(max-width: 640px) 60vw, 40vw"
      className={className}
      style={style}
    />
  );
}

/** Whether the visitor asked their system for less motion; false until known. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

const DOTS_POSITION: Record<SliderControls["dotsPosition"], string> = {
  start: "left-3 sm:left-4",
  center: "left-1/2 -translate-x-1/2",
  end: "right-3 sm:right-4",
};

export function SavedSlider({
  slides,
  className,
  transition = "slide",
  autoplayDelayMs = 5000,
  controls = DEFAULT_SLIDER_CONTROLS,
  handle,
}: SavedSliderProps) {
  const t = useTranslations("home");
  const tf = useFallbackTranslator(t);
  const { formatPrice } = useCurrency();
  const reduceMotion = useReducedMotion();
  const frameRef = useRef<HTMLDivElement | null>(null);

  const labels: SlideViewLabels = useMemo(
    () => ({
      startingAt: tf("startingAt", "Starting at"),
      countdown: {
        days: tf("countdownDays", "Days"),
        hours: tf("countdownHours", "Hours"),
        minutes: tf("countdownMinutes", "Mins"),
        seconds: tf("countdownSeconds", "Secs"),
      },
    }),
    [tf],
  );

  const validSlides = slides.filter(
    (slide) =>
      slideHasContent(slide, slide.price) ||
      slide.background.type !== "solid" ||
      slide.productImage,
  );

  // One slide has nowhere to go: no drag, no loop, no autoplay — a swipe
  // that rubber-bands back reads as a broken carousel, not a still image.
  // Autoplay also stays off for a visitor who asked for less motion.
  const canScroll = validSlides.length > 1;
  const autoplays = canScroll && !reduceMotion;
  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: canScroll, watchDrag: canScroll },
    [
      ...(autoplays
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
  const [paused, setPaused] = useState(false);

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

  const togglePause = () => {
    const autoplay = emblaApi?.plugins().autoplay;
    if (!autoplay) return;
    if (paused) autoplay.play();
    else autoplay.stop();
    setPaused(!paused);
  };

  // The slide on show is the one that counts as seen.
  const current = validSlides[selectedIndex];
  useSliderImpressions(frameRef, handle, current?.id);

  if (!validSlides.length) {
    return (
      <div
        className={cn(
          "relative grid place-items-center overflow-hidden rounded-md border border-dashed border-border bg-muted/40",
          SLIDE_SHAPE_ASPECT_CLASS.landscape,
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

  const showArrows = canScroll && controls.arrows !== "none";
  const showDots = canScroll && controls.dots !== "none";
  const showPause = autoplays && controls.pause;
  const arrowClass = `sl-arrow sl-arrow--${controls.arrows}`;

  return (
    <div
      ref={frameRef}
      // `sl-frame` makes this the query container: every slide inside picks
      // its arrangement from THIS box's aspect, so the same slider adapts to
      // whatever cell it was dropped into.
      className={cn(
        "sl-frame relative overflow-hidden rounded-md bg-muted",
        controls.arrowsPosition === "bottom" && "sl-arrows--bottom",
        SLIDE_SHAPE_ASPECT_CLASS.landscape,
        className,
      )}
      role="region"
      aria-roledescription="carousel"
      aria-label={tf("slideshow", "Slideshow")}
    >
      <div
        ref={emblaRef}
        className="h-full overflow-hidden"
        // While the carousel moves on its own the change is not announced;
        // once paused, a slide change is read out.
        aria-live={autoplays && !paused ? "off" : "polite"}
      >
        <div className="flex h-full">
          {validSlides.map((slide, index) => {
            const hasCta =
              (slide.elements.cta && Boolean(slide.texts.cta)) ||
              (slide.elements.cta2 && Boolean(slide.texts.cta2));
            const click = () => {
              if (handle) trackSliderClick(handle, slide.id);
            };
            // The buttons link; the width sits on the BUTTON itself, not a
            // wrapper: `auto` has to mean "as wide as the label".
            const renderCta = ({
              element,
              className,
              style,
              attrs,
              text,
            }: SlideCtaBox) => {
              const href = element === "cta2" ? slide.href2 : slide.href;
              return (
                <Button
                  asChild={Boolean(href)}
                  {...attrs}
                  className={className}
                  style={style}
                  onClick={click}
                >
                  {href ? <Link href={href}>{text}</Link> : <span>{text}</span>}
                </Button>
              );
            };

            const body = (
              <SlideView
                slide={slide}
                price={slide.price}
                formatPrice={formatPrice}
                labels={labels}
                reveal={index === selectedIndex}
                priority={index === 0}
                renderImage={storeImage}
                renderCta={renderCta}
              />
            );

            return (
              <div
                key={slide.id}
                className="relative h-full min-w-0 flex-[0_0_100%]"
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} / ${validSlides.length}`}
                aria-hidden={index !== selectedIndex && canScroll ? true : undefined}
              >
                {/* The whole slide is the link only when no button competes. */}
                {slide.href && !hasCta ? (
                  <Link href={slide.href} className="block h-full w-full" onClick={click}>
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

      {showArrows ? (
        <>
          <button
            type="button"
            onClick={() => emblaApi?.scrollPrev()}
            aria-label={tf("previousSlide", "Previous slide")}
            className={cn(
              arrowClass,
              controls.arrowsPosition === "bottom" ? "left-3 sm:left-4" : "left-3 sm:left-4",
            )}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => emblaApi?.scrollNext()}
            aria-label={tf("nextSlide", "Next slide")}
            className={cn(
              arrowClass,
              controls.arrowsPosition === "bottom" ? "left-14 sm:left-16" : "right-3 sm:right-4",
            )}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      ) : null}

      {showDots || showPause ? (
        <div
          className={cn(
            "absolute bottom-2 z-[2] flex items-center gap-1.5 sm:bottom-4",
            DOTS_POSITION[controls.dotsPosition],
          )}
        >
          {showPause ? (
            <button
              type="button"
              onClick={togglePause}
              aria-label={
                paused ? tf("playSlideshow", "Play slideshow") : tf("pauseSlideshow", "Pause slideshow")
              }
              aria-pressed={paused}
              className="mr-1 grid h-7 w-7 place-items-center rounded-full bg-background/80 text-foreground backdrop-blur-sm transition hover:bg-background"
            >
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
          ) : null}
          {showDots
            ? validSlides.map((_, index) => {
                const active = selectedIndex === index;
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => emblaApi?.scrollTo(index)}
                    aria-label={`${tf("goToSlide", "Go to slide")} ${index + 1}`}
                    aria-current={active}
                    className={cn(
                      // The indicator stays small — it marks a position, not
                      // a button people should see — but the pseudo-element
                      // gives it a 40px reach, which is what a thumb needs.
                      "relative transition-all duration-300 before:absolute before:-inset-x-1 before:-inset-y-4 before:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      controls.dots === "dots" &&
                        cn(
                          "h-1.5 rounded-full",
                          active ? "w-6 bg-foreground" : "w-1.5 bg-foreground/30 hover:bg-foreground/50",
                        ),
                      controls.dots === "bars" &&
                        cn(
                          "h-1 w-7 rounded-full",
                          active ? "bg-foreground" : "bg-foreground/30 hover:bg-foreground/50",
                        ),
                      controls.dots === "numbers" &&
                        cn(
                          "grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                          active
                            ? "bg-foreground text-background"
                            : "bg-background/70 text-foreground/80 hover:bg-background",
                        ),
                    )}
                  >
                    {controls.dots === "numbers" ? index + 1 : null}
                  </button>
                );
              })
            : null}
        </div>
      ) : null}
    </div>
  );
}
