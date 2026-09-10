import { NextRequest, NextResponse } from "next/server";
import { getStorageConfig } from "@/lib/storage";
import type { StorageConfig } from "@/lib/storage";
import {
  getEnvRemoteImageDomains,
  isTrustedRemoteUrl,
} from "@/lib/remote-image-domains";

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

  // Cross-provider continuity: models uploaded under a previous storage
  // provider keep their absolute URLs (e.g. pub-*.r2.dev) after the admin
  // switches providers, so the active config's base URLs no longer cover
  // them. Known storage/CDN hosts — the same trust class next/image proxies
  // via remotePatterns — stay allowed, as do env-configured custom domains.
  if (isTrustedRemoteUrl(href)) return true;

  return getEnvRemoteImageDomains().some(
    (domain) =>
      domain.hostname === target.hostname &&
      `${domain.protocol}:` === target.protocol,
  );
}

function inferModelContentType(target: URL) {
  const pathname = target.pathname.toLowerCase();
  if (pathname.endsWith(".gltf")) return "model/gltf+json";
  return "model/gltf-binary";
}

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

  const config = await getStorageConfig();
  if (!isAllowedStorageUrl(target, config)) {
    return NextResponse.json(
      { success: false, message: "Model URL is not in the configured storage bucket" },
      { status: 403, headers: corsHeaders() },
    );
  }

  const range = request.headers.get("range");
  const upstream = await fetch(target, {
    method,
    headers: range ? { Range: range } : undefined,
  });

  if (!upstream.ok) {
    return new NextResponse(method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: {
        ...corsHeaders(),
        "Cache-Control": "no-store",
      },
    });
  }

  const upstreamType = upstream.headers.get("content-type");
  const contentType =
    upstreamType && upstreamType !== "application/octet-stream"
      ? upstreamType
      : inferModelContentType(target);

  const headers = new Headers(corsHeaders());
  headers.set("Content-Type", contentType);
  headers.set("X-Content-Type-Options", "nosniff");
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
