"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type UIEvent,
} from "react";
import {
  Box,
  ChevronLeft,
  ChevronRight,
  Expand,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  GALLERY_STACK_CLASS,
  MEDIA_FRAME_CLASS,
  THUMBNAIL_ROW_CLASS,
  THUMBNAIL_TILE_WIDTH_CLASS,
} from "@/components/products/gallery-layout";
import { AppImage } from "@/components/ui/app-image";
import { ExternalVideoPlayer } from "@/components/products/external-video-player";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ModelViewer } from "@/components/ui/model-viewer";

type MediaKind = "image" | "video" | "model" | "external_video";

/** Thumbnails shown under the main media before overflow collapses into "+N". */
const THUMBNAIL_SLOTS = 4;

/** Neutral backdrop shared by every media surface (main frame, thumbs, viewer). */
const MEDIA_SURFACE_CLASS = "bg-[#f0f0f0] dark:bg-muted";

/**
 * Thumbnail selection is carried by the tile surface, not a border or ring.
 * Opacity alone was unreliable: a bright inactive photo out-shone a dark active
 * one, and greying inactive tiles was off the table because the thumbnails here
 * encode colour variants. The surface step is independent of photo content, so
 * it holds up in both themes.
 */
const THUMB_SURFACE_ACTIVE_CLASS = "bg-[#e2e2e2] dark:bg-white/14";
const THUMB_SURFACE_IDLE_CLASS = "bg-[#f4f4f4] dark:bg-white/5";


type GalleryMedia = {
  id: string;
  type?: MediaKind;
  url: string;
  alt?: string;
  mimeType?: string;
  thumbnailUrl?: string;
  /** external_video only. */
  provider?: "youtube" | "vimeo";
  embedId?: string;
  /** Images: "auto" follows the page's fit; the product editor sets it per image. */
  fit?: "auto" | "contain" | "cover";
  /** Intrinsic pixel size, recorded at upload — gives a frame its proportions. */
  width?: number;
  height?: number;
};

/**
 * The horizontal carousel's track height when the page sets none: tall enough
 * to read as the product's photography, short enough on a phone that the
 * price is still in reach below it.
 */
const CAROUSEL_TRACK_HEIGHT_CLASS =
  "h-[52vh] max-h-[440px] sm:h-[56vh] sm:max-h-[520px] lg:h-[min(640px,calc(100svh-var(--storefront-header-height,7rem)-10rem))] lg:max-h-none";

/**
 * A media item's own proportions (width ÷ height), or null when nothing says.
 * Images and videos carry them from upload; an embedded video is 16:9 by
 * construction. A 3D model has none — its frame falls back to 4:3.
 */
function mediaRatio(item: GalleryMedia, kind: MediaKind): number | null {
  if (kind === "external_video") return 16 / 9;
  if ((kind === "image" || kind === "video") && item.width && item.height) {
    return item.width / item.height;
  }
  return null;
}

/**
 * The product page's gallery settings (product-detail-style.ts). Absent — the
 * classic and electronics buy boxes, the quick view — every frame keeps the
 * design as shipped.
 */
export interface ProductGalleryAppearance {
  radius: number;
  gap: number;
  fit: "contain" | "cover";
  /** Air around a contained image, px; -1 = the responsive default. */
  padding: number;
  /** Thumbnail width, px; 0 = the layout's own. */
  thumbSize: number;
  thumbRadius: number;
  /** Outline on the selected thumbnail; "" = the tile's surface step. */
  thumbActiveBorder: string;
  zoom: boolean;
  thumbnails: boolean;
}

interface ProductImageGalleryProps {
  media: GalleryMedia[];
  productName: string;
  selectedIndex: number;
  onSelect: (index: number) => void;
  discountPercentage?: number;
  /**
   * Product-template setting (the product-main section's `galleryLayout`).
   * "bottom" is the original thumbnails-under-main arrangement; "left" moves
   * them into a vertical rail at xl; "grid" tiles every media item and opens
   * the fullscreen viewer on click; "carousel" is a scroll-snap strip with
   * dots; "vertical" stacks every media item full-width. The sixth layout,
   * "full", is arranged by ProductDetails (single column) and renders here
   * as "bottom".
   */
  layout?: "bottom" | "left" | "grid" | "carousel" | "vertical";
  /** Overrides the main stage's neutral backdrop (Minimal's Preview style). */
  stageBackground?: string;
  /**
   * Fixed frame height in px; absent keeps the responsive default. Every
   * layout honours it: the main image, each carousel slide, each image in the
   * vertical stack, each grid tile.
   */
  stageHeight?: number;
  appearance?: ProductGalleryAppearance;
}

export function ProductImageGallery({
  media,
  productName,
  selectedIndex,
  onSelect,
  discountPercentage = 0,
  layout = "bottom",
  stageBackground,
  stageHeight,
  appearance,
}: ProductImageGalleryProps) {
  const stageFrameStyle = stageHeight ? { height: stageHeight } : undefined;
  const look = appearance;
  // Radius rides inline: a frame's rounded-lg is the shipped default only.
  const frameRadius = look ? { borderRadius: look.radius } : undefined;
  const frameSurface = {
    ...frameRadius,
    ...(stageBackground ? { backgroundColor: stageBackground } : {}),
  };
  const zoomAllowed = look?.zoom ?? true;
  const showThumbnails = look?.thumbnails ?? true;
  const customThumbWidth = Boolean(look && look.thumbSize > 0);
  /** An image's own fit wins; "auto" (or none) follows the page's. */
  const fitFor = (item: GalleryMedia): "contain" | "cover" =>
    item.fit === "contain" || item.fit === "cover"
      ? item.fit
      : (look?.fit ?? "contain");
  const imagePadding = look?.padding ?? -1;
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [isZoomEnabled, setIsZoomEnabled] = useState(false);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [transformOrigin, setTransformOrigin] = useState("50% 50%");
  const carouselRef = useRef<HTMLDivElement | null>(null);
  // Each slide is as wide as its image, so a slide's position is read from
  // the slide itself rather than worked out as index × strip width.
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  const carouselScrollFrame = useRef<number | null>(null);
  // Set while an arrow/thumb drives the strip, so the scroll listener does
  // not fight the smooth scroll by re-selecting every intermediate slide.
  const carouselProgrammatic = useRef(false);

  // Same guarded-translation idiom the rest of the storefront uses: locales that
  // haven't picked up the gallery keys yet fall back to the English literal
  // instead of rendering a MISSING_MESSAGE error into an aria-label.
  const t = useTranslations();
  const tf = (
    key: string,
    fallback: string,
    values?: Record<string, string | number>,
  ) => {
    if (t.has(key)) return t(key as never, values as never);
    if (!values) return fallback;
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      fallback,
    );
  };

  const selectedMedia = media[selectedIndex];
  const canNavigate = media.length > 1;
  const selectedKind = selectedMedia ? getMediaKind(selectedMedia) : "image";
  const selectedIsImage = selectedKind === "image";

  // Thumbnails are limited to a fixed 4-up row. When there is more media, the
  // last tile previews the next item behind a blur with a "+N" remaining count.
  const hiddenCount = Math.max(0, media.length - THUMBNAIL_SLOTS);
  const lastSlotIndex =
    hiddenCount > 0 && selectedIndex >= THUMBNAIL_SLOTS - 1
      ? selectedIndex
      : THUMBNAIL_SLOTS - 1;
  const visibleThumbIndexes =
    media.length <= THUMBNAIL_SLOTS
      ? media.map((_, index) => index)
      : [...Array.from({ length: THUMBNAIL_SLOTS - 1 }, (_, i) => i), lastSlotIndex];

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(pointer: coarse)");
    const updatePointerType = () => setIsCoarsePointer(mediaQuery.matches);
    updatePointerType();

    mediaQuery.addEventListener("change", updatePointerType);
    return () => mediaQuery.removeEventListener("change", updatePointerType);
  }, []);

  const goNext = () => {
    if (!canNavigate) return;
    setTransformOrigin("50% 50%");
    onSelect((selectedIndex + 1) % media.length);
  };

  const goPrev = () => {
    if (!canNavigate) return;
    setTransformOrigin("50% 50%");
    onSelect((selectedIndex - 1 + media.length) % media.length);
  };

  // Carousel layout: the strip FOLLOWS selectedIndex (arrows, dots, and the
  // buy box's variant swatches all drive the same state), and manual swipes
  // report back through the scroll listener below.
  useEffect(() => {
    if (layout !== "carousel") return;
    const strip = carouselRef.current;
    const slide = slideRefs.current[selectedIndex];
    if (!strip || !slide) return;
    // The strip is the slides' offset parent, so offsetLeft is measured in
    // the strip's own scroll coordinates. Clamped: the last slides may not
    // be able to reach the start edge.
    const target = Math.min(
      strip.scrollWidth - strip.clientWidth,
      slide.offsetLeft,
    );
    if (Math.abs(strip.scrollLeft - target) < 2) return;
    carouselProgrammatic.current = true;
    strip.scrollTo({ left: target, behavior: "smooth" });
    const release = window.setTimeout(() => {
      carouselProgrammatic.current = false;
    }, 400);
    return () => window.clearTimeout(release);
  }, [layout, selectedIndex]);

  const handleCarouselScroll = (event: UIEvent<HTMLDivElement>) => {
    if (carouselProgrammatic.current) return;
    const strip = event.currentTarget;
    if (carouselScrollFrame.current !== null) {
      cancelAnimationFrame(carouselScrollFrame.current);
    }
    carouselScrollFrame.current = requestAnimationFrame(() => {
      carouselScrollFrame.current = null;
      if (!strip.clientWidth) return;
      // The selected slide is the one whose start sits nearest the strip's
      // left edge. Positions are clamped to the furthest the strip can
      // scroll, so at the end the first slide that has fully arrived wins.
      const max = strip.scrollWidth - strip.clientWidth;
      let index = 0;
      let best = Number.POSITIVE_INFINITY;
      slideRefs.current.slice(0, media.length).forEach((slide, position) => {
        if (!slide) return;
        const distance = Math.abs(
          Math.min(max, slide.offsetLeft) - strip.scrollLeft,
        );
        if (distance < best - 1) {
          best = distance;
          index = position;
        }
      });
      if (index !== selectedIndex) onSelect(index);
    });
  };

  const handlePointerMove = (event: MouseEvent<HTMLButtonElement>) => {
    if (!selectedIsImage || !isZoomEnabled || isCoarsePointer) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    setTransformOrigin(`${Math.max(0, Math.min(x, 100))}% ${Math.max(0, Math.min(y, 100))}%`);
  };

  const handleKeyNavigation = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goPrev();
    }
  };

  if (!selectedMedia) {
    return (
      <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-border/50 bg-muted/30 text-sm text-muted-foreground">
        {tf("product.gallery.noImage", "No image")}
      </div>
    );
  }

  return (
    <div
      className={cn(
        // A configured gap needs a flex stack: space-y cannot take an inline
        // value. The shipped stack stays exactly as it was.
        look ? "mx-auto flex w-full max-w-xl flex-col lg:max-w-none" : GALLERY_STACK_CLASS,
        // Left rail: same stacked layout until lg — where the buy box moves
        // beside the gallery — then thumbs become a vertical column beside
        // the main frame.
        layout === "left" &&
          (look
            ? "lg:flex-row lg:items-start"
            : "lg:flex lg:items-start lg:gap-4 lg:space-y-0"),
      )}
      style={
        look
          ? ({
              gap: look.gap,
              ...(customThumbWidth
                ? { "--gallery-thumb-w": `${look.thumbSize}px` }
                : {}),
            } as CSSProperties)
          : undefined
      }
    >
      {layout === "grid" ? (
        /* Grid: every media item tiled; any tile opens the fullscreen viewer. */
        <div
          className={cn("grid grid-cols-2", !look && "gap-3 sm:gap-4")}
          style={look ? { gap: look.gap } : undefined}
        >
          {media.map((item, index) => {
            const kind = getMediaKind(item);
            return (
              <button
                key={item.id}
                type="button"
                aria-label={thumbnailLabel(tf, kind, index)}
                onClick={() => {
                  setTransformOrigin("50% 50%");
                  setIsZoomEnabled(false);
                  onSelect(index);
                  setIsFullscreenOpen(true);
                }}
                className={cn(
                  "group relative overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2",
                  MEDIA_SURFACE_CLASS,
                  // A fixed height replaces the tiles' proportions.
                  !stageHeight && "aspect-square",
                  index === 0 && media.length > 1 && "col-span-2",
                  index === 0 && media.length > 1 && !stageHeight && "aspect-4/3",
                )}
                style={{ ...frameSurface, ...stageFrameStyle }}
              >
                <GalleryMediaFrame
                  item={item}
                  kind={kind}
                  productName={productName}
                  priority={index === 0}
                  fit={fitFor(item)}
                  padding={imagePadding}
                  hoverZoom={zoomAllowed}
                />
                {index === 0 && discountPercentage > 0 && (
                  <Badge className="absolute left-3 top-3 rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500">
                    -{discountPercentage}%
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      ) : layout === "carousel" ? (
        /* Horizontal carousel: one fixed height, and every slide as wide as
           its own image at that height — a portrait shot is a narrow slide, a
           landscape one a wide slide, none of them cropped or letterboxed to
           a shared shape. Arrows and dots, no thumbnail row. */
        <div className="space-y-3">
          <div className="relative">
            <div
              ref={carouselRef}
              onScroll={handleCarouselScroll}
              onKeyDown={handleKeyNavigation}
              className={cn(
                // relative: the slides' offset parent, for the scroll sync.
                "relative flex snap-x snap-mandatory overflow-x-auto scrollbar-none",
                !stageHeight && CAROUSEL_TRACK_HEIGHT_CLASS,
              )}
              style={{
                ...stageFrameStyle,
                gap: look ? look.gap : 12,
              }}
            >
              {media.map((item, index) => {
                const kind = getMediaKind(item);
                const ratio = mediaRatio(item, kind);
                // An image whose size was never recorded takes its width from
                // the picture itself once it loads.
                const intrinsic = !ratio && kind === "image";
                return (
                  <button
                    key={item.id}
                    ref={(node) => {
                      slideRefs.current[index] = node;
                    }}
                    type="button"
                    aria-label={thumbnailLabel(tf, kind, index)}
                    onClick={() => {
                      setTransformOrigin("50% 50%");
                      setIsZoomEnabled(false);
                      onSelect(index);
                      setIsFullscreenOpen(true);
                    }}
                    className={cn(
                      "group relative h-full max-w-full shrink-0 snap-start overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
                      MEDIA_SURFACE_CLASS,
                    )}
                    style={{
                      ...frameSurface,
                      // The width follows from the height and the ratio.
                      ...(ratio
                        ? { aspectRatio: String(ratio) }
                        : intrinsic
                          ? {}
                          : { aspectRatio: "4 / 3" }),
                    }}
                  >
                    <GalleryMediaFrame
                      item={item}
                      kind={kind}
                      productName={productName}
                      priority={index === 0}
                      fit={fitFor(item)}
                      padding={imagePadding}
                      hoverZoom={zoomAllowed}
                      intrinsic={intrinsic ? "height" : undefined}
                    />
                  </button>
                );
              })}
            </div>

            {discountPercentage > 0 && (
              <Badge className="pointer-events-none absolute left-3 top-3 rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 sm:left-4 sm:top-4">
                -{discountPercentage}%
              </Badge>
            )}

            {canNavigate && (
              <>
                <button
                  type="button"
                  aria-label={tf("product.gallery.previous", "Show previous media")}
                  onClick={goPrev}
                  className="absolute left-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-background/95 text-foreground shadow-sm transition-all hover:scale-105 hover:bg-background sm:left-4"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={tf("product.gallery.next", "Show next media")}
                  onClick={goNext}
                  className="absolute right-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-background/95 text-foreground shadow-sm transition-all hover:scale-105 hover:bg-background sm:right-4"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}
          </div>

          {canNavigate && (
            <div className="flex justify-center gap-2">
              {media.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={thumbnailLabel(tf, getMediaKind(item), index)}
                  aria-pressed={index === selectedIndex}
                  onClick={() => onSelect(index)}
                  className={cn(
                    "h-2 rounded-full transition-all",
                    index === selectedIndex
                      ? "w-6 bg-foreground"
                      : "w-2 bg-foreground/25 hover:bg-foreground/50",
                  )}
                />
              ))}
            </div>
          )}
        </div>
      ) : layout === "vertical" ? (
        /* Vertical carousel: every media item stacked full-width; the buy box
           column stays sticky beside the scroll (ProductDetails arranges it). */
        <div
          className={look ? "flex flex-col" : "space-y-3 sm:space-y-4"}
          style={look ? { gap: look.gap } : undefined}
        >
          {media.map((item, index) => {
            const kind = getMediaKind(item);
            const ratio = mediaRatio(item, kind);
            return (
              <button
                key={item.id}
                type="button"
                aria-label={thumbnailLabel(tf, kind, index)}
                onClick={() => {
                  setTransformOrigin("50% 50%");
                  setIsZoomEnabled(false);
                  onSelect(index);
                  setIsFullscreenOpen(true);
                }}
                className={cn(
                  "group relative block w-full overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2",
                  MEDIA_SURFACE_CLASS,
                )}
                style={{
                  ...frameSurface,
                  // No fixed height: full width, and the height the image's
                  // own proportions give it.
                  ...(ratio
                    ? { aspectRatio: String(ratio) }
                    : kind === "image"
                      ? {}
                      : { aspectRatio: "4 / 3" }),
                }}
              >
                <GalleryMediaFrame
                  item={item}
                  kind={kind}
                  productName={productName}
                  priority={index === 0}
                  fit={fitFor(item)}
                  padding={imagePadding}
                  hoverZoom={zoomAllowed}
                  intrinsic={!ratio && kind === "image" ? "width" : undefined}
                />
                {index === 0 && discountPercentage > 0 && (
                  <Badge className="absolute left-3 top-3 rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500">
                    -{discountPercentage}%
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <>
      {/* Main media - square on desktop, capped so the thumbnail row stays in view */}
      <div
        className={cn(
          "relative overflow-hidden rounded-lg",
          MEDIA_SURFACE_CLASS,
          layout === "left" && "lg:min-w-0 lg:flex-1",
        )}
        style={frameSurface}
      >
        {selectedIsImage ? (
          <button
            type="button"
            aria-label={tf(
              "product.gallery.openFullscreen",
              "Open product gallery fullscreen",
            )}
            onClick={() => setIsFullscreenOpen(true)}
            onMouseMove={handlePointerMove}
            onKeyDown={handleKeyNavigation}
            className={cn(
              "group relative block w-full overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2",
              zoomAllowed ? "cursor-zoom-in" : "cursor-pointer",
            )}
            style={frameRadius}
          >
            <div className={MEDIA_FRAME_CLASS} style={stageFrameStyle}>
              <GalleryMediaFrame
                item={selectedMedia}
                kind={selectedKind}
                productName={productName}
                fit={fitFor(selectedMedia)}
                padding={imagePadding}
                hoverZoom={zoomAllowed}
                isZoomEnabled={zoomAllowed && isZoomEnabled}
                isCoarsePointer={isCoarsePointer}
                transformOrigin={transformOrigin}
                priority
              />
            </div>
          </button>
        ) : (
          <div className={MEDIA_FRAME_CLASS} style={stageFrameStyle}>
            <GalleryMediaFrame
              item={selectedMedia}
              kind={selectedKind}
              productName={productName}
              cameraControls
              priority
            />
          </div>
        )}

        {/* Top bar: discount badge + zoom/expand buttons */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3 sm:p-4">
          {discountPercentage > 0 ? (
            <Badge className="pointer-events-auto rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500">
              -{discountPercentage}%
            </Badge>
          ) : (
            <span />
          )}

          <div className="pointer-events-auto flex items-center gap-2">
            {selectedIsImage && zoomAllowed && (
              <button
                type="button"
                aria-label={
                  isZoomEnabled
                    ? tf("product.gallery.disableZoom", "Disable image zoom")
                    : tf("product.gallery.enableZoom", "Enable image zoom")
                }
                aria-pressed={isZoomEnabled}
                onClick={() => setIsZoomEnabled((prev) => !prev)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background"
              >
                {isZoomEnabled ? (
                  <ZoomOut className="h-4 w-4" />
                ) : (
                  <ZoomIn className="h-4 w-4" />
                )}
              </button>
            )}
            <button
              type="button"
              aria-label={
                selectedIsImage
                  ? tf(
                      "product.gallery.openImageViewer",
                      "Open fullscreen image viewer",
                    )
                  : tf(
                      "product.gallery.openMediaViewer",
                      "Open fullscreen media viewer",
                    )
              }
              onClick={() => setIsFullscreenOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background"
            >
              <Expand className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Prev / Next arrows */}
        {canNavigate && (
          <>
            <button
              type="button"
              aria-label={tf("product.gallery.previous", "Show previous media")}
              onClick={goPrev}
              className="absolute left-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-background/95 text-foreground shadow-sm transition-all hover:scale-105 hover:bg-background sm:left-4"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={tf("product.gallery.next", "Show next media")}
              onClick={goNext}
              className="absolute right-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-background/95 text-foreground shadow-sm transition-all hover:scale-105 hover:bg-background sm:right-4"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {/* Thumbnail row - centered 4-up strip, last tile counts the remaining media */}
      {canNavigate && showThumbnails && (
        // Capped below lg: in the stacked layout the gallery spans the full page
        // width, and uncapped quarter-width tiles would dwarf the main image.
        <div
          className={cn(
            THUMBNAIL_ROW_CLASS,
            // Left rail at lg: DOM order stays main-then-thumbs (mobile is
            // unchanged); order-first moves the rail before the frame.
            layout === "left" &&
              cn(
                "lg:order-first lg:mx-0 lg:shrink-0 lg:flex-col lg:justify-start",
                customThumbWidth ? "lg:w-[var(--gallery-thumb-w)]" : "lg:w-24",
              ),
          )}
        >
          {visibleThumbIndexes.map((index, slot) => {
            const item = media[index];
            if (!item) return null;
            const isSelected = index === selectedIndex;
            const isOverflowTile =
              hiddenCount > 0 && slot === THUMBNAIL_SLOTS - 1 && !isSelected;
            const kind = getMediaKind(item);
            return (
              <button
                key={item.id}
                type="button"
                aria-label={
                  isOverflowTile
                    ? tf(
                        "product.gallery.showAllMedia",
                        "Show all {count} media items",
                        { count: media.length },
                      )
                    : thumbnailLabel(tf, kind, index)
                }
                aria-pressed={isSelected}
                onClick={() => {
                  setTransformOrigin("50% 50%");
                  setIsZoomEnabled(false);
                  onSelect(index);
                  if (isOverflowTile) setIsFullscreenOpen(true);
                }}
                className={cn(
                  // No border/ring on the selected tile: selection reads purely from
                  // contrast (see the inner layer). Every tile keeps an identical
                  // surface so the row stays a calm, even strip.
                  "group relative aspect-4/3 overflow-hidden rounded-md ring-offset-background transition-colors duration-200",
                  customThumbWidth
                    ? "w-[var(--gallery-thumb-w)] shrink-0"
                    : THUMBNAIL_TILE_WIDTH_CLASS,
                  layout === "left" && "lg:w-full",
                  isSelected
                    ? THUMB_SURFACE_ACTIVE_CLASS
                    : THUMB_SURFACE_IDLE_CLASS,
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                )}
                style={
                  look
                    ? {
                        borderRadius: look.thumbRadius,
                        // An inset outline, so selection never shifts the row.
                        ...(isSelected && look.thumbActiveBorder
                          ? { boxShadow: `inset 0 0 0 2px ${look.thumbActiveBorder}` }
                          : {}),
                      }
                    : undefined
                }
              >
                <div
                  className={cn(
                    // Dim the artwork, not the tile: the card surface stays solid so
                    // inactive tiles don't wash out into the page background.
                    "relative h-full w-full transition-opacity duration-200 motion-reduce:transition-none",
                    isSelected
                      ? "opacity-100"
                      : "opacity-60 group-hover:opacity-90",
                    isOverflowTile && "scale-105 blur-[3px]",
                  )}
                >
                  <GalleryThumbnail
                    item={item}
                    kind={kind}
                    productName={productName}
                    size="sm"
                  />
                </div>

                {isOverflowTile && (
                  <span className="absolute inset-0 flex items-center justify-center bg-foreground/35 text-base font-semibold text-background sm:text-lg">
                    +{hiddenCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
        </>
      )}

      {/* Fullscreen dialog */}
      <Dialog open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
        <DialogContent
          showCloseButton={false}
          className="aspect-square h-auto max-h-[90vh] w-[90vw] max-w-[90vh] gap-0 overflow-hidden rounded-lg border-border/60 bg-background p-0 sm:max-w-3xl"
          onKeyDown={handleKeyNavigation}
        >
          <DialogTitle className="sr-only">
            {tf("product.gallery.viewerTitle", "{name} media viewer", {
              name: productName,
            })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {tf(
              "product.gallery.viewerDescription",
              "Browse product media in fullscreen mode with keyboard navigation.",
            )}
          </DialogDescription>
          <button
            type="button"
            aria-label={tf("product.gallery.close", "Close media viewer")}
            onClick={() => setIsFullscreenOpen(false)}
            className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background sm:right-4 sm:top-4"
          >
            <X className="h-4 w-4" />
          </button>
          {/* min-w-0: DialogContent is a grid, and a grid item will not shrink
              below its content's min-content width — here, the thumbnail
              row laid end to end. Without it a long gallery widens the column
              past the dialog, which clips the right of the viewer: the image
              sits off-centre, the next arrow is cut away, and the thumbnail
              row stops scrolling because it is never narrower than itself. */}
          <div className="relative flex h-full min-w-0 flex-col">
            <div
              className={cn(
                "relative flex flex-1 items-center justify-center overflow-hidden",
                MEDIA_SURFACE_CLASS,
              )}
            >
              <GalleryMediaFrame
                item={selectedMedia}
                kind={selectedKind}
                productName={productName}
                isZoomEnabled={selectedIsImage && isZoomEnabled}
                isCoarsePointer={isCoarsePointer}
                transformOrigin={transformOrigin}
                fullscreen
                cameraControls
              />

              {canNavigate && (
                <>
                  <button
                    type="button"
                    aria-label={tf(
                      "product.gallery.previousFullscreen",
                      "Previous fullscreen media",
                    )}
                    onClick={goPrev}
                    className="absolute left-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-background/95 text-foreground shadow-sm transition hover:bg-background sm:left-5"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    aria-label={tf(
                      "product.gallery.nextFullscreen",
                      "Next fullscreen media",
                    )}
                    onClick={goNext}
                    className="absolute right-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-background/95 text-foreground shadow-sm transition hover:bg-background sm:right-5"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>
            <div className="border-t border-border/70 bg-background px-3 py-3 sm:px-5">
              <div className="flex gap-2 overflow-x-auto p-1">
                {media.map((item, index) => {
                  const isSelected = index === selectedIndex;
                  const kind = getMediaKind(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={tf(
                        "product.gallery.openFullscreenItem",
                        "Open fullscreen {kind} {position}",
                        { kind: mediaLabel(tf, kind), position: index + 1 },
                      )}
                      aria-pressed={isSelected}
                      onClick={() => {
                        setTransformOrigin("50% 50%");
                        setIsZoomEnabled(false);
                        onSelect(index);
                      }}
                      className={cn(
                        "group relative h-16 w-16 shrink-0 overflow-hidden rounded-md ring-offset-background transition-colors duration-200",
                        isSelected
                          ? THUMB_SURFACE_ACTIVE_CLASS
                          : THUMB_SURFACE_IDLE_CLASS,
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                      )}
                    >
                      <div
                        className={cn(
                          "relative h-full w-full transition-opacity duration-200 motion-reduce:transition-none",
                          isSelected
                            ? "opacity-100"
                            : "opacity-60 group-hover:opacity-90",
                        )}
                      >
                        <GalleryThumbnail
                          item={item}
                          kind={kind}
                          productName={productName}
                          size="md"
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getMediaKind(item: GalleryMedia): MediaKind {
  if (item.type) return item.type;
  const mimeType = item.mimeType?.toLowerCase() || "";
  const url = item.url.toLowerCase();
  if (mimeType.startsWith("video/")) return "video";
  if (
    mimeType.includes("gltf") ||
    mimeType === "application/octet-stream" ||
    url.endsWith(".glb") ||
    url.endsWith(".gltf")
  ) {
    return "model";
  }
  return "image";
}

type Translate = (
  key: string,
  fallback: string,
  values?: Record<string, string | number>,
) => string;

function thumbnailLabel(tf: Translate, kind: MediaKind, index: number) {
  const position = index + 1;
  if (kind === "model")
    return tf("product.gallery.showModel", "Show 3D model {position}", {
      position,
    });
  if (kind === "video" || kind === "external_video")
    return tf("product.gallery.showVideo", "Show video {position}", {
      position,
    });
  return tf("product.gallery.showImage", "Show image {position}", { position });
}

function mediaLabel(tf: Translate, kind: MediaKind) {
  if (kind === "model") return tf("product.gallery.model", "3D model");
  if (kind === "video" || kind === "external_video")
    return tf("product.gallery.video", "video");
  return tf("product.gallery.image", "image");
}

function GalleryMediaFrame({
  item,
  kind,
  productName,
  isZoomEnabled = false,
  isCoarsePointer = false,
  transformOrigin = "50% 50%",
  fullscreen = false,
  cameraControls = false,
  priority = false,
  fit = "contain",
  padding = -1,
  hoverZoom = true,
  intrinsic,
}: {
  item: GalleryMedia;
  kind: MediaKind;
  productName: string;
  isZoomEnabled?: boolean;
  isCoarsePointer?: boolean;
  transformOrigin?: string;
  fullscreen?: boolean;
  cameraControls?: boolean;
  priority?: boolean;
  /** How the image sits in its frame; the fullscreen viewer always contains. */
  fit?: "contain" | "cover";
  /** Air around a contained image, px; -1 = the responsive default. */
  padding?: number;
  /** The slight magnify on hover. */
  hoverZoom?: boolean;
  /**
   * Size an image by its own proportions instead of filling a fixed frame:
   * "width" spans the frame's width at its natural height (the vertical
   * carousel), "height" spans the track's height at its natural width (the
   * horizontal one). Used only when the upload recorded no dimensions.
   */
  intrinsic?: "width" | "height";
}) {
  const alt = item.alt || productName;

  if (kind === "external_video" && item.provider && item.embedId) {
    return (
      // Keyed by media id so navigating between items unmounts the previous
      // player instead of carrying its "playing" state to the next video.
      <ExternalVideoPlayer
        key={item.id}
        provider={item.provider}
        embedId={item.embedId}
        title={alt}
        thumbnailUrl={item.thumbnailUrl}
      />
    );
  }

  if (kind === "model") {
    return (
      <ModelViewer
        src={item.url}
        alt={alt}
        autoRotate
        cameraControls={cameraControls}
        poster={item.thumbnailUrl}
      />
    );
  }

  if (kind === "video") {
    return (
      <video
        src={item.url}
        poster={item.thumbnailUrl}
        controls
        playsInline
        className="h-full w-full object-cover"
      />
    );
  }

  if (intrinsic && !fullscreen) {
    return (
      <AppImage
        src={item.url}
        alt={alt}
        // 0 × 0 plus CSS: next/image's pattern for an image whose size is
        // only known once it loads.
        width={0}
        height={0}
        sizes={
          intrinsic === "width"
            ? "(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 700px"
            : "(max-width: 768px) 80vw, 600px"
        }
        className={cn(
          "block transition-transform duration-500 ease-out motion-reduce:transition-none",
          intrinsic === "width" ? "h-auto w-full" : "h-full w-auto max-w-none",
          fit === "contain" && padding < 0 && "p-4 sm:p-8",
          hoverZoom ? "scale-100 group-hover:scale-[1.025]" : "scale-100",
        )}
        style={
          fit === "contain" && padding >= 0 ? { padding } : undefined
        }
        priority={priority}
      />
    );
  }

  return (
    <AppImage
      src={item.url}
      alt={alt}
      fill
      className={cn(
        "transition-transform duration-500 ease-out motion-reduce:transition-none",
        fullscreen
          ? "object-contain p-6 sm:p-10"
          : fit === "cover"
            ? // Edge to edge: no air, the photograph IS the frame.
              "object-cover"
            : padding >= 0
              ? "object-contain"
              : "object-contain p-4 sm:p-8",
        isZoomEnabled
          ? fullscreen
            ? "scale-[2.2]"
            : "scale-[1.9]"
          : fullscreen || !hoverZoom
            ? "scale-100"
            : "scale-100 group-hover:scale-[1.025]",
      )}
      style={{
        transformOrigin: isCoarsePointer ? "50% 50%" : transformOrigin,
        ...(!fullscreen && fit === "contain" && padding >= 0 ? { padding } : {}),
      }}
      priority={priority}
      loading={fullscreen ? "eager" : undefined}
      sizes={
        fullscreen
          ? "100vw"
          : "(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 700px"
      }
    />
  );
}

function GalleryThumbnail({
  item,
  kind,
  productName,
  size,
}: {
  item: GalleryMedia;
  kind: MediaKind;
  productName: string;
  size: "sm" | "md";
}) {
  if (kind === "external_video") {
    return (
      <div className="relative h-full w-full">
        {item.thumbnailUrl ? (
          <AppImage
            src={item.thumbnailUrl}
            alt={item.alt || `${productName} video thumbnail`}
            fill
            className="object-cover"
            loading="lazy"
            sizes={size === "sm" ? "(max-width: 768px) 25vw, 170px" : "64px"}
          />
        ) : null}
        <Video className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full bg-background/90 p-0.5 text-foreground shadow-sm" />
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className="relative h-full w-full">
        {item.thumbnailUrl ? (
          <AppImage
            src={item.thumbnailUrl}
            alt={item.alt || `${productName} video thumbnail`}
            fill
            className="object-cover"
            loading="lazy"
            sizes={size === "sm" ? "(max-width: 768px) 25vw, 170px" : "64px"}
          />
        ) : (
          <video
            src={item.url}
            muted
            playsInline
            className="h-full w-full object-cover"
          />
        )}
        <Video className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full bg-background/90 p-0.5 text-foreground shadow-sm" />
      </div>
    );
  }

  if (kind === "model") {
    if (item.thumbnailUrl) {
      return (
        <div className="relative h-full w-full">
          <AppImage
            src={item.thumbnailUrl}
            alt={item.alt || `${productName} 3D model thumbnail`}
            fill
            className="object-cover"
            loading="lazy"
            sizes={size === "sm" ? "(max-width: 768px) 25vw, 170px" : "64px"}
          />
          <Box className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-background/95 p-0.5 text-foreground shadow-sm ring-1 ring-border/70" />
        </div>
      );
    }

    return (
      <div className="relative flex h-full w-full items-center justify-center bg-muted/70 text-foreground">
        <Box className={size === "sm" ? "h-5 w-5" : "h-6 w-6"} />
        <Box className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-background/95 p-0.5 text-foreground shadow-sm ring-1 ring-border/70" />
      </div>
    );
  }

  return (
    <AppImage
      src={item.url}
      alt={item.alt || `${productName} thumbnail`}
      fill
      className={size === "sm" ? "object-contain p-2" : "object-contain p-1.5"}
      loading="lazy"
      sizes={size === "sm" ? "(max-width: 768px) 25vw, 170px" : "64px"}
    />
  );
}
