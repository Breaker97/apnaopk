"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Settings2, Type } from "lucide-react";
import { CountdownTimer } from "@/components/store/sections/countdown-timer";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import {
  buildGradientCss,
  cqw,
  ctaBoxCss,
  ctaVariantChrome,
  imageLayerStyle,
  resolveImageLayout,
  resolveSlideLayout,
  ownTextStyle,
  resolveTextStyle,
  SLIDE_ART_PADDING,
  MIN_TEXT_PX,
  SLIDE_COPY_PADDING,
  SLIDE_CTA_VARIANTS,
  SLIDE_PRICE_PX,
  SLIDE_SHAPE_ASPECT_CLASS,
  textSizeCqw,
  textBoxWidth,
  type SlideCtaVariant,
  type SlideShape,
  type SlideImageLayout,
  type SliderSlide,
  type SlideTextElement,
  type SlideTextStyle,
} from "@/lib/sliders/types";
import {
  CtaSettingsPopover,
  type CtaSettingsLabels,
} from "./cta-settings-popover";
import { TextStylePopover } from "./text-style-popover";

/**
 * The editing canvas for one slide.
 *
 * COPY AND ARTWORK ARE INDEPENDENT LAYERS against the same canvas: the
 * artwork sits behind and is free to be overlapped. Either is selected by
 * clicking it, and both wear the same hover/selected frame, so the toolbar's
 * alignment and size controls always have a visible target.
 *
 * This surface is EDIT-ONLY. What a collapsed slider card previews is the
 * real storefront component (`SavedSlider`), not a second rendering of the
 * same slide — an approximation here could disagree with what ships.
 *
 * The shape prop resolves that band's layout INLINE. The storefront picks its
 * band from the cell's own aspect with a container query; the editor is
 * previewing a band the canvas is being FORCED into, which no query can see,
 * so the two arrive at the same numbers by different routes.
 */

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

/** Hover hint / selected frame, shared by every selectable layer. */
const FRAME_BASE =
  "pointer-events-none absolute -inset-1.5 rounded-[3px] border transition-colors";

export type SlideSelection = "content" | "image";

export interface SlideCanvasLabels {
  weight: string;
  style: string;
  size: string;
  color: string;
  width: string;
  startingAt: string;
  bindProduct: string;
  countdown: { days: string; hours: string; minutes: string; seconds: string };
  placeholders: Record<SlideTextElement, string>;
  ctaSettings: CtaSettingsLabels;
}

interface SlideCanvasProps {
  slide: SliderSlide;
  shape: SlideShape;
  /** Resolved price of the bound product, in store currency units. */
  productPrice?: number | null;
  /** Which layer the toolbar is currently driving. */
  selection: SlideSelection;
  onSelectionChange: (selection: SlideSelection) => void;
  onTextChange: (element: SlideTextElement, value: string) => void;
  onStyleChange: (element: SlideTextElement, style: SlideTextStyle) => void;
  onCtaVariantChange: (variant: SlideCtaVariant) => void;
  onLinkChange: (link: string) => void;
  /** Drag on the artwork: deltas are percent of the slide's own box. */
  onImageNudge: (patch: Partial<SlideImageLayout>) => void;
  renderAiAction?: (element: SlideTextElement) => ReactNode;
  labels: SlideCanvasLabels;
  className?: string;
}

function AutoTextarea({
  value,
  onChange,
  onFocus,
  placeholder,
  style,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  placeholder: string;
  style: CSSProperties;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const fit = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${node.scrollHeight}px`;
  }, []);

  // Re-measure after EVERY render rather than from a dependency list. Sizes
  // are `cqw`, so the style string stays byte-identical while the rendered
  // type — and with it the line count — changes with the canvas width. A dep
  // list misses exactly those cases, which is how the box got stuck at its
  // first measurement and left a gap under short copy until something else
  // (nudging Scale) happened to change the string.
  useLayoutEffect(fit);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // The canvas resizes without this component re-rendering at all — window
    // resize, band switch, the inspector opening. Re-fit on WIDTH changes
    // only; the height changes are the ones `fit` just made.
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      fit();
    });
    observer.observe(node);
    // A webfont swapping in reflows the text after the first measurement.
    void document.fonts?.ready.then(fit);
    return () => observer.disconnect();
  }, [fit]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onFocus={onFocus}
      placeholder={placeholder}
      rows={1}
      spellCheck={false}
      className={cn(
        "w-full resize-none overflow-hidden border-none bg-transparent p-0 outline-none placeholder:text-current placeholder:opacity-40 focus:ring-0",
        className,
      )}
      style={style}
    />
  );
}

export function SlideCanvas({
  slide,
  shape,
  productPrice,
  selection,
  onSelectionChange,
  onTextChange,
  onStyleChange,
  onCtaVariantChange,
  onLinkChange,
  onImageNudge,
  renderAiAction,
  labels,
  className,
}: SlideCanvasProps) {
  const { formatPrice } = useCurrency();
  const layout = resolveSlideLayout(slide, shape);
  const imageLayout = resolveImageLayout(slide, shape);
  const scale = layout.scale / 100;
  const isImageBg = slide.background.type === "image" && slide.background.image;
  const fallbackColor = isImageBg ? "#ffffff" : "#1f2937";
  const frameRef = useRef<HTMLDivElement | null>(null);

  // Sizes are a SHARE of the canvas width, exactly as on the storefront — the
  // canvas is a size container (`.sl-canvas`), so `cqw` resolves here the same
  // way it resolves against a live cell. Type therefore shrinks with a small
  // tile instead of shouting over it, and the editor keeps showing the truth.
  const textCss = (element: SlideTextElement): CSSProperties => {
    const style = resolveTextStyle(slide, element, shape);
    return {
      fontWeight: style.weight ?? (element === "heading" ? 700 : 400),
      fontStyle: style.style ?? undefined,
      color: style.color ?? fallbackColor,
      fontSize: `max(${MIN_TEXT_PX}px, calc(${textSizeCqw(slide, element, shape)} * ${scale}))`,
      lineHeight: 1.2,
      textAlign: layout.h,
    };
  };

  // Drag the artwork around its anchor. Deltas are measured against the
  // slide's own box, so a nudge means the same thing at every canvas size.
  const startImageDrag = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onSelectionChange("image");
      const frame = frameRef.current;
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      const originX = event.clientX;
      const originY = event.clientY;
      const startX = imageLayout.x;
      const startY = imageLayout.y;
      const move = (moveEvent: PointerEvent) => {
        onImageNudge({
          x: Math.min(
            50,
            Math.max(
              -50,
              startX + ((moveEvent.clientX - originX) / rect.width) * 100,
            ),
          ),
          y: Math.min(
            50,
            Math.max(
              -50,
              startY + ((moveEvent.clientY - originY) / rect.height) * 100,
            ),
          ),
        });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onImageNudge, onSelectionChange, imageLayout.x, imageLayout.y],
  );

  /**
   * One editable text. The WRAPPER spans the whole content column while the
   * BOX inside it wears the admin's width.
   *
   * The style/AI controls sit just under the BOX, hugging the edge the
   * content is aligned to — under a left-aligned headline they start at its
   * left edge, mirrored on the right. That edge is also the one the width
   * slider grows the box AWAY from, so dragging it never walks the panel
   * out from under the cursor.
   */
  const controlAnchorClass =
    layout.h === "left"
      ? "left-0"
      : layout.h === "right"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";

  const editableText = (element: SlideTextElement, extraClass?: string) => {
    const resolved = resolveTextStyle(slide, element, shape);
    return (
      <div
        key={element}
        className="group/text pointer-events-none relative flex w-full"
        style={{ justifyContent: JUSTIFY[layout.h] }}
      >
        {/* Only the BOX takes the pointer, never the full-width wrapper —
            otherwise the copy column would blanket the canvas and the
            artwork behind it could never be clicked. */}
        <div
          // The box the caret is actually in fills with a wash, so which of
          // several framed boxes you are typing into is never a guess. On the
          // box itself, not the frame ring — a background on the ring would
          // paint over the copy instead of behind it.
          className="pointer-events-auto relative min-w-0 rounded-[2px] transition-colors group-focus-within/text:bg-primary/15"
          style={{ width: textBoxWidth(resolved.width), maxWidth: "100%" }}
          onPointerDown={() => onSelectionChange("content")}
        >
          {/* Hover hint, then a solid frame while the box has focus. Both sit
              OUTSIDE the box so turning them on never reflows the copy. */}
          <span
            aria-hidden
            className={cn(
              FRAME_BASE,
              "border-transparent group-hover/text:border-primary/40 group-focus-within/text:!border-primary",
            )}
          />
          <AutoTextarea
            value={slide.texts[element]}
            onChange={(next) => onTextChange(element, next)}
            onFocus={() => onSelectionChange("content")}
            placeholder={labels.placeholders[element]}
            style={textCss(element)}
            className={extraClass}
          />

          {/* Just under the box it edits, hugging the content's aligned
              edge — see controlAnchorClass above. */}
          <div
            className={cn(
              "pointer-events-none absolute top-full z-20 flex items-center gap-1 pt-1.5 opacity-0 transition-opacity group-focus-within/text:pointer-events-auto group-focus-within/text:opacity-100 group-hover/text:pointer-events-auto group-hover/text:opacity-100",
              controlAnchorClass,
            )}
          >
            <TextStylePopover
              trigger={
                <button
                  type="button"
                  className="grid h-7 w-7 place-items-center rounded-[5px] border border-border bg-background text-rose-500 shadow-sm transition hover:bg-accent"
                  aria-label={`${labels.style}: ${element}`}
                >
                  <Type className="h-3.5 w-3.5" />
                </button>
              }
              value={ownTextStyle(slide, element, shape)}
              inherited={resolved}
              onChange={(style) => onStyleChange(element, style)}
              labels={labels}
            />
            {renderAiAction?.(element)}
          </div>
        </div>
      </div>
    );
  };

  const priceNode = slide.elements.price ? (
    <p
      className="flex flex-wrap items-baseline gap-x-2"
      style={{
        color: fallbackColor,
        fontSize: `max(${MIN_TEXT_PX}px, calc(${cqw(SLIDE_PRICE_PX, shape)} * ${scale}))`,
        textAlign: layout.h,
        justifyContent: JUSTIFY[layout.h] as CSSProperties["justifyContent"],
      }}
    >
      <span className="text-[0.6em] opacity-80">{labels.startingAt}</span>
      <span className="font-bold">
        {typeof productPrice === "number"
          ? formatPrice(productPrice)
          : slide.productId
            ? "···"
            : `(${labels.bindProduct})`}
      </span>
    </p>
  ) : null;

  // Only ever the stored deadline: switching the chip on seeds one, so the
  // canvas shows what will actually ship rather than a sample.
  const countdownNode =
    slide.elements.countdown && slide.countdownEndsAt ? (
      <CountdownTimer
        endsAt={slide.countdownEndsAt}
        size="sm"
        labels={labels.countdown}
      />
    ) : null;

  const ctaChrome = ctaVariantChrome(slide.ctaVariant);
  const ctaStyle = resolveTextStyle(slide, "cta", shape);
  const ctaCss: CSSProperties = {
    fontWeight: ctaStyle.weight ?? 500,
    fontStyle: ctaStyle.style ?? undefined,
    color: ctaStyle.color ?? ctaChrome.textColor,
    fontSize: `max(${MIN_TEXT_PX}px, calc(${textSizeCqw(slide, "cta", shape)} * ${scale}))`,
    lineHeight: 1.2,
  };

  const ctaNode = slide.elements.cta ? (
    <div
      className="group/text pointer-events-none relative flex w-full"
      style={{ justifyContent: JUSTIFY[layout.h] }}
    >
      <div
        className="pointer-events-auto relative rounded-[2px] transition-colors group-focus-within/text:bg-primary/15"
        style={{ width: textBoxWidth(ctaStyle.width), maxWidth: "100%" }}
        onPointerDown={() => onSelectionChange("content")}
      >
        <span
          aria-hidden
          className={cn(
            FRAME_BASE,
            "border-transparent group-hover/text:border-primary/40 group-focus-within/text:!border-primary",
          )}
        />
        <span
          className="flex items-center justify-center rounded-md"
          // Chrome in `em`, so the button grows and shrinks with its own
          // label — same rule the storefront button follows.
          style={{
            ...ctaCss,
            ...ctaBoxCss(ctaStyle),
            backgroundColor: ctaChrome.background,
            border: ctaChrome.border,
          }}
        >
          <input
            value={slide.texts.cta}
            onChange={(event) => onTextChange("cta", event.target.value)}
            onFocus={() => onSelectionChange("content")}
            placeholder={labels.placeholders.cta}
            spellCheck={false}
            size={Math.max(6, slide.texts.cta.length || 8)}
            className="min-w-0 border-none bg-transparent p-0 text-center outline-none placeholder:text-current placeholder:opacity-50 focus:ring-0"
            style={ctaCss}
          />
        </span>
        {/* Just under the button, hugging the content's aligned edge — the
            same anchoring the text controls use. */}
        <div
          className={cn(
            "pointer-events-none absolute top-full z-20 flex items-center gap-1 pt-1.5 opacity-0 transition-opacity group-focus-within/text:pointer-events-auto group-focus-within/text:opacity-100 group-hover/text:pointer-events-auto group-hover/text:opacity-100",
            controlAnchorClass,
          )}
        >
        <TextStylePopover
          trigger={
            <button
              type="button"
              className="grid h-7 w-7 place-items-center rounded-[5px] border border-border bg-background text-rose-500 shadow-sm transition hover:bg-accent"
              aria-label={`${labels.style}: cta`}
            >
              <Type className="h-3.5 w-3.5" />
            </button>
          }
          value={ownTextStyle(slide, "cta", shape)}
          inherited={ctaStyle}
          onChange={(style) => onStyleChange("cta", style)}
          labels={labels}
        />
        {/* The button's chrome: dark plate / light plate / outlined. */}
        <span className="flex items-center gap-0.5 rounded-[5px] border border-border bg-background p-0.5 shadow-sm">
          {SLIDE_CTA_VARIANTS.map((variant) => (
            <button
              key={variant}
              type="button"
              aria-label={variant}
              aria-pressed={slide.ctaVariant === variant}
              onClick={() => onCtaVariantChange(variant)}
              className={cn(
                "grid h-6 w-6 place-items-center rounded-[4px] transition-colors hover:bg-accent",
                slide.ctaVariant === variant && "ring-1 ring-primary",
              )}
            >
              <span
                className={cn(
                  "h-2.5 w-3.5 rounded-[3px]",
                  variant === "dark" && "bg-[#1f2937]",
                  variant === "light" && "border border-border bg-white",
                  variant === "outline" &&
                    "border border-foreground/60 bg-transparent",
                )}
              />
            </button>
          ))}
        </span>
        {/* Link, padding, height — the button's own settings. */}
        <CtaSettingsPopover
          trigger={
            <button
              type="button"
              className="grid h-7 w-7 place-items-center rounded-[5px] border border-border bg-background text-muted-foreground shadow-sm transition hover:bg-accent hover:text-foreground"
              aria-label={`${labels.ctaSettings.title}: cta`}
              title={labels.ctaSettings.title}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          }
          link={slide.link}
          variant={slide.ctaVariant}
          ownStyle={ownTextStyle(slide, "cta", shape)}
          labels={labels.ctaSettings}
          onLinkChange={onLinkChange}
          onVariantChange={onCtaVariantChange}
          onStyleChange={(style) => onStyleChange("cta", style)}
        />
        {renderAiAction?.("cta")}
        </div>
      </div>
    </div>
  ) : null;

  const art = imageLayerStyle(imageLayout);

  return (
    <div
      ref={frameRef}
      // The canvas takes the shape it is previewing, so the frame the admin
      // arranges in is the frame the arrangement is FOR.
      className={cn(
        "sl-canvas relative w-full overflow-hidden rounded-xl bg-muted",
        SLIDE_SHAPE_ASPECT_CLASS[shape],
        className,
      )}
    >
      {/* Background */}
      {slide.background.type === "solid" && slide.background.color ? (
        <div
          className="absolute inset-0"
          style={{ backgroundColor: slide.background.color }}
          aria-hidden
        />
      ) : null}
      {slide.background.type === "gradient" && slide.background.gradient ? (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: buildGradientCss(slide.background.gradient),
          }}
          aria-hidden
        />
      ) : null}
      {isImageBg ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slide.background.image}
            alt=""
            // Stretch to the canvas exactly like the storefront stretches to
            // its frame — the full image, never cropped.
            className="absolute inset-0 h-full w-full object-fill"
          />
          <div className="absolute inset-0 bg-black/25" aria-hidden />
        </>
      ) : null}

      {/* Artwork layer — always BEHIND the copy, free to be overlapped, and
          selected by clicking it like any other layer. */}
      {slide.productImage ? (
        <div
          className="absolute inset-0 flex"
          style={{ ...art.container, padding: cqw(SLIDE_ART_PADDING[shape], shape) }}
        >
          <div
            className="group/art relative cursor-move"
            style={art.art}
            onPointerDown={startImageDrag}
          >
            <span
              aria-hidden
              className={cn(
                FRAME_BASE,
                selection === "image"
                  ? "border-primary"
                  : "border-transparent group-hover/art:border-primary/40",
              )}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slide.productImage}
              alt=""
              draggable={false}
              className="h-auto w-full select-none object-contain"
            />
          </div>
        </div>
      ) : null}

      {/* Copy layer — on top, but only the copy itself takes the pointer, so
          clicking the artwork behind it still selects the artwork. */}
      <div
        className="pointer-events-none absolute inset-0 flex"
        style={{
          padding: cqw(SLIDE_COPY_PADDING[shape], shape),
          justifyContent: JUSTIFY[layout.h] as CSSProperties["justifyContent"],
          alignItems: ALIGN[layout.v] as CSSProperties["alignItems"],
        }}
      >
        <div
          className={cn(
            "pointer-events-none relative flex w-full flex-col",
            selection === "content" &&
              "outline-dashed outline-1 outline-offset-[10px] outline-primary/40",
          )}
          style={{
            gap: `calc(${cqw(layout.gap, shape)} * ${scale})`,
            alignItems: JUSTIFY[layout.h] as CSSProperties["alignItems"],
          }}
        >
          {slide.elements.tagline
            ? editableText("tagline", "uppercase tracking-[0.2em]")
            : null}
          {slide.elements.heading ? editableText("heading") : null}
          {slide.elements.description ? editableText("description") : null}
          {priceNode}
          {countdownNode}
          {ctaNode}
        </div>
      </div>
    </div>
  );
}
