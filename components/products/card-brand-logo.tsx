"use client";

import { AppImage } from "@/components/ui/app-image";

/**
 * The Brand element as a logo: the uploaded image at the configured height,
 * never wider than the card. Past the point where a wide wordmark spans the
 * card it stops growing, so the storefront card and the admin preview share
 * this component and show the same limit.
 */
export function CardBrandLogo({
  src,
  name,
  height,
}: {
  src: string;
  name: string;
  height: number;
}) {
  return (
    <span className="block px-0.5" style={{ height }}>
      <AppImage
        src={src}
        alt={name}
        width={Math.round(height * 6)}
        height={height}
        className="h-full w-auto max-w-full object-contain object-left"
      />
    </span>
  );
}
