"use client";

import { cn } from "@/lib/utils";
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
  const [isLoading, setIsLoading] = useState(true);

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

  const handleLoad = () => {
    setIsLoading(false);
  };

  // Absolute URLs on hosts outside next.config's remotePatterns — e.g. media
  // uploaded while a different storage provider or custom CDN domain was
  // active — would make next/image throw at render and hide the image. Serve
  // those unoptimized straight from their origin so existing media keeps
  // rendering after a storage-provider switch.
  const isUntrustedRemote =
    /^https?:\/\//i.test(normalizedSrc) && !isTrustedRemoteUrl(normalizedSrc);

  // Use Next.js Image for optimization wherever the optimizer can load the
  // source: local relative URLs and whitelisted remote hosts get automatic
  // WebP/AVIF conversion, responsive srcset, lazy loading and caching.
  return (
    <Image
      src={normalizedSrc}
      alt={alt}
      className={cn(
        isLoading && "opacity-0",
        !fill && "transition-opacity duration-300",
        className,
      )}
      fill={fill}
      {...props}
      onError={handleError}
      onLoad={handleLoad}
      unoptimized={
        normalizedSrc.startsWith("data:") ||
        normalizedSrc.startsWith("blob:") ||
        isUntrustedRemote ||
        props.unoptimized
      }
    />
  );
}
