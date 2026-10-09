"use client";

import type { KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import {
  GalleryMediaFrame,
  GalleryThumbnail,
  MEDIA_SURFACE_CLASS,
  THUMB_SURFACE_ACTIVE_CLASS,
  THUMB_SURFACE_IDLE_CLASS,
  getMediaKind,
  mediaLabel,
  type GalleryMedia,
} from "./product-gallery-media";

/**
 * The product gallery's fullscreen viewer. Its own module so the dialog — and
 * the dialog primitive under it — stay out of the product page's first load:
 * the gallery preloads it once the page is idle and mounts it on first open.
 * The picture in view and the zoom are the gallery's; this only draws them.
 */
export function ProductGalleryViewer({
  open,
  onOpenChange,
  media,
  selectedIndex,
  productName,
  zoomed,
  isCoarsePointer,
  transformOrigin,
  onKeyDown,
  onPrevious,
  onNext,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  media: GalleryMedia[];
  selectedIndex: number;
  productName: string;
  /** The gallery's zoom is on and the item in view is an image. */
  zoomed: boolean;
  isCoarsePointer: boolean;
  transformOrigin: string;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onPrevious: () => void;
  onNext: () => void;
  /** A thumbnail in the viewer's strip was chosen. */
  onPick: (index: number) => void;
}) {
  const tf = useFallbackTranslator(useTranslations());
  const selectedMedia = media[selectedIndex];
  if (!selectedMedia) return null;
  const canNavigate = media.length > 1;
  const selectedKind = getMediaKind(selectedMedia);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="aspect-square h-auto max-h-[90vh] w-[90vw] max-w-[90vh] gap-0 overflow-hidden rounded-lg border-border/60 bg-background p-0 sm:max-w-3xl"
        onKeyDown={onKeyDown}
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
          onClick={() => onOpenChange(false)}
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
              isZoomEnabled={zoomed}
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
                  onClick={onPrevious}
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
                  onClick={onNext}
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
                    onClick={() => onPick(index)}
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
  );
}
