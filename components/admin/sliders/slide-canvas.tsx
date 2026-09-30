"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
  resolveImageLayout,
  resolveTextStyle,
  SLIDE_BAND_KEYS,
  SLIDE_FRAMES,
  textBoxWidthCss,
  type SlideShape,
  type SlideImageLayout,
  type SliderSlide,
  type SlideTextElement,
  type SlideTextTransform,
} from "@/lib/sliders/types";
import {
  type CtaSettingsLabels,
} from "./cta-settings-fields";

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
  /**
   * The band whose design is being edited. It is DERIVED from `frame` by the
   * caller, never chosen beside it — the two disagreeing is how a merchant
   * ended up tuning a headline on a band the shop never used for that cell.
   */
  shape: SlideShape;
  /**
   * The exact frame to draw, in storefront pixels. Defaults to the band's own
   * frame, which is what an unplaced slider gets; a placed one passes the
   * cell it really lands in, so the board is the shop's frame and not a
   * stand-in with the same band but different proportions.
   */
  frame?: { width: number; height: number };
  /** Resolved price of the bound product, in store currency units. */
  productPrice?: number | null;
  /** Which layer the toolbar is currently driving. */
  selection: SlideSelection;
  onSelectionChange: (selection: SlideSelection) => void;
  onTextChange: (element: SlideTextElement, value: string) => void;
  /**
   * What the inspector should show.
   *
   * Styling used to open in a panel floating over the artboard, then behind
   * a button that sat on top of the very words it styled. Selecting IS the
   * gesture now: a text element opens that element's own properties, and
   * `null` — the artwork, or the slide itself — closes back to the main
   * inspector. The canvas says WHAT is being edited; the sidebar, which
   * already holds every other property, shows it.
   */
  onStyleTarget: (element: SlideTextElement | null) => void;
  /** Drag on the artwork: deltas are percent of the slide's own box. */
  onImageNudge: (patch: Partial<SlideImageLayout>) => void;
  labels: SlideCanvasLabels;
  className?: string;
}

/** The tagline's default tracking, as the panel shows it (percent of the size). */
export const DEFAULT_TRACKING_PCT: Record<SlideTextElement, number> = {
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
  frame: frameProp,
  productPrice,
  selection,
  onSelectionChange,
  onTextChange,
  onStyleTarget,
  onImageNudge,
  labels,
  className,
}: SlideCanvasProps) {
  const { formatPrice } = useCurrency();
  const frame = frameProp ?? SLIDE_FRAMES[shape];
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
   * A row's own per-band visibility: the element's `--sh-*` (its display,
   * or `none`) read as "a flex row, or nothing". The row carries `sl-text`
   * so the band alias resolves on it — without that, `display: var(--sh)`
   * fell back to block and the box inside stretched across the column.
   */
  const rowVisibility = (style: CSSProperties): CSSProperties => {
    const vars = style as Record<string, string | undefined>;
    return {
      ...Object.fromEntries(
        SLIDE_BAND_KEYS.map(([suffix]) => [
          `--sh-${suffix}`,
          vars[`--sh-${suffix}`] === "none" ? "none" : "flex",
        ]),
      ),
      display: "var(--sh)",
    } as CSSProperties;
  };

  /** Selecting a layer is what opens its properties. */
  const selectText = (element: SlideTextElement) => {
    onSelectionChange("content");
    onStyleTarget(element);
  };

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
        data-sl-layer="text"
        style={box.style}
        onPointerDown={() => selectText(box.element)}
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
          onFocus={() => selectText(box.element)}
          placeholder={labels.placeholders[box.element]}
        />
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
    return (
      <div
        key={element}
        className="sl-text group/text pointer-events-none relative w-full"
        style={{ justifyContent: "var(--sl-jc)", ...rowVisibility(box.style) }}
      >
        <div
          className="pointer-events-auto relative rounded-[2px] transition-colors group-focus-within/text:bg-primary/15"
          data-sl-layer="text"
          style={{ width, maxWidth: "100%" }}
          onPointerDown={() => selectText(element)}
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
              onFocus={() => selectText(element)}
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
        </div>
      </div>
    );
  };

  /** The artwork, selected by clicking it like any other layer, dragged or arrow-keyed to nudge. */
  const renderArt = (box: SlideArtBox) => (
    <div
      ref={artRef}
      className={cn(box.className, "group/art cursor-move outline-none")}
      data-sl-layer="art"
      onPointerDown={(event) => {
        onStyleTarget(null);
        startImageDrag(event);
      }}
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
        <div
          ref={boardRef}
          // The board: a real slider frame at the band's real size, so the
          // same container queries the storefront uses pick this band.
          className="sl-frame absolute left-0 top-0 overflow-hidden rounded-xl bg-muted"
          // Clicking the slide itself — not a text, not the artwork —
          // deselects, which is what puts the inspector back to the slide's
          // own settings. A click that merely bubbled through a layer is
          // not that, hence the marker.
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("[data-sl-layer]")) return;
            onSelectionChange("content");
            onStyleTarget(null);
          }}
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
