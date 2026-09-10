/**
 * GET /api/admin/media
 * Paginated listing of everything in the active storage (local disk or
 * R2/S3 bucket) for the admin Media Library. Deletion goes through
 * DELETE /api/upload, uploads through POST /api/upload.
 */

import { getStorageConfig, getStorageService } from "@/lib/storage";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";

export type MediaKind = "image" | "video" | "model" | "document" | "other";

const KIND_BY_EXTENSION: Record<string, MediaKind> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  avif: "image",
  heic: "image",
  heif: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  ico: "image",
  mp4: "video",
  webm: "video",
  ogg: "video",
  mov: "video",
  avi: "video",
  mkv: "video",
  glb: "model",
  gltf: "model",
  pdf: "document",
};

function kindForKey(key: string): MediaKind {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return KIND_BY_EXTENSION[ext] ?? "other";
}

const VALID_KINDS: MediaKind[] = [
  "image",
  "video",
  "model",
  "document",
  "other",
];

/** Max keys scanned per request when a filter is active, to bound latency. */
const MAX_SCANNED_PER_REQUEST = 1000;

export const GET = withApi({ auth: "admin" }, async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor") || undefined;
  const limitParam = parseInt(searchParams.get("limit") || "50", 10);
  const limit = Math.min(Math.max(limitParam || 50, 1), 200);
  const kindParam = searchParams.get("kind");
  const kind = VALID_KINDS.includes(kindParam as MediaKind)
    ? (kindParam as MediaKind)
    : undefined;
  const query = (searchParams.get("q") || "").trim().toLowerCase();

  const config = await getStorageConfig();
  const storage = await getStorageService();

  // Without filters: one provider page. With a kind/search filter, matches can
  // be sparse (e.g. a handful of .glb models deep in a bucket of images), so
  // keep scanning provider pages until enough matches accumulate, the listing
  // ends, or the per-request scan budget runs out — the returned nextCursor
  // lets "Load more" continue the scan.
  let result: { files: Awaited<ReturnType<typeof storage.listFiles>>["files"]; nextCursor?: string };
  if (!kind && !query) {
    result = await storage.listFiles({ cursor, limit });
  } else {
    const matches: Awaited<ReturnType<typeof storage.listFiles>>["files"] = [];
    let currentCursor = cursor;
    let scanned = 0;
    let nextCursor: string | undefined;
    for (;;) {
      const page = await storage.listFiles({
        cursor: currentCursor,
        limit: 200,
      });
      scanned += page.files.length;
      for (const file of page.files) {
        if (kind && kindForKey(file.key) !== kind) continue;
        if (query && !file.key.toLowerCase().includes(query)) continue;
        matches.push(file);
      }
      currentCursor = page.nextCursor;
      if (!currentCursor) break;
      if (matches.length >= limit || scanned >= MAX_SCANNED_PER_REQUEST) {
        nextCursor = currentCursor;
        break;
      }
    }
    result = { files: matches, nextCursor };
  }

  // R2/S3 without a configured public URL: canonical URLs aren't publicly
  // loadable, so hand the library short-lived presigned GET URLs instead.
  const needsSignedUrls = config.provider !== "local" && !config.publicUrl;

  const files = await Promise.all(
    result.files.map(async (file) => ({
      ...file,
      url: needsSignedUrls
        ? await storage.getDownloadUrl(file.key)
        : file.url,
      // Filename without the generated timestamp-random prefix, for display.
      filename: (file.key.split("/").pop() || file.key).replace(
        /^\d+-[a-z0-9]+-/,
        "",
      ),
      kind: kindForKey(file.key),
    })),
  );

  return successResponse({
    provider: config.provider,
    files,
    nextCursor: result.nextCursor,
  });
});
