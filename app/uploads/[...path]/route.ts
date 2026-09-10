/**
 * GET/HEAD /uploads/<key>
 *
 * Serves local-storage uploads from public/uploads/ off the disk. Next only
 * guarantees static serving for public/ files that existed when the server
 * started — files written at runtime (which is every local-storage upload)
 * 404 until a restart. This route is the fallback: when the static handler
 * doesn't know the file, the request reaches us and we stream it.
 *
 * Only covers the default "uploads/" path prefix; a custom prefix relies on
 * Next's static serving (i.e. needs a server restart to pick up new files).
 *
 * Supports single-range requests so video seeking works, and mirrors the
 * security/cache headers used for statically-served uploads
 * (immutable cache — keys embed a timestamp + random suffix — plus a CSP
 * sandbox so scripts inside user-supplied SVGs never run same-origin).
 */

import { createReadStream, promises as fs, type Stats } from "fs";
import path from "path";
import { Readable } from "stream";
import { NextRequest } from "next/server";

const BASE_DIR = path.join(process.cwd(), "public", "uploads");

const MIME_TYPES: Record<string, string> = {
  // Images
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  ico: "image/x-icon",
  // Videos
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "video/ogg",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  // 3D models
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  // Documents
  pdf: "application/pdf",
};

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function baseHeaders(filePath: string, stat: Stats): Headers {
  const headers = new Headers({
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "Accept-Ranges": "bytes",
    "Last-Modified": stat.mtime.toUTCString(),
    ETag: `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`,
  });
  return headers;
}

async function resolveFile(
  params: Promise<{ path: string[] }>,
): Promise<{ filePath: string; stat: Stats } | null> {
  const { path: segments } = await params;
  if (!segments || segments.length === 0) return null;

  // Resolve inside BASE_DIR only — the key comes from the URL, so defend
  // against traversal even though upload keys are generated server-side.
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\") ||
        path.isAbsolute(segment),
    )
  ) {
    return null;
  }

  const filePath = path.join(process.cwd(), "public", "uploads", ...segments);
  const relativePath = path.relative(BASE_DIR, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return { filePath, stat };
  } catch {
    return null;
  }
}

function parseRange(
  rangeHeader: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;

  let start: number;
  let end: number;
  if (match[1] === "") {
    // Suffix range: last N bytes.
    const suffix = parseInt(match[2], 10);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] === "" ? size - 1 : parseInt(match[2], 10);
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const resolved = await resolveFile(ctx.params);
  if (!resolved) return new Response("Not found", { status: 404 });

  const { filePath, stat } = resolved;
  const headers = baseHeaders(filePath, stat);

  const range = parseRange(request.headers.get("range"), stat.size);
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    const stream = createReadStream(filePath, {
      start: range.start,
      end: range.end,
    });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers,
    });
  }

  headers.set("Content-Length", String(stat.size));
  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers,
  });
}

export async function HEAD(
  _request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const resolved = await resolveFile(ctx.params);
  if (!resolved) return new Response(null, { status: 404 });

  const { filePath, stat } = resolved;
  const headers = baseHeaders(filePath, stat);
  headers.set("Content-Length", String(stat.size));
  return new Response(null, { status: 200, headers });
}
