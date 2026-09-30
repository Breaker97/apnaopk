"use client";

import dynamic from "next/dynamic";
import { Box, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppImage } from "@/components/ui/app-image";
import { ModelViewer } from "@/components/ui/model-viewer";

/*
 * One media item in its frame, and its thumbnail: what the product gallery
 * (product-image-gallery.tsx) and its fullscreen viewer
 * (product-gallery-viewer.tsx) both draw.
 */

// Few products carry a YouTube or Vimeo item, so its player — and the URL
// rules behind it — arrive with the first one rather than with every page.
const ExternalVideoPlayer = dynamic(
  () =>
    import("@/components/products/external-video-player").then(
      (module) => module.ExternalVideoPlayer,
    ),
  { loading: () => <span className="block h-full w-full bg-muted" /> },
);

export type MediaKind = "image" | "video" | "model" | "external_video";

/** Neutral backdrop shared by every media surface (main frame, thumbs, viewer). */
export const MEDIA_SURFACE_CLASS = "bg-[#f0f0f0] dark:bg-muted";

/**
 * Thumbnail selection is carried by the tile surface, not a border or ring.
 * Opacity alone was unreliable: a bright inactive photo out-shone a dark active
 * one, and greying inactive tiles was off the table because the thumbnails here
 * encode colour variants. The surface step is independent of photo content, so
 * it holds up in both themes.
 */
export const THUMB_SURFACE_ACTIVE_CLASS = "bg-[#e2e2e2] dark:bg-white/14";
export const THUMB_SURFACE_IDLE_CLASS = "bg-[#f4f4f4] dark:bg-white/5";


export type GalleryMedia = {
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

export function getMediaKind(item: GalleryMedia): MediaKind {
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

export function thumbnailLabel(tf: Translate, kind: MediaKind, index: number) {
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

export function mediaLabel(tf: Translate, kind: MediaKind) {
  if (kind === "model") return tf("product.gallery.model", "3D model");
  if (kind === "video" || kind === "external_video")
    return tf("product.gallery.video", "video");
  return tf("product.gallery.image", "image");
}

export function GalleryMediaFrame({
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

export function GalleryThumbnail({
  item,
  kind,
  productName,
  size,
  fit = "contain",
}: {
  item: GalleryMedia;
  kind: MediaKind;
  productName: string;
  size: "sm" | "md";
  /** "cover" fills the tile edge to edge; "contain" floats the shot in it. */
  fit?: "contain" | "cover";
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
      className={
        fit === "cover"
          ? "object-cover"
          : size === "sm"
            ? "object-contain p-2"
            : "object-contain p-1.5"
      }
      loading="lazy"
      sizes={size === "sm" ? "(max-width: 768px) 25vw, 170px" : "64px"}
    />
  );
}
