"use client";

import type { CSSProperties, ReactNode } from "react";
import { BackgroundVideo } from "@/components/store/background-video";
import { CountdownTimer } from "@/components/store/sections/countdown-timer";
import { cn } from "@/lib/utils";
import {
  backgroundCss,
  backgroundFilterCss,
  backgroundOverlayCss,
  buildGradientCss,
  ctaStyleCss,
  fixedSizeVars,
  focalPositionCss,
  parseHighlights,
  resolveSlideArt,
  resolveSlideBackground,
  resolveSlideElements,
  SLIDE_BAND_KEYS,
  SLIDE_CTA_ATTRS,
  SLIDE_CTA_CLASS,
  SLIDE_PRICE_PX,
  SLIDE_TEXT_CSS,
  slideArtVars,
  slideBackgroundVars,
  slideHasArtDirection,
  slideLayoutVars,
  textStyleCss,
  type SlideCtaElement,
  type SlideElement,
  type SliderSlide,
  type SlideShape,
  type SlideTextElement,
} from "@/lib/sliders/types";

/**
 * ONE slide, drawn the one way it is ever drawn.
 *
 * The storefront carousel, the builder's block preview and the admin editor
 * all render a slide through this component, inside a `.sl-frame` — so the
 * band the container query picks, every length the stylesheet reads and the
 * layer order are the same on each. There is no second rendering that could
 * disagree: the editor only swaps the text nodes for fields and wraps the
 * artwork in a drag handle, through the render props below, and the
 * storefront swaps the plain images for optimised ones.
 *
 * The component is presentational and pure: no links, no carousel, no data
 * fetching. Whoever hosts it decides what a click does.
 */

export interface SlideViewLabels {
  startingAt: string;
  countdown: { days: string; hours: string; minutes: string; seconds: string };
}

/** One text as the slide draws it — everything but the node itself. */
export interface SlideTextBox {
  element: Exclude<SlideTextElement, SlideCtaElement>;
  /** The element the storefront draws it as. */
  tag: "p" | "h2";
  className: string;
  style: CSSProperties;
  /** The raw text, highlight marks included. */
  text: string;
  /** The text as it reads: its runs, highlighted words wrapped. */
  nodes: ReactNode;
}

/** A button as the slide draws it. */
export interface SlideCtaBox {
  element: SlideCtaElement;
  className: string;
  style: CSSProperties;
  /** What the theme restyles a button by. */
  attrs: typeof SLIDE_CTA_ATTRS;
  text: string;
}

export interface SlideImageProps {
  src: string;
  alt: string;
  className: string;
  style?: CSSProperties;
  /** The first slide's picture is the page's largest paint. */
  priority: boolean;
}

export interface SlideArtBox {
  className: string;
  children: ReactNode;
}

export interface SlideViewProps {
  slide: SliderSlide;
  /** The bound product's price, resolved by the server; absent hides the line. */
  price?: { amount: number; compareAt?: number } | null;
  /** Editor only: what the price line shows while no product resolved. */
  pricePlaceholder?: ReactNode;
  formatPrice: (amount: number) => string;
  labels: SlideViewLabels;
  /** Play the slide's reveal now (the storefront: when it comes around). */
  reveal?: boolean;
  priority?: boolean;
  /**
   * The editor's mode: every enabled element renders (empty or not) so it
   * can be typed into, the copy layer lets the pointer through to the
   * artwork behind it, and nothing moves on its own.
   */
  editing?: boolean;
  /** Extra classes on the copy column (the editor's selection outline). */
  stackClassName?: string;
  className?: string;
  renderImage?: (kind: "background" | "art", props: SlideImageProps) => ReactNode;
  renderText?: (box: SlideTextBox) => ReactNode;
  renderCta?: (box: SlideCtaBox) => ReactNode;
  renderArt?: (box: SlideArtBox) => ReactNode;
}

const TEXT_TAGS: Record<Exclude<SlideTextElement, SlideCtaElement>, "p" | "h2"> = {
  tagline: "p",
  heading: "h2",
  description: "p",
};

/**
 * What each element displays as when it shows; per band it is this or
 * `none`, which is how one DOM serves three bands that may not agree on
 * which elements appear.
 */
const NATURAL_DISPLAY: Record<SlideElement, string> = {
  tagline: "block",
  heading: "block",
  description: "block",
  price: "flex",
  countdown: "block",
  cta: "inline-flex",
  cta2: "inline-flex",
};

/**
 * A text as it reads, its *highlighted* words wrapped for the stylesheet.
 * With `showMarks` the asterisks stay, dimmed — the editor's mirror keeps
 * them so the field and its reflection break lines in the same places.
 */
export function HighlightedText({ text, showMarks = false }: { text: string; showMarks?: boolean }) {
  const segments = parseHighlights(text);
  return (
    <>
      {segments.map((segment, index) =>
        segment.highlight ? (
          <span key={index} className="sl-hl">
            {showMarks ? <span className="opacity-40">*</span> : null}
            {segment.text}
            {showMarks ? <span className="opacity-40">*</span> : null}
          </span>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}

function plainImage(
  _kind: "background" | "art",
  { src, alt, className, style }: SlideImageProps,
): ReactNode {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} style={style} draggable={false} />;
}

function plainText({ tag: Tag, className, style, nodes }: SlideTextBox): ReactNode {
  return (
    <Tag className={className} style={style}>
      {nodes}
    </Tag>
  );
}

function plainCta({ className, style, attrs, text }: SlideCtaBox): ReactNode {
  return (
    <span {...attrs} className={className} style={style}>
      {text}
    </span>
  );
}

function plainArt({ className, children }: SlideArtBox): ReactNode {
  return <div className={className}>{children}</div>;
}

/**
 * Whether a slide has anything to say in ANY band. A slide with copy, a
 * price, a running countdown or a button is content; one with only a
 * background is a picture.
 */
export function slideHasContent(
  slide: SliderSlide,
  price?: { amount: number } | null,
): boolean {
  const anyBand = (element: SlideElement) =>
    SLIDE_BAND_KEYS.some(([, shape]) => resolveSlideElements(slide, shape)[element]);
  return Boolean(
    (anyBand("tagline") && slide.texts.tagline) ||
      (anyBand("heading") && slide.texts.heading) ||
      (anyBand("description") && slide.texts.description) ||
      (anyBand("cta") && slide.texts.cta) ||
      (anyBand("cta2") && slide.texts.cta2) ||
      (anyBand("price") && price) ||
      (anyBand("countdown") && slide.countdownEndsAt),
  );
}

/** The per-band display set that shows a layer in ONE band only. */
function onlyIn(shape: SlideShape): CSSProperties {
  return {
    "--sh-l": shape === "landscape" ? "block" : "none",
    "--sh-s": shape === "square" ? "block" : "none",
    "--sh-p": shape === "portrait" ? "block" : "none",
  } as CSSProperties;
}

export function SlideView({
  slide,
  price,
  pricePlaceholder,
  formatPrice,
  labels,
  reveal = false,
  priority = false,
  editing = false,
  stackClassName,
  className,
  renderImage = plainImage,
  renderText = plainText,
  renderCta = plainCta,
  renderArt = plainArt,
}: SlideViewProps) {
  const { background } = slide;
  // Light-on-dark over ARTWORK — a picture or a video, where the darkening
  // guarantees contrast; a solid or gradient plate defaults to dark copy.
  // Explicit per-text colours always win.
  const artwork = background.type === "image" || background.type === "video";
  const ink = artwork ? "#ffffff" : "#1f2937";
  const artDirected = slideHasArtDirection(slide);
  const motion = !editing && background.motion ? `sl-bg--${background.motion}` : undefined;

  /**
   * Whether an element has something to show at all, and in which bands.
   * An element hidden in every band is not rendered; one hidden in some
   * bands renders with `display: none` in those, through the `--sh` alias.
   */
  const hasSubstance = (element: SlideElement): boolean => {
    switch (element) {
      case "price":
        return editing || Boolean(price);
      case "countdown":
        return Boolean(slide.countdownEndsAt);
      default:
        return editing || slide.texts[element].length > 0;
    }
  };
  const bands = (element: SlideElement) => {
    const shown: Record<string, boolean> = {};
    for (const [suffix, shape] of SLIDE_BAND_KEYS) {
      shown[suffix] = resolveSlideElements(slide, shape)[element];
    }
    return shown;
  };
  const showVars = (
    element: SlideElement,
    shown: Record<string, boolean>,
    index: number,
  ): CSSProperties =>
    ({
      "--sh-l": shown.l ? NATURAL_DISPLAY[element] : "none",
      "--sh-s": shown.s ? NATURAL_DISPLAY[element] : "none",
      "--sh-p": shown.p ? NATURAL_DISPLAY[element] : "none",
      // Its place in the reveal: elements arrive `--i` stagger steps apart.
      "--i": index,
      display: "var(--sh)",
    }) as CSSProperties;

  const nodes: ReactNode[] = [];
  for (const element of slide.order) {
    if (!hasSubstance(element)) continue;
    const shown = bands(element);
    if (!Object.values(shown).some(Boolean)) continue;
    const visibility = showVars(element, shown, nodes.length);
    switch (element) {
      case "tagline":
      case "heading":
      case "description":
        nodes.push(
          <SlideNode key={element}>
            {renderText({
              element,
              tag: TEXT_TAGS[element],
              className: cn("sl-text", element !== "tagline" && "whitespace-pre-line"),
              style: {
                ...textStyleCss(slide, element, ink),
                // A headline never leaves one word alone on its last line.
                ...(element === "heading" ? { textWrap: "balance" } : {}),
                ...visibility,
              } as CSSProperties,
              text: slide.texts[element],
              nodes: <HighlightedText text={slide.texts[element]} />,
            })}
          </SlideNode>,
        );
        break;
      case "price":
        nodes.push(
          <p
            key={element}
            // Needs its own -l/-s/-p set: `.sl-text` only aliases
            // properties the element itself declares.
            className="sl-text flex flex-wrap items-baseline gap-x-2"
            style={
              {
                ...fixedSizeVars(SLIDE_PRICE_PX),
                color: ink,
                fontSize: SLIDE_TEXT_CSS.fontSize,
                lineHeight: 1.2,
                justifyContent: "var(--sl-jc)",
                ...visibility,
              } as CSSProperties
            }
          >
            <span className="text-[0.6em] opacity-80">{labels.startingAt}</span>
            {price ? (
              <>
                <span className="font-bold">{formatPrice(price.amount)}</span>
                {price.compareAt !== undefined ? (
                  <span className="text-[0.6em] opacity-60 line-through">
                    {formatPrice(price.compareAt)}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="font-bold">{pricePlaceholder}</span>
            )}
          </p>,
        );
        break;
      case "countdown":
        nodes.push(
          <div key={element} className="sl-text" style={visibility}>
            <CountdownTimer
              endsAt={slide.countdownEndsAt}
              size="sm"
              hideWhenExpired={!editing}
              labels={labels.countdown}
            />
          </div>,
        );
        break;
      case "cta":
      case "cta2":
        nodes.push(
          <SlideNode key={element}>
            {renderCta({
              element,
              className: SLIDE_CTA_CLASS,
              style: { ...ctaStyleCss(slide, element), ...visibility },
              attrs: SLIDE_CTA_ATTRS,
              text: slide.texts[element],
            })}
          </SlideNode>,
        );
        break;
    }
  }

  /** The artwork: one cutout, or a band's own where a band has one. */
  const artImage = (src: string, extra?: CSSProperties) =>
    renderImage("art", {
      src,
      alt: slide.alt || "",
      className: "h-auto w-full select-none object-contain",
      style: extra,
      priority,
    });
  const artLayers = slide.productImages?.square || slide.productImages?.portrait
    ? SLIDE_BAND_KEYS.map(([, shape]) => {
        const src = resolveSlideArt(slide, shape);
        return src ? (
          <div key={shape} className="sl-band" style={onlyIn(shape)}>
            {artImage(src)}
          </div>
        ) : null;
      })
    : slide.productImage
      ? artImage(slide.productImage)
      : null;
  const art = artLayers ? (
    <div
      className={cn("sl-art absolute inset-0", slide.artInFront && !editing && "sl-art--front")}
      style={slideArtVars(slide) as CSSProperties}
    >
      {renderArt({ className: "sl-art-box relative", children: artLayers })}
    </div>
  ) : null;

  /**
   * The background plate — one layer, whichever kind, so a hover effect has
   * one thing to move. An art-directed slide paints each band's picture
   * through CSS (only the band's own is fetched); a slide with one picture
   * keeps the optimised <img> the page's first paint depends on.
   */
  const plate = artDirected ? (
    <>
      <div
        className={cn("sl-bg sl-bg--band absolute inset-0", motion)}
        style={
          {
            ...slideBackgroundVars(slide),
            ...Object.fromEntries(
              SLIDE_BAND_KEYS.map(([suffix, shape]) => [
                `--sl-bgo-${suffix}`,
                resolveSlideBackground(slide, shape).blur ? "-3%" : "0",
              ]),
            ),
          } as CSSProperties
        }
        aria-hidden
      />
      {SLIDE_BAND_KEYS.map(([, shape]) => {
        const own = resolveSlideBackground(slide, shape);
        return own.type === "video" && own.video ? (
          <div key={`video-${shape}`} className="sl-band absolute inset-0" style={onlyIn(shape)} aria-hidden>
            <BackgroundVideo background={own} style={{ objectPosition: focalPositionCss(own) }} />
          </div>
        ) : null;
      })}
      {SLIDE_BAND_KEYS.map(([, shape]) => {
        const own = resolveSlideBackground(slide, shape);
        const overlay = own.type === "image" ? backgroundOverlayCss(own) : null;
        return overlay ? (
          <div
            key={`overlay-${shape}`}
            className="sl-band absolute inset-0"
            style={{ ...overlay, ...onlyIn(shape) }}
            aria-hidden
          />
        ) : null;
      })}
    </>
  ) : (
    <>
      {background.type === "solid" && background.color ? (
        <div
          className="sl-bg absolute inset-0"
          style={{ backgroundColor: background.color }}
          aria-hidden
        />
      ) : null}
      {background.type === "gradient" && background.gradient ? (
        <div
          className="sl-bg absolute inset-0"
          style={{ backgroundImage: buildGradientCss(background.gradient) }}
          aria-hidden
        />
      ) : null}
      {background.type === "image" && background.image ? (
        <div
          className={cn("sl-bg absolute inset-0", motion)}
          style={
            {
              "--sl-bgf": backgroundFilterCss(background),
              "--sl-bgo": background.blur ? "-3%" : "0",
            } as CSSProperties
          }
          aria-hidden
        >
          {/* The picture FILLS the frame, cropped to its shape rather than
              stretched to it, keeping the focal point in view. */}
          {renderImage("background", {
            src: background.image,
            alt: slide.alt || "",
            className: "absolute inset-0 h-full w-full object-cover",
            style: { objectPosition: focalPositionCss(background) },
            priority,
          })}
        </div>
      ) : null}
      {background.type === "video" && background.video ? (
        // The poster paints on the plate itself, so a visitor who asked for
        // less motion — for whom the video hides — still sees the still.
        <div
          className={cn("sl-bg absolute inset-0", motion)}
          style={
            {
              ...backgroundCss(background),
              backgroundPosition: focalPositionCss(background),
              "--sl-bgf": backgroundFilterCss(background),
              "--sl-bgo": background.blur ? "-3%" : "0",
            } as CSSProperties
          }
          aria-hidden
        >
          <BackgroundVideo background={background} style={{ objectPosition: focalPositionCss(background) }} />
        </div>
      ) : null}
      {/* Darkening over a picture; a video's rides inside its own layer. */}
      {background.type === "image" && backgroundOverlayCss(background) ? (
        <div className="absolute inset-0" style={backgroundOverlayCss(background) ?? undefined} aria-hidden />
      ) : null}
    </>
  );

  return (
    <div
      className={cn("sl-slide relative h-full w-full overflow-hidden", className)}
      data-sl-hover={background.hover}
    >
      {plate}

      {/* Artwork layer — its own placement, free to be overlapped, exactly
          as arranged in the editor. Behind the copy unless the slide puts
          it in front. */}
      {slide.artInFront ? null : art}

      {/* Copy layer — placed against the same canvas. */}
      <div
        className={cn("sl-content absolute inset-0", editing && "pointer-events-none")}
        style={slideLayoutVars(slide) as CSSProperties}
      >
        {nodes.length > 0 ? (
          <div
            // Re-mounting on activation restarts the reveal animation each
            // time the slide comes around.
            key={reveal ? "on" : "off"}
            className={cn(
              "sl-stack min-w-0",
              reveal && slide.reveal !== "none" && `sl-reveal-${slide.reveal}`,
              stackClassName,
            )}
          >
            {nodes}
          </div>
        ) : null}
      </div>

      {slide.artInFront ? art : null}
    </div>
  );
}

/** A transparent wrapper: the render props return the element itself. */
function SlideNode({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
