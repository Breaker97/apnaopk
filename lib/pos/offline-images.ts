"use client";

import { getImageProps } from "next/image";
import { isAppImageUnoptimized } from "@/components/ui/app-image";
import type { POSProduct } from "@/components/pos/pos-types";

/**
 * Warm the register's picture cache (public/sw.js, `POS_IMAGE_CACHE`) with the
 * catalogue's tile images, so a till that loses its connection still shows
 * them — a grid of grey boxes is a till where the cashier has to read every
 * name to find the coffee.
 *
 * Each picture is requested exactly as its tile asks for it: the same width
 * (`POS_TILE_IMAGE_SIZE`, which the terminal's tiles use), through the same
 * optimizer rule (`isAppImageUnoptimized`) and the same srcset, so the browser
 * picks the same candidate for this screen and the service worker stores the
 * very URL the tile will request. Requests made from the register page carry
 * it as their referrer, which is how the worker knows to keep them.
 *
 * A few at a time, at most `limit`, and not at all on a data saver.
 */
export const POS_TILE_IMAGE_SIZE = 240;
const CONCURRENCY = 4;

function loadOne(src: string, srcSet?: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve();
    image.onerror = () => resolve();
    if (srcSet) image.srcset = srcSet;
    image.src = src;
  });
}

export async function warmPOSImages(products: POSProduct[], limit = 400): Promise<number> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
    return 0;
  }
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return 0;

  const sources = [
    ...new Set(
      products
        .map((product) => String(product.images?.[0] || "").trim())
        .filter(Boolean),
    ),
  ].slice(0, limit);

  const queue = sources.map((src) => {
    const { props } = getImageProps({
      src,
      alt: "",
      width: POS_TILE_IMAGE_SIZE,
      height: POS_TILE_IMAGE_SIZE,
      unoptimized: isAppImageUnoptimized(src),
    });
    return { src: String(props.src), srcSet: props.srcSet };
  });

  let index = 0;
  const worker = async () => {
    while (index < queue.length) {
      const next = queue[index++]!;
      await loadOne(next.src, next.srcSet);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return queue.length;
}
