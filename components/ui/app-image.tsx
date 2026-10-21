"use client";

import { isTrustedRemoteUrl } from "@/lib/remote-image-domains";
import Image, { type ImageProps } from "next/image";
import { useState, type ReactNode } from "react";

/**
 * Whether `src` is served as-is rather than through the image optimizer —
 * the one rule, shared with whatever has to predict the URL an image will be
 * fetched from (the till's offline image warm-up, lib/pos/offline-images.ts).
 *
 * Absolute URLs on hosts outside next.config's remotePatterns — e.g. media
 * uploaded while a different storage provider or custom CDN domain was
 * active — would make next/image throw at render and hide the image, so they
 * are served unoptimized straight from their origin. SVG is vector, and the
 * optimizer refuses it outright unless `dangerouslyAllowSVG` is on (which
 * would let an uploaded file run script on the store's own origin).
 */
export function isAppImageUnoptimized(src: string): boolean {
  const normalizedSrc = src.trim();
  const isUntrustedRemote =
    /^https?:\/\//i.test(normalizedSrc) && !isTrustedRemoteUrl(normalizedSrc);
  const isVector = /\.svgz?(?:[?#]|$)/i.test(normalizedSrc);
  return (
    normalizedSrc.startsWith("data:") ||
    normalizedSrc.startsWith("blob:") ||
    isVector ||
    isUntrustedRemote
  );
}

type AppImageProps = Omit<ImageProps, "src" | "alt" | "onError"> & {
  src?: string | null;
  alt: string;
  fallback?: ReactNode;
  onImageError?: () => void;
};

export function AppImage({
  src,
  alt,
  className,
  fill,
  fallback,
  onImageError,
  ...props
}: AppImageProps) {
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return <>{fallback ?? null}</>;
  }

  const normalizedSrc = src.trim();
  if (!normalizedSrc) {
    return <>{fallback ?? null}</>;
  }

  const handleError = () => {
    setErrored(true);
    onImageError?.();
  };

  // Use Next.js Image for optimization wherever the optimizer can load the
  // source: local relative URLs and whitelisted remote hosts get automatic
  // WebP/AVIF conversion, responsive srcset, lazy loading and caching.
  //
  // No fade-in on load. The image used to start at opacity 0 and wait for
  // React's onLoad — which only runs after hydration, so on a slow phone every
  // server-rendered image (the hero, the logo, the first product cards) stayed
  // invisible until the page's JavaScript had downloaded and run, and the
  // browser's Largest Contentful Paint waited with it.
  return (
    <Image
      src={normalizedSrc}
      alt={alt}
      className={className}
      fill={fill}
      {...props}
      onError={handleError}
      unoptimized={isAppImageUnoptimized(normalizedSrc) || props.unoptimized}
    />
  );
}
