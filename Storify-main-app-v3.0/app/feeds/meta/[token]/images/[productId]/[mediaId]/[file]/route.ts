import sharp from "sharp";
import { PRODUCT_STATUS } from "@/config/app.config";
import { isStorefrontVendor } from "@/lib/catalog/product-visibility";
import { connectDB, mongoose } from "@/lib/db";
import {
  META_FEED_TOKEN_PATTERN,
  metaFeedTokenMatches,
  readMetaCatalogFeed,
} from "@/lib/meta-catalog/feed-state";
import { metaImageHash, metaRenditionSource } from "@/lib/meta-catalog/images";
import { fetchStoredFile, readCappedBody } from "@/lib/storage/fetch-stored-file";
import { Product } from "@/models";

/**
 * A product picture as a JPEG, for the Meta feed: Meta reads JPEG and PNG
 * only, and many stored pictures are WebP. The feed links here only for a
 * picture it cannot hand Meta as it is (lib/meta-catalog/images.ts).
 *
 * Narrow on purpose, since converting is CPU work anyone could ask for: the
 * feed's token, a product the storefront shows, one of that product's own
 * pictures, stored where `metaRenditionSource` trusts, and the hash of its
 * current URL. The
 * hash also makes the answer safe to cache forever — a replaced picture gets
 * a new URL in the next feed.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Longest edge Meta is sent: well inside its 8 MB cap as a JPEG. */
const MAX_EDGE = 2048;
/** A stored picture far past this is not a product photo. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/**
 * Conversions at once, and how many may queue behind them. Meta fetches a new
 * catalogue's pictures in a burst; past the queue it is told to come back,
 * which it does, rather than the server converting hundreds side by side.
 */
const MAX_ACTIVE = 2;
const MAX_WAITING = 32;
let active = 0;
const waiting: Array<() => void> = [];

async function withConversionSlot<T>(work: () => Promise<T>): Promise<T | null> {
  if (active >= MAX_ACTIVE) {
    if (waiting.length >= MAX_WAITING) return null;
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    active += 1;
  }
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    // The slot passes straight to the next in line, so `active` only drops
    // once nobody is waiting.
    if (next) next();
    else active -= 1;
  }
}

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

function notFound() {
  return new Response(null, { status: 404, headers: HEADERS });
}

type Params = { token: string; productId: string; mediaId: string; file: string };

/** A path segment as written into the feed (`encodeURIComponent`), decoded once. */
function decodedSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<Params> }) {
  const { token, productId, mediaId, file } = await params;
  const hash = /^([0-9a-f]{16})\.jpg$/.exec(file)?.[1];
  if (
    !hash ||
    !META_FEED_TOKEN_PATTERN.test(token) ||
    !mongoose.isValidObjectId(productId) ||
    !mediaId
  ) {
    return notFound();
  }

  const feed = await readMetaCatalogFeed();
  if (!feed.enabled || !metaFeedTokenMatches(feed.token, token)) return notFound();

  await connectDB();
  const product = await Product.findOne({
    _id: productId,
    status: PRODUCT_STATUS.ACTIVE,
    priceOnRequest: { $ne: true },
    "publishing.onlineStore": { $ne: false },
  })
    .select("vendorId media._id media.type media.url")
    .lean<{
      vendorId?: unknown;
      media?: Array<{ _id?: string; type?: string; url?: string }>;
    }>();
  const wanted = decodedSegment(mediaId);
  const picture = product?.media?.find(
    (entry) => entry._id === wanted && (entry.type ?? "image") === "image",
  );
  if (!product || !picture?.url || metaImageHash(picture.url) !== hash) return notFound();
  if (!(await isStorefrontVendor(product.vendorId))) return notFound();

  const source = await metaRenditionSource(picture.url);
  if (!source) return notFound();

  const jpeg = await withConversionSlot(async () => {
    try {
      const response = await fetchStoredFile(source, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return undefined;
      }
      const input = await readCappedBody(response, MAX_SOURCE_BYTES);
      return await sharp(input, { failOn: "error" })
        .rotate()
        .resize({
          width: MAX_EDGE,
          height: MAX_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        // JPEG has no transparency; a cut-out product sits on white.
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
    } catch {
      return undefined;
    }
  });

  if (jpeg === null) {
    return new Response(null, {
      status: 503,
      headers: { ...HEADERS, "Retry-After": "30" },
    });
  }
  if (!jpeg) return notFound();

  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(jpeg.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
