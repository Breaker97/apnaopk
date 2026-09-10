/**
 * GET /api/ai-authoring/download?url=...&name=...
 * Streams an image from this store's own storage back with a
 * Content-Disposition attachment header so the browser downloads it directly
 * instead of opening it in a new tab. The URL is SSRF-guarded to the store's
 * storage origin, and a session is required to avoid an open proxy.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { assertOwnStorageUrl } from "@/lib/ai-authoring/media";

function safeName(name: string | null): string {
  const base = (name || "image")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "image";
}

function extensionForContentType(contentType: string): string {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("png")) return "png";
  return "img";
}

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json(
      { success: false, message: "url is required" },
      { status: 400 },
    );
  }

  let url: URL;
  try {
    url = await assertOwnStorageUrl(rawUrl);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "Invalid image URL",
      },
      { status: 400 },
    );
  }

  const upstream = await fetch(url.toString());
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { success: false, message: "Could not fetch the image" },
      { status: 502 },
    );
  }

  const contentType =
    upstream.headers.get("content-type") || "application/octet-stream";
  let filename = safeName(searchParams.get("name"));
  if (!/\.[a-z0-9]{2,4}$/i.test(filename)) {
    filename += `.${extensionForContentType(contentType)}`;
  }

  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", contentType);
  responseHeaders.set(
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) responseHeaders.set("Content-Length", contentLength);
  responseHeaders.set("Cache-Control", "private, no-store");

  return new Response(upstream.body, { status: 200, headers: responseHeaders });
}
