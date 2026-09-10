/**
 * Remote Image Domains Configuration
 * Manages allowed domains for Next.js Image optimization
 */

import type { RemotePattern } from "next/dist/shared/lib/image-config";

interface RemoteImageDomain {
  protocol: "https" | "http";
  hostname: string;
  pathname?: string;
  label: string;
  enabled?: boolean;
}

/**
 * Default remote image domains configured in next.config.ts
 * These are used by Next.js Image component for optimization
 *
 * Every host here is a fixed pattern a provider is guaranteed to serve from.
 * MinIO and custom CDN domains cannot be listed — the hostname is whatever the
 * store chose — so they come from `STORAGE_ENDPOINT` / `STORAGE_PUBLIC_URL` via
 * `getEnvRemoteImageDomains` at build time, or fall back to unoptimized
 * rendering in AppImage.
 */
const DEFAULT_REMOTE_IMAGE_DOMAINS: RemoteImageDomain[] = [
  {
    protocol: "https",
    hostname: "**.r2.dev",
    pathname: "/**",
    label: "Cloudflare R2",
  },
  {
    protocol: "https",
    hostname: "**.r2.cloudflarestorage.com",
    pathname: "/**",
    label: "Cloudflare R2 (Legacy)",
  },
  {
    protocol: "https",
    hostname: "s3.amazonaws.com",
    pathname: "/**",
    label: "AWS S3",
  },
  {
    protocol: "https",
    hostname: "s3.*.amazonaws.com",
    pathname: "/**",
    label: "AWS S3 Regional",
  },
  {
    protocol: "https",
    hostname: "**.s3.amazonaws.com",
    pathname: "/**",
    label: "AWS S3 (Wildcard)",
  },
  {
    protocol: "https",
    hostname: "**.s3.*.amazonaws.com",
    pathname: "/**",
    label: "AWS S3 Regional (Wildcard)",
  },
  {
    protocol: "https",
    hostname: "**.cloudfront.net",
    pathname: "/**",
    label: "Amazon CloudFront (S3 CDN)",
  },
  // Covers every Spaces shape in one pattern: the datacenter host the provider
  // builds path-style URLs on (nyc3.digitaloceanspaces.com), the virtual-hosted
  // form (bucket.nyc3.…) and the CDN edge (bucket.nyc3.cdn.…). Without it every
  // image on a Spaces store rendered unoptimized — AppImage falls back rather
  // than letting next/image throw on an unlisted host.
  {
    protocol: "https",
    hostname: "**.digitaloceanspaces.com",
    pathname: "/**",
    label: "DigitalOcean Spaces (+ CDN)",
  },
  {
    protocol: "https",
    hostname: "picsum.photos",
    pathname: "/**",
    label: "Picsum Photos (Seed Images)",
  },
  // External product video (YouTube/Vimeo) thumbnails.
  {
    protocol: "https",
    hostname: "i.ytimg.com",
    pathname: "/vi/**",
    label: "YouTube Thumbnails",
  },
  {
    protocol: "https",
    hostname: "i.vimeocdn.com",
    pathname: "/**",
    label: "Vimeo Thumbnails",
  },
];

/**
 * Extra image domains derived from storage env vars, so a self-hosted install
 * with a custom CDN domain or S3-compatible endpoint (set via
 * STORAGE_PUBLIC_URL / CLOUDFLARE_R2_PUBLIC_URL / STORAGE_ENDPOINT) gets that
 * host whitelisted for next/image optimization at build/startup.
 *
 * Server-side only (next.config.ts) — the client can't read these env vars,
 * so AppImage renders such hosts unoptimized via its fallback. A publicUrl
 * configured only in the admin Settings DB can't be known at build time
 * either; those hosts also rely on the AppImage fallback.
 */
let envDomainsCache: RemoteImageDomain[] | null = null;

export function getEnvRemoteImageDomains(): RemoteImageDomain[] {
  // Env vars are fixed for the process lifetime — compute once. (Tests that
  // mutate process.env bypass the cache via clearEnvRemoteImageDomainsCache.)
  if (envDomainsCache) return envDomainsCache;
  const candidates = [
    { value: process.env.STORAGE_PUBLIC_URL, label: "Storage public URL (env)" },
    {
      value: process.env.CLOUDFLARE_R2_PUBLIC_URL,
      label: "R2 public URL (env)",
    },
    { value: process.env.STORAGE_ENDPOINT, label: "Storage endpoint (env)" },
  ];

  const domains: RemoteImageDomain[] = [];
  for (const { value, label } of candidates) {
    if (!value || !value.trim()) continue;
    try {
      const url = new URL(value.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      const protocol = url.protocol === "https:" ? "https" : "http";
      if (
        domains.some(
          (d) => d.hostname === url.hostname && d.protocol === protocol,
        )
      ) {
        continue;
      }
      domains.push({
        protocol,
        hostname: url.hostname,
        pathname: "/**",
        label,
      });
    } catch {
      // Malformed env value — ignore rather than break config loading.
    }
  }
  envDomainsCache = domains;
  return domains;
}

/** Test hook: reset the env-domain cache after mutating process.env. */
export function clearEnvRemoteImageDomainsCache() {
  envDomainsCache = null;
}

/**
 * Convert RemoteImageDomain to Next.js RemotePattern format
 */
function toRemotePattern(domain: RemoteImageDomain): RemotePattern {
  return {
    protocol: domain.protocol,
    hostname: domain.hostname,
    pathname: domain.pathname,
  };
}

/**
 * Get all enabled remote patterns for next.config.ts
 */
export function getRemotePatterns(
  additionalDomains?: RemoteImageDomain[],
): RemotePattern[] {
  const allDomains = [
    ...DEFAULT_REMOTE_IMAGE_DOMAINS.filter((d) => d.enabled !== false),
    ...(additionalDomains || []),
  ];

  return allDomains.filter((d) => d.enabled !== false).map(toRemotePattern);
}

/**
 * Match a hostname against a remote-pattern hostname: "**" spans any number
 * of labels, "*" exactly one (mirrors Next.js remotePatterns semantics, which
 * the old endsWith/equality check got wrong for patterns like
 * "s3.*.amazonaws.com").
 */
const patternRegexCache = new Map<string, RegExp>();

function hostnameMatchesPattern(pattern: string, hostname: string): boolean {
  // Compiled once per pattern — this runs per <AppImage> render, so per-call
  // RegExp construction would burn CPU on image-heavy grids.
  let regex = patternRegexCache.get(pattern);
  if (!regex) {
    regex = new RegExp(
      "^" +
        pattern
          .split(".")
          .map((part) =>
            part === "**"
              ? "(?:[^.]+\\.)*[^.]+"
              : part === "*"
                ? "[^.]+"
                : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          )
          .join("\\.") +
        "$",
      "i",
    );
    patternRegexCache.set(pattern, regex);
  }
  return regex.test(hostname);
}

/**
 * Check if a URL's host is covered by the remote patterns next/image is
 * configured with (next.config.ts builds its list from this module). AppImage
 * uses this to decide whether the Next optimizer may load a remote URL —
 * unknown hosts (e.g. media uploaded under a previous storage provider's
 * custom domain) are rendered unoptimized instead of crashing the render.
 */
export function isTrustedRemoteUrl(url: string): boolean {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return false;
  }

  try {
    const hostname = new URL(url).hostname;
    return DEFAULT_REMOTE_IMAGE_DOMAINS.some(
      (domain) =>
        domain.enabled !== false &&
        hostnameMatchesPattern(domain.hostname, hostname),
    );
  } catch {
    return false;
  }
}
