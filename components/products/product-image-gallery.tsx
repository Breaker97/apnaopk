"use client";

import {
  useEffect,
  useRef,
  useState,
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
};

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
  /** Fixed main-stage height in px; absent keeps the responsive default. */
  stageHeight?: number;
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
}: ProductImageGalleryProps) {
  const stageFrameStyle = stageHeight ? { height: stageHeight } : undefined;
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [isZoomEnabled, setIsZoomEnabled] = useState(false);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [transformOrigin, setTransformOrigin] = useState("50% 50%");
  const carouselRef = useRef<HTMLDivElement | null>(null);
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
    if (!strip) return;
    const target = strip.clientWidth * selectedIndex;
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
      const index = Math.min(
        media.length - 1,
        Math.max(0, Math.round(strip.scrollLeft / strip.clientWidth)),
      );
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
        GALLERY_STACK_CLASS,
        // Left rail: same stacked layout until lg — where the buy box moves
        // beside the gallery — then thumbs become a vertical column beside
        // the main frame.
        layout === "left" &&
          "lg:flex lg:items-start lg:gap-4 lg:space-y-0",
      )}
    >
      {layout === "grid" ? (
        /* Grid: every media item tiled; any tile opens the fullscreen viewer. */
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
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
                  "group relative aspect-square overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2",
                  MEDIA_SURFACE_CLASS,
                  index === 0 && media.length > 1 && "col-span-2 aspect-4/3",
                )}
              >
                <GalleryMediaFrame
                  item={item}
                  kind={kind}
                  productName={productName}
                  priority={index === 0}
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
        /* Horizontal carousel: a scroll-snap strip of full-width frames with
           arrows and dots — no thumbnail row. */
        <div className="space-y-3">
          <div
            className={cn("relative overflow-hidden rounded-lg", MEDIA_SURFACE_CLASS)}
            style={stageBackground ? { backgroundColor: stageBackground } : undefined}
          >
            <div
              ref={carouselRef}
              onScroll={handleCarouselScroll}
              onKeyDown={handleKeyNavigation}
              className="flex snap-x snap-mandatory overflow-x-auto scrollbar-none"
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
                    className="relative w-full shrink-0 snap-center focus-visible:outline-none"
                  >
                    <div className={MEDIA_FRAME_CLASS} style={stageFrameStyle}>
                      <GalleryMediaFrame
                        item={item}
                        kind={kind}
                        productName={productName}
                        priority={index === 0}
                      />
                    </div>
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
        <div className="space-y-3 sm:space-y-4">
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
                  "group relative block aspect-4/3 w-full overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2",
                  MEDIA_SURFACE_CLASS,
                )}
              >
                <GalleryMediaFrame
                  item={item}
                  kind={kind}
                  productName={productName}
                  priority={index === 0}
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
        style={stageBackground ? { backgroundColor: stageBackground } : undefined}
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
            className="group relative block w-full cursor-zoom-in overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2"
          >
            <div className={MEDIA_FRAME_CLASS} style={stageFrameStyle}>
              <GalleryMediaFrame
                item={selectedMedia}
                kind={selectedKind}
                productName={productName}
                isZoomEnabled={isZoomEnabled}
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
            {selectedIsImage && (
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
      {canNavigate && (
        // Capped below lg: in the stacked layout the gallery spans the full page
        // width, and uncapped quarter-width tiles would dwarf the main image.
        <div
          className={cn(
            THUMBNAIL_ROW_CLASS,
            // Left rail at lg: DOM order stays main-then-thumbs (mobile is
            // unchanged); order-first moves the rail before the frame.
            layout === "left" &&
              "lg:order-first lg:mx-0 lg:w-24 lg:shrink-0 lg:flex-col lg:justify-start",
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
                  THUMBNAIL_TILE_WIDTH_CLASS,
                  layout === "left" && "lg:w-full",
                  isSelected
                    ? THUMB_SURFACE_ACTIVE_CLASS
                    : THUMB_SURFACE_IDLE_CLASS,
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                )}
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
          <div className="relative flex h-full flex-col">
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

  return (
    <AppImage
      src={item.url}
      alt={alt}
      fill
      className={cn(
        fullscreen
          ? "object-contain p-6 transition-transform duration-500 ease-out motion-reduce:transition-none sm:p-10"
          : "object-contain p-4 transition-transform duration-500 ease-out motion-reduce:transition-none sm:p-8",
        isZoomEnabled
          ? fullscreen
            ? "scale-[2.2]"
            : "scale-[1.9]"
          : fullscreen
            ? "scale-100"
            : "scale-100 group-hover:scale-[1.025]",
      )}
      style={{ transformOrigin: isCoarsePointer ? "50% 50%" : transformOrigin }}
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
