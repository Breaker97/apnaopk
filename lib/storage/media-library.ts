import "server-only";

import { getStorageConfig, getStorageService } from "@/lib/storage";
import type {
  MediaLibraryFile,
  MediaLibraryKind,
  StorageObject,
  StoredStorageProvider,
} from "@/lib/storage/types";

/**
 * The media library: what is in storage, a page at a time — for the admin
 * Media Library and for the pickers that attach a stored file instead of
 * uploading it again.
 *
 * No collection records uploads; the bucket is the record. Everything a file
 * is shown as is read off its key: kind and type from the extension, the name
 * from the last segment.
 */

export const MEDIA_LIBRARY_KINDS = [
  "image",
  "video",
  "model",
  "document",
  "other",
] as const satisfies readonly MediaLibraryKind[];

const TYPE_BY_EXTENSION: Record<
  string,
  { kind: MediaLibraryKind; mimeType: string }
> = {
  jpg: { kind: "image", mimeType: "image/jpeg" },
  jpeg: { kind: "image", mimeType: "image/jpeg" },
  png: { kind: "image", mimeType: "image/png" },
  gif: { kind: "image", mimeType: "image/gif" },
  webp: { kind: "image", mimeType: "image/webp" },
  svg: { kind: "image", mimeType: "image/svg+xml" },
  avif: { kind: "image", mimeType: "image/avif" },
  heic: { kind: "image", mimeType: "image/heic" },
  heif: { kind: "image", mimeType: "image/heif" },
  bmp: { kind: "image", mimeType: "image/bmp" },
  tif: { kind: "image", mimeType: "image/tiff" },
  tiff: { kind: "image", mimeType: "image/tiff" },
  ico: { kind: "image", mimeType: "image/x-icon" },
  mp4: { kind: "video", mimeType: "video/mp4" },
  webm: { kind: "video", mimeType: "video/webm" },
  ogg: { kind: "video", mimeType: "video/ogg" },
  mov: { kind: "video", mimeType: "video/quicktime" },
  avi: { kind: "video", mimeType: "video/x-msvideo" },
  mkv: { kind: "video", mimeType: "video/x-matroska" },
  glb: { kind: "model", mimeType: "model/gltf-binary" },
  gltf: { kind: "model", mimeType: "model/gltf+json" },
  pdf: { kind: "document", mimeType: "application/pdf" },
};

const UNKNOWN_TYPE = {
  kind: "other",
  mimeType: "application/octet-stream",
} as const;

function typeForKey(key: string) {
  const extension = key.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXTENSION[extension] ?? UNKNOWN_TYPE;
}

/** The key's last segment, without the timestamp-random prefix old keys had. */
function displayName(key: string) {
  return (key.split("/").pop() || key).replace(/^\d+-[a-z0-9]+-/, "");
}

/** Max keys scanned per request when a filter is active, to bound latency. */
const MAX_SCANNED_PER_REQUEST = 1000;

interface MediaLibraryPage {
  provider: StoredStorageProvider;
  files: MediaLibraryFile[];
  nextCursor?: string;
}

export async function listMediaLibrary(options: {
  /** One owner's folder; omitted, the whole library. From the session only. */
  ownerScope?: string;
  cursor?: string;
  limit: number;
  /** Only these kinds; omitted or empty, every kind. */
  kinds?: readonly MediaLibraryKind[];
  /** Case-insensitive match against the key. */
  query?: string;
}): Promise<MediaLibraryPage> {
  const { ownerScope, cursor, limit } = options;
  const kinds = options.kinds?.length ? new Set(options.kinds) : null;
  const query = options.query?.trim().toLowerCase() ?? "";

  const config = await getStorageConfig();
  const storage = await getStorageService();

  // Without filters: one provider page. With a kind/search filter, matches can
  // be sparse (e.g. a handful of .glb models deep in a bucket of images), so
  // keep scanning provider pages until enough matches accumulate, the listing
  // ends, or the per-request scan budget runs out — the returned nextCursor
  // lets "Load more" continue the scan.
  let page: { files: StorageObject[]; nextCursor?: string };
  if (!kinds && !query) {
    page = await storage.listFiles({ cursor, limit, ownerScope });
  } else {
    const matches: StorageObject[] = [];
    let currentCursor = cursor;
    let scanned = 0;
    let nextCursor: string | undefined;
    for (;;) {
      const scan = await storage.listFiles({
        cursor: currentCursor,
        limit: 200,
        ownerScope,
      });
      scanned += scan.files.length;
      for (const file of scan.files) {
        if (kinds && !kinds.has(typeForKey(file.key).kind)) continue;
        if (query && !file.key.toLowerCase().includes(query)) continue;
        matches.push(file);
      }
      currentCursor = scan.nextCursor;
      if (!currentCursor) break;
      if (matches.length >= limit || scanned >= MAX_SCANNED_PER_REQUEST) {
        nextCursor = currentCursor;
        break;
      }
    }
    page = { files: matches, nextCursor };
  }

  // R2/S3 without a configured public URL: canonical URLs aren't publicly
  // loadable, so previews get short-lived presigned GET URLs instead. The
  // canonical one still travels as publicUrl — a picker that stored the
  // signed URL would hand the storefront an image that breaks within the hour.
  const needsSignedUrls = config.provider !== "local" && !config.publicUrl;

  const files = await Promise.all(
    page.files.map(async (file): Promise<MediaLibraryFile> => {
      const type = typeForKey(file.key);
      return {
        key: file.key,
        url: needsSignedUrls ? await storage.getDownloadUrl(file.key) : file.url,
        publicUrl: file.url,
        size: file.size,
        lastModified: file.lastModified,
        filename: displayName(file.key),
        kind: type.kind,
        mimeType: type.mimeType,
      };
    }),
  );

  return { provider: config.provider, files, nextCursor: page.nextCursor };
}
