"use client";

import { isTrustedRemoteUrl } from "@/lib/remote-image-domains";
import Image, { type ImageProps } from "next/image";
import { useState, type ReactNode } from "react";

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

  // Absolute URLs on hosts outside next.config's remotePatterns — e.g. media
  // uploaded while a different storage provider or custom CDN domain was
  // active — would make next/image throw at render and hide the image. Serve
  // those unoptimized straight from their origin so existing media keeps
  // rendering after a storage-provider switch.
  const isUntrustedRemote =
    /^https?:\/\//i.test(normalizedSrc) && !isTrustedRemoteUrl(normalizedSrc);

  // SVG is vector, and the optimizer refuses it outright unless
  // `dangerouslyAllowSVG` is on (which would let an uploaded file run script
  // on the store's own origin). Left to next/image an uploaded SVG logo
  // answers 400 and disappears behind the fallback; served as-is it stays
  // sharp at every size, which is the reason to upload one.
  const isVector = /\.svgz?(?:[?#]|$)/i.test(normalizedSrc);

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
      unoptimized={
        normalizedSrc.startsWith("data:") ||
        normalizedSrc.startsWith("blob:") ||
        isVector ||
        isUntrustedRemote ||
        props.unoptimized
      }
    />
  );
}
