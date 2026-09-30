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
import dynamic from "next/dynamic";
import {
  ChevronLeft,
  ChevronRight,
  Expand,
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
  thumbnailTileMaxWidthClass,
} from "@/components/products/gallery-layout";
import { Badge } from "@/components/ui/badge";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useIdlePreload } from "@/hooks/use-idle-preload";
import {
  GalleryMediaFrame,
  GalleryThumbnail,
  MEDIA_SURFACE_CLASS,
  THUMB_SURFACE_ACTIVE_CLASS,
  THUMB_SURFACE_IDLE_CLASS,
  getMediaKind,
  thumbnailLabel,
  type GalleryMedia,
  type MediaKind,
} from "@/components/products/product-gallery-media";

/**
 * The fullscreen viewer — the dialog and its primitive — is its own module:
 * it opens on a click, never with the page. Client-only, which also gives it
 * a Suspense boundary of its own, so a first open that beats the idle
 * preload waits in place instead of suspending the whole product section.
 */
const ProductGalleryViewer = dynamic(
  () =>
    import("@/components/products/product-gallery-viewer").then(
      (module) => module.ProductGalleryViewer,
    ),
  { ssr: false },
);
const preloadViewer = () =>
  import("@/components/products/product-gallery-viewer");

/** Thumbnails shown under the main media before overflow collapses into "+N". */
const THUMBNAIL_SLOTS = 4;


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
 * The product page's gallery settings (product-detail-style.ts). Absent,
 * every frame keeps the design as shipped.
 */
interface ProductGalleryAppearance {
  radius: number;
  gap: number;
  fit: "contain" | "cover";
  /** Air around a contained image, px; -1 = the responsive default. */
  padding: number;
  /** Thumbnail width, px; capped to its share of the row. */
  thumbSize: number;
  thumbRadius: number;
  /** Outline on the selected thumbnail; "" = the tile's surface step. */
  thumbActiveBorder: string;
  /** Behind each thumbnail; "" = the neutral grey tile. */
  thumbBackground: string;
  thumbFit: "contain" | "cover";
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
  const tf = useFallbackTranslator(useTranslations());
  // Fetched once the page is idle; mounted the first time it opens and kept,
  // so closing it still animates.
  useIdlePreload(preloadViewer);
  const [viewerUsed, setViewerUsed] = useState(false);
  const openViewer = () => {
    setViewerUsed(true);
    setIsFullscreenOpen(true);
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
                  openViewer();
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
                      openViewer();
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
                  openViewer();
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
            onClick={openViewer}
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
              onClick={openViewer}
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
            // A merchant-set tile width needs a definite row width to cap
            // against: the row is a flex item with auto margins, so without
            // this it is sized to its own content and the tiles' percentage
            // ceiling would measure itself.
            customThumbWidth && "w-full",
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
                  if (isOverflowTile) openViewer();
                }}
                className={cn(
                  // No border/ring on the selected tile: selection reads purely from
                  // contrast (see the inner layer). Every tile keeps an identical
                  // surface so the row stays a calm, even strip.
                  "group relative aspect-4/3 overflow-hidden rounded-md ring-offset-background transition-colors duration-200",
                  customThumbWidth
                    ? cn(
                        "w-[var(--gallery-thumb-w)] shrink-0",
                        // Its share of THIS row, so a strip of two or three
                        // keeps the width it was given.
                        thumbnailTileMaxWidthClass(visibleThumbIndexes.length),
                      )
                    : THUMBNAIL_TILE_WIDTH_CLASS,
                  // The rail is a column: its tiles take the rail's width,
                  // and the four-up ceiling has nothing to say there.
                  layout === "left" && "lg:w-full lg:max-w-none",
                  isSelected
                    ? THUMB_SURFACE_ACTIVE_CLASS
                    : THUMB_SURFACE_IDLE_CLASS,
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                )}
                style={
                  look
                    ? {
                        borderRadius: look.thumbRadius,
                        // Inline beats the surface classes; selection still
                        // reads from the artwork dimming and the outline.
                        ...(look.thumbBackground
                          ? { backgroundColor: look.thumbBackground }
                          : {}),
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
                    fit={look?.thumbFit}
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

      {viewerUsed ? (
        <ProductGalleryViewer
          open={isFullscreenOpen}
          onOpenChange={setIsFullscreenOpen}
          media={media}
          selectedIndex={selectedIndex}
          productName={productName}
          zoomed={selectedIsImage && isZoomEnabled}
          isCoarsePointer={isCoarsePointer}
          transformOrigin={transformOrigin}
          onKeyDown={handleKeyNavigation}
          onPrevious={goPrev}
          onNext={goNext}
          onPick={(index) => {
            setTransformOrigin("50% 50%");
            setIsZoomEnabled(false);
            onSelect(index);
          }}
        />
      ) : null}
    </div>
  );
}
