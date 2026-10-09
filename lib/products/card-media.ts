import type {
  ModernProduct,
  ProductMedia,
  ProductMediaKind,
} from "@/lib/products/modern-product";

/**
 * Which pictures a product card draws: the primary shot, and the one its
 * "Second image" hover effect swaps in. The card picks through here, and so
 * does the payload trimmer that ships cards to the browser
 * (storefront-product-cards.ts), so a trimmed card still carries exactly the
 * shots the card will choose.
 */

type CardMediaProduct = Pick<ModernProduct, "name" | "images" | "media">;

function inferMediaType(media: {
  type?: ProductMediaKind;
  url: string;
  mimeType?: string;
}): ProductMediaKind {
  if (media.type) return media.type;
  const mimeType = media.mimeType?.toLowerCase() || "";
  const url = media.url.toLowerCase();

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

/** What a card shows of an entry: an external video only has its thumbnail. */
function cardSrc(media: ProductMedia): string | undefined {
  return media.type === "external_video" ? media.thumbnailUrl : media.url;
}

/**
 * The card's two shots, in the merchant's gallery order: the first entry a
 * card can draw, and the next picture after it. The hover shot is a still
 * image, so videos, 3D models and external videos are passed over, and so is
 * a repeat of the primary's own picture. A video or 3D model primary gets no
 * hover shot at all: the card plays or spins it, and a swap would hide it.
 */
export function pickCardMedia(media: readonly ProductMedia[]): {
  primary?: ProductMedia;
  second?: ProductMedia;
} {
  const ordered = [...media].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  const index = ordered.findIndex((item) => Boolean(cardSrc(item)));
  if (index < 0) return {};

  const primary = ordered[index];
  const primaryType = inferMediaType(primary);
  if (primaryType === "video" || primaryType === "model") return { primary };

  const primarySrc = cardSrc(primary);
  const second = ordered
    .slice(index + 1)
    .find(
      (item) =>
        Boolean(item.url) &&
        item.url !== primarySrc &&
        inferMediaType(item) === "image",
    );
  return second ? { primary, second } : { primary };
}

function galleryOf(product: CardMediaProduct): ProductMedia[] {
  return Array.isArray(product.media) ? product.media : [];
}

export function getPrimaryProductMedia(
  product: CardMediaProduct,
): ProductMedia | null {
  const { primary } = pickCardMedia(galleryOf(product));
  if (primary) {
    return {
      ...primary,
      type: inferMediaType(primary),
      alt: primary.alt || product.name,
    };
  }

  const image = product.images?.find(Boolean);
  return image
    ? {
        _id: "primary-image",
        type: "image",
        url: image,
        alt: product.name,
      }
    : null;
}

/**
 * The picture the "Second image" hover swaps in, taken from the list the
 * primary came from: the gallery when the product has one, else the legacy
 * `images` (a product saved before media existed, or a surface that ships
 * images only, like the wishlist). Null when there is nothing to swap to.
 */
export function getSecondProductImage(product: CardMediaProduct): string | null {
  const { primary, second } = pickCardMedia(galleryOf(product));
  if (primary) return second?.url ?? null;

  const images = (product.images ?? []).filter(Boolean);
  return images.find((url) => url !== images[0]) ?? null;
}
