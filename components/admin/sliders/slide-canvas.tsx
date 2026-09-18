"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Settings2, Type } from "lucide-react";
import {
  HighlightedText,
  SlideView,
  type SlideArtBox,
  type SlideCtaBox,
  type SlideTextBox,
} from "@/components/store/slide-view";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import {
  EDITOR_CANVAS_MAX_HEIGHT,
  ownTextStyle,
  resolveImageLayout,
  resolveSlideLayout,
  resolveTextStyle,
  SLIDE_FRAMES,
  textBoxWidthCss,
  type SlideCtaElement,
  type SlideCtaVariant,
  type SlideShape,
  type SlideImageLayout,
  type SliderSlide,
  type SlideTextElement,
  type SlideTextStyle,
  type SlideTextTransform,
} from "@/lib/sliders/types";
import {
  CtaSettingsPopover,
  type CtaSettingsLabels,
} from "./cta-settings-popover";
import { TextStylePopover } from "./text-style-popover";

/**
 * The editing canvas for one slide: an ARTBOARD.
 *
 * The board is a real `.sl-frame` drawn at the band's own storefront frame —
 * 1248×450 for the desktop hero, the phone's 390×244, the tall 390×693 — and
 * zoomed to fit the editor, never re-proportioned. Inside it the slide is
 * `SlideView`, the same component the shop and the builder's block preview
 * render, under the same container queries: the band the query picks is the
 * band the merchant is looking at, and a length typed in the panel is the
 * length on the board, which is the length on the shop. This file adds only
 * the editing chrome — fields in place of the text nodes, a drag handle on
 * the artwork with its snap guides and arrow-key nudging, frames and the
 * floating style controls.
 *
 * COPY AND ARTWORK ARE INDEPENDENT LAYERS against the same canvas: the
 * artwork sits behind (or, when the slide says so, in front) and is free to
 * be overlapped. Either is selected by clicking it, and both wear the same
 * hover/selected frame, so the toolbar's alignment and size controls always
 * have a visible target.
 */

/** Hover hint / selected frame, shared by every selectable layer. */
const FRAME_BASE =
  "pointer-events-none absolute -inset-1.5 rounded-[3px] border transition-colors";

/** How close to the slide's centre (on screen, px) the artwork snaps from. */
const SNAP_PX = 8;

export type SlideSelection = "content" | "image";

export interface SlideCanvasLabels {
  weight: string;
  style: string;
  size: string;
  color: string;
  width: string;
  letterSpacing: string;
  lineHeight: string;
  transform: string;
  transformOptions: Record<"default" | SlideTextTransform, string>;
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
  onCtaVariantChange: (element: SlideCtaElement, variant: SlideCtaVariant) => void;
  onLinkChange: (element: SlideCtaElement, link: string) => void;
  /** Drag on the artwork: deltas are percent of the slide's own box. */
  onImageNudge: (patch: Partial<SlideImageLayout>) => void;
  renderAiAction?: (element: SlideTextElement) => ReactNode;
  labels: SlideCanvasLabels;
  className?: string;
}

/** The tagline's default tracking, as the panel shows it (percent of the size). */
const DEFAULT_TRACKING_PCT: Record<SlideTextElement, number> = {
  tagline: 20,
  heading: 0,
  description: 0,
  cta: 0,
  cta2: 0,
};

/**
 * A text field that takes its whole look from the box around it — face,
 * size, weight, colour, tracking, case, alignment — so the box, which is
 * styled exactly as the storefront styles the text, is what the merchant
 * sees. Stated explicitly rather than trusted to the UA stylesheet, which
 * gives a textarea its own alignment and case.
 */
const INHERIT_TEXT: CSSProperties = {
  font: "inherit",
  color: "inherit",
  letterSpacing: "inherit",
  textTransform: "inherit",
  textAlign: "inherit",
};

/**
 * A text field that is exactly the size of its text — the storefront's
 * size. An in-flow REPLICA of the text (the same block the storefront draws,
 * with the same face, size and wrapping) gives the box its height, and the
 * field lies over it, invisible and the same width, keeping the caret and
 * the typing. A field sized from its own scroll height ran a few pixels
 * taller than the storefront's block, which the parity check caught.
 *
 * The replica is also the mirror for *highlighted* words: when the text
 * has any, it shows (the field's own ink turns transparent) wearing the
 * highlight styling, its asterisks kept but dimmed so the field and the
 * mirror break lines in the same places.
 */
function GrowingTextarea({
  value,
  onChange,
  onFocus,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  placeholder: string;
}) {
  const marked = value.includes("*");
  return (
    <div className="relative">
      <div
        aria-hidden
        className={cn("whitespace-pre-wrap break-words", !marked && "invisible")}
      >
        {marked ? <HighlightedText text={value} showMarks /> : value || placeholder}
        {/* A trailing line break, or nothing at all, needs a character to hold the line open. */}
        {value.endsWith("\n") || !value ? String.fromCharCode(0x200b) : null}
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        rows={1}
        spellCheck={false}
        className="absolute inset-0 block h-full w-full resize-none overflow-hidden border-none bg-transparent p-0 outline-none placeholder:text-current placeholder:opacity-40 focus:ring-0"
        style={
          marked
            ? { ...INHERIT_TEXT, color: "transparent", caretColor: "var(--co, currentColor)" }
            : INHERIT_TEXT
        }
      />
    </div>
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
  const frame = SLIDE_FRAMES[shape];
  const layout = resolveSlideLayout(slide, shape);
  const imageLayout = resolveImageLayout(slide, shape);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const artRef = useRef<HTMLDivElement | null>(null);
  const [guides, setGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });

  /**
   * Where the style and button panels hang: the board's own box. Opened
   * off the trigger — which sits under the text — a panel flipped up over
   * the very copy being styled. Off the board, it opens below it, or above
   * it when the window is short, and the slide stays in view either way.
   * Held as STATE, not a ref: each panel portals its anchor into this box,
   * so it needs the element at render time.
   */
  const [panelAnchor, setPanelAnchor] = useState<HTMLDivElement | null>(null);

  // The board is drawn at the frame's real size and ZOOMED to fit the space
  // it has, so it is never re-proportioned; the tall band is also held under
  // a height a laptop can show. Never past 1:1 — the phone board is shown at
  // the size a phone shows it.
  const [hostWidth, setHostWidth] = useState(0);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => setHostWidth(host.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const zoom = Math.min(
    1,
    hostWidth > 0 ? hostWidth / frame.width : 1,
    EDITOR_CANVAS_MAX_HEIGHT / frame.height,
  );

  /**
   * Drag the artwork around its anchor. Deltas are measured against the
   * board's box ON SCREEN, so a nudge means the same thing at every zoom.
   * Near the slide's centre — either axis — the artwork snaps to it and a
   * guide shows, the way a design tool does; the nudge is in percent of the
   * slide, the translate in percent of the ARTWORK's own box (see
   * `imageLayerStyle`), which is why a snap converts through the box.
   */
  const startImageDrag = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onSelectionChange("image");
      const board = boardRef.current;
      if (!board) return;
      const rect = board.getBoundingClientRect();
      const originX = event.clientX;
      const originY = event.clientY;
      const startX = imageLayout.x;
      const startY = imageLayout.y;
      const move = (moveEvent: PointerEvent) => {
        let x = startX + ((moveEvent.clientX - originX) / rect.width) * 100;
        let y = startY + ((moveEvent.clientY - originY) / rect.height) * 100;
        const next = { x: false, y: false };
        const box = artRef.current?.getBoundingClientRect();
        if (box) {
          // Where the artwork's centre would land, on screen, at (x, y).
          const centerX = box.left + box.width / 2 + (x - imageLayout.x) * 0.02 * box.width;
          const centerY = box.top + box.height / 2 + (y - imageLayout.y) * 0.02 * box.height;
          const frameCenterX = rect.left + rect.width / 2;
          const frameCenterY = rect.top + rect.height / 2;
          if (Math.abs(centerX - frameCenterX) < SNAP_PX) {
            x += (frameCenterX - centerX) / (0.02 * box.width);
            next.x = true;
          }
          if (Math.abs(centerY - frameCenterY) < SNAP_PX) {
            y += (frameCenterY - centerY) / (0.02 * box.height);
            next.y = true;
          }
        }
        setGuides(next);
        onImageNudge({
          x: Math.min(50, Math.max(-50, x)),
          y: Math.min(50, Math.max(-50, y)),
        });
      };
      const up = () => {
        setGuides({ x: false, y: false });
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onImageNudge, onSelectionChange, imageLayout.x, imageLayout.y],
  );

  /** Arrow keys nudge the selected artwork by a percent, five with Shift. */
  const nudgeByKey = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 5 : 1;
    const delta: Record<string, Partial<SlideImageLayout>> = {
      ArrowLeft: { x: Math.max(-50, imageLayout.x - step) },
      ArrowRight: { x: Math.min(50, imageLayout.x + step) },
      ArrowUp: { y: Math.max(-50, imageLayout.y - step) },
      ArrowDown: { y: Math.min(50, imageLayout.y + step) },
    };
    const patch = delta[event.key];
    if (!patch) return;
    event.preventDefault();
    onSelectionChange("image");
    onImageNudge(patch);
  };

  /**
   * The style/AI controls sit just under the box they edit, hugging the
   * edge the content is aligned to — under a left-aligned headline they
   * start at its left edge, mirrored on the right. That edge is also the
   * one the width slider grows the box AWAY from, so dragging it never
   * walks the panel out from under the cursor. They are counter-zoomed so
   * they stay the size of every other control, whatever the board's zoom.
   */
  const controlAnchor: { className: string; style: CSSProperties } =
    layout.h === "left"
      ? {
          className: "left-0",
          style: { transform: `scale(${1 / zoom})`, transformOrigin: "top left" },
        }
      : layout.h === "right"
        ? {
            className: "right-0",
            style: { transform: `scale(${1 / zoom})`, transformOrigin: "top right" },
          }
        : {
            className: "left-1/2",
            style: {
              transform: `translateX(-50%) scale(${1 / zoom})`,
              transformOrigin: "top center",
            },
          };

  /**
   * A row's own per-band visibility: the element's `--sh-*` (its display,
   * or `none`) read as "a flex row, or nothing". The row carries `sl-text`
   * so the band alias resolves on it — without that, `display: var(--sh)`
   * fell back to block and the box inside stretched across the column.
   */
  const rowVisibility = (style: CSSProperties): CSSProperties => {
    const vars = style as Record<string, string | undefined>;
    const pick = (key: string) => (vars[key] === "none" ? "none" : "flex");
    return {
      "--sh-l": pick("--sh-l"),
      "--sh-s": pick("--sh-s"),
      "--sh-p": pick("--sh-p"),
      display: "var(--sh)",
    } as CSSProperties;
  };

  const controls = (children: ReactNode) => (
    <div
      className={cn(
        "pointer-events-none absolute top-full z-20 flex items-center gap-1 pt-1.5 opacity-0 transition-opacity group-focus-within/text:pointer-events-auto group-focus-within/text:opacity-100 group-hover/text:pointer-events-auto group-hover/text:opacity-100",
        controlAnchor.className,
      )}
      style={controlAnchor.style}
    >
      {children}
    </div>
  );

  const styleButton = (element: SlideTextElement) => (
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
      inherited={resolveTextStyle(slide, element, shape)}
      defaults={{ letterSpacing: DEFAULT_TRACKING_PCT[element] }}
      onChange={(style) => onStyleChange(element, style)}
      labels={labels}
      anchor={panelAnchor}
    />
  );

  /**
   * One editable text: the box `SlideView` styled, holding a field instead
   * of the text. The WRAPPER spans the copy column so the box's width is a
   * share of the same column the storefront measures it against; only the
   * BOX takes the pointer, never the wrapper — otherwise the copy column
   * would blanket the board and the artwork behind it could never be
   * clicked.
   */
  const renderText = (box: SlideTextBox) => (
    <div
      key={box.element}
      className="sl-text group/text pointer-events-none relative w-full"
      style={{ justifyContent: "var(--sl-jc)", ...rowVisibility(box.style) }}
    >
      <div
        // The box the caret is actually in fills with a wash, so which of
        // several framed boxes you are typing into is never a guess.
        className={cn(
          box.className,
          "pointer-events-auto relative rounded-[2px] transition-colors group-focus-within/text:bg-primary/15",
        )}
        style={box.style}
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
        <GrowingTextarea
          value={box.text}
          onChange={(next) => onTextChange(box.element, next)}
          onFocus={() => onSelectionChange("content")}
          placeholder={labels.placeholders[box.element]}
        />
        {controls(
          <>
            {styleButton(box.element)}
            {renderAiAction?.(box.element)}
          </>,
        )}
      </div>
    </div>
  );

  /**
   * A button: the storefront's own chrome (`SlideView` styled it) around a
   * field. Its width sits on the wrapper here — the band's own value, which
   * is exact because the board IS that band — and the chrome fills it,
   * which is the same box the storefront's `width: var(--wd)` makes. The
   * plate style lives in the gear with the button's other settings, so the
   * float stays three buttons.
   */
  const renderCta = (box: SlideCtaBox) => {
    const element = box.element;
    // The band's own value, computed from the frame exactly as the
    // storefront's `width: var(--wd)` is — exact because the board IS the band.
    const width = textBoxWidthCss(resolveTextStyle(slide, element, shape).width);
    const link = element === "cta2" ? slide.link2 : slide.link;
    const variant = element === "cta2" ? slide.cta2Variant : slide.ctaVariant;
    return (
      <div
        key={element}
        className="sl-text group/text pointer-events-none relative w-full"
        style={{ justifyContent: "var(--sl-jc)", ...rowVisibility(box.style) }}
      >
        <div
          className="pointer-events-auto relative rounded-[2px] transition-colors group-focus-within/text:bg-primary/15"
          style={{ width, maxWidth: "100%" }}
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
            {...box.attrs}
            className={cn(box.className, "flex w-full")}
            style={{ ...box.style, width: "100%", display: "inline-flex" }}
          >
            <input
              value={box.text}
              onChange={(event) => onTextChange(element, event.target.value)}
              onFocus={() => onSelectionChange("content")}
              placeholder={labels.placeholders[element]}
              spellCheck={false}
              // The field is exactly as wide as its label, so the button
              // around it is the width the storefront's shrink-wrapped
              // button is; `size` is the fallback where a browser cannot
              // size a field to its content.
              size={Math.max(4, box.text.length || labels.placeholders[element].length)}
              className="min-w-0 border-none bg-transparent p-0 text-center outline-none placeholder:text-current placeholder:opacity-50 focus:ring-0"
              style={{ ...INHERIT_TEXT, fieldSizing: "content" } as CSSProperties}
            />
          </span>
          {controls(
            <>
              {styleButton(element)}
              {/* Link, plate style, padding, corners — the button's own settings. */}
              <CtaSettingsPopover
                trigger={
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-[5px] border border-border bg-background text-muted-foreground shadow-sm transition hover:bg-accent hover:text-foreground"
                    aria-label={`${labels.ctaSettings.title}: ${element}`}
                    title={labels.ctaSettings.title}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
                }
                link={link}
                variant={variant}
                ownStyle={ownTextStyle(slide, element, shape)}
                labels={labels.ctaSettings}
                onLinkChange={(next) => onLinkChange(element, next)}
                onVariantChange={(next) => onCtaVariantChange(element, next)}
                onStyleChange={(style) => onStyleChange(element, style)}
                anchor={panelAnchor}
              />
              {renderAiAction?.(element)}
            </>,
          )}
        </div>
      </div>
    );
  };

  /** The artwork, selected by clicking it like any other layer, dragged or arrow-keyed to nudge. */
  const renderArt = (box: SlideArtBox) => (
    <div
      ref={artRef}
      className={cn(box.className, "group/art cursor-move outline-none")}
      onPointerDown={startImageDrag}
      onKeyDown={nudgeByKey}
      tabIndex={0}
      role="img"
      aria-label={slide.alt || "artwork"}
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
      {box.children}
    </div>
  );

  return (
    <div ref={hostRef} className={cn("relative w-full", className)}>
      <div
        className="relative mx-auto"
        style={{ width: frame.width * zoom, height: frame.height * zoom }}
      >
        {/* The box the style and button panels hang from: the board's, as
            shown on screen, so a panel never lands on the slide. */}
        <div ref={setPanelAnchor} aria-hidden className="pointer-events-none absolute inset-0" />
        <div
          ref={boardRef}
          // The board: a real slider frame at the band's real size, so the
          // same container queries the storefront uses pick this band.
          className="sl-frame absolute left-0 top-0 overflow-hidden rounded-xl bg-muted"
          style={{
            width: frame.width,
            height: frame.height,
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
          }}
        >
          <SlideView
            slide={slide}
            editing
            price={
              typeof productPrice === "number" ? { amount: productPrice } : null
            }
            // Only ever the stored deadline and the bound product's price:
            // the board shows what will actually ship, never a sample.
            pricePlaceholder={
              slide.productId ? "···" : `(${labels.bindProduct})`
            }
            formatPrice={formatPrice}
            labels={{ startingAt: labels.startingAt, countdown: labels.countdown }}
            stackClassName={cn(
              selection === "content" &&
                "outline-dashed outline-1 outline-offset-[10px] outline-primary/40",
            )}
            renderText={renderText}
            renderCta={renderCta}
            renderArt={renderArt}
          />
          {/* Snap guides while the artwork sits on the slide's centre line. */}
          {guides.x ? (
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 z-30 w-px bg-primary" />
          ) : null}
          {guides.y ? (
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 z-30 h-px bg-primary" />
          ) : null}
        </div>
        {/* The frame and how much of it is on screen. */}
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-[4px] bg-background/85 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground shadow-sm">
          {frame.width} × {frame.height} · {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  );
}
