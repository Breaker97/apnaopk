import { NextRequest, NextResponse } from "next/server";
import { getStorageConfig } from "@/lib/storage";
import type { StorageConfig } from "@/lib/storage";
import {
  StoredFileFetchError,
  fetchStoredFile,
} from "@/lib/storage/fetch-stored-file";
import { getEnvRemoteImageDomains } from "@/lib/remote-image-domains";
import { DEMO_ASSET_ORIGINS } from "@/lib/seed-assets";

function normalizeBaseUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function storageBaseUrls(config: StorageConfig) {
  const bases = new Set<string>();
  const publicUrl = normalizeBaseUrl(config.publicUrl);
  if (publicUrl) bases.add(publicUrl);

  if (config.provider === "cloudflare_r2" && config.accountId) {
    const accountBase = normalizeBaseUrl(
      `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}`,
    );
    if (accountBase) bases.add(accountBase);
  }

  if (config.endpoint) {
    const endpointBase = normalizeBaseUrl(
      `${config.endpoint.replace(/\/$/, "")}/${config.bucketName}`,
    );
    if (endpointBase) bases.add(endpointBase);
  }

  if (config.provider === "s3") {
    const region = config.region || "us-east-1";
    const s3VirtualHostBase = normalizeBaseUrl(
      `https://${config.bucketName}.s3.${region}.amazonaws.com`,
    );
    const s3PathBase = normalizeBaseUrl(
      `https://s3.${region}.amazonaws.com/${config.bucketName}`,
    );
    if (s3VirtualHostBase) bases.add(s3VirtualHostBase);
    if (s3PathBase) bases.add(s3PathBase);
  }

  return [...bases];
}

function isAllowedStorageUrl(target: URL, config: StorageConfig) {
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return false;
  }

  const href = target.href;
  if (
    storageBaseUrls(config).some(
      (base) => href === base || href.startsWith(`${base}/`),
    )
  ) {
    return true;
  }

  // The demo catalogue's own bucket, so a seeded store's 3D models preview.
  if (DEMO_ASSET_ORIGINS.includes(target.origin)) return true;

  // Only this store's storage — never "any bucket on a known storage host".
  // Anyone can create a bucket on r2.dev, S3 or CloudFront, and trusting those
  // hosts wholesale made this route serve an attacker's file from the store's
  // own domain. Models kept under a previous provider stop previewing until
  // they are re-uploaded; see docs/UPGRADE.md.
  return getEnvRemoteImageDomains().some(
    (domain) =>
      domain.hostname === target.hostname &&
      `${domain.protocol}:` === target.protocol,
  );
}

/**
 * The Content-Type is decided here, from the extension, never taken from the
 * upstream: a bucket answers with whatever type the uploader chose, and an
 * HTML or SVG file served from this origin would run as the store's own page.
 * Anything that is not a model is refused outright.
 */
const MODEL_CONTENT_TYPES: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".usdz": "model/vnd.usdz+zip",
};

function modelContentType(target: URL): string | null {
  const pathname = target.pathname.toLowerCase();
  const extension = Object.keys(MODEL_CONTENT_TYPES).find((ext) =>
    pathname.endsWith(ext),
  );
  return extension ? MODEL_CONTENT_TYPES[extension] : null;
}

/** Even if a model file were read as a document, it could run nothing. */
const LOCKED_DOWN_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "X-Content-Type-Options": "nosniff",
};

function allowedOrigin() {
  // Restrict to the app's own origin instead of a wildcard. The 3D viewer
  // fetches models from this same-origin proxy, so no third-party origin needs
  // access. Falls back to same-origin only ("null") if the URL is unset.
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "null";
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(),
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
  };
}

function loadFailure(message: string, status: number) {
  return NextResponse.json(
    { success: false, message },
    { status, headers: { ...corsHeaders(), "Cache-Control": "no-store" } },
  );
}

async function proxyModel(request: NextRequest, method: "GET" | "HEAD") {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json(
      { success: false, message: "Model URL is required" },
      { status: 400, headers: corsHeaders() },
    );
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid model URL" },
      { status: 400, headers: corsHeaders() },
    );
  }

  const contentType = modelContentType(target);
  if (!contentType) {
    return NextResponse.json(
      { success: false, message: "Only .glb, .gltf and .usdz models can be previewed" },
      { status: 400, headers: corsHeaders() },
    );
  }

  const config = await getStorageConfig();
  if (!isAllowedStorageUrl(target, config)) {
    return NextResponse.json(
      { success: false, message: "Model URL is not in the configured storage bucket" },
      { status: 403, headers: corsHeaders() },
    );
  }

  const range = request.headers.get("range");
  let upstream: Response;
  try {
    // A redirect is never followed: the allow-list above vouches for this URL
    // only, and following one let a trusted host send the server to any
    // address it can reach — cloud metadata included.
    upstream = await fetchStoredFile(target, {
      method,
      headers: range ? { Range: range } : undefined,
    });
  } catch (error) {
    const redirected =
      error instanceof StoredFileFetchError && error.failure === "redirect";
    return loadFailure(
      redirected ? "Model URL redirects elsewhere" : "Model could not be loaded",
      502,
    );
  }

  if (!upstream.ok) {
    // The upstream's own error page is not passed on: its body and type are
    // the bucket's, not ours.
    await upstream.body?.cancel().catch(() => undefined);
    return loadFailure("Model could not be loaded", upstream.status);
  }

  const headers = new Headers({ ...corsHeaders(), ...LOCKED_DOWN_HEADERS });
  headers.set("Content-Type", contentType);
  headers.set(
    "Cache-Control",
    upstream.headers.get("cache-control") ||
      "public, max-age=31536000, immutable",
  );

  for (const header of [
    "accept-ranges",
    "content-disposition",
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }

  return new NextResponse(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

export async function GET(request: NextRequest) {
  return proxyModel(request, "GET");
}

export async function HEAD(request: NextRequest) {
  return proxyModel(request, "HEAD");
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}
