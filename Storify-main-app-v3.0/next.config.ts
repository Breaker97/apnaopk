import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import {
  APP_PAGE_HEADER_SOURCE,
  PAGE_CACHE_CONTROL,
} from "./lib/http-cache-policy";
import {
  getEnvRemoteImageDomains,
  getRemotePatterns,
  imageOriginsForBundle,
} from "./lib/remote-image-domains";

const withNextIntl = createNextIntlPlugin({
  requestConfig: "./lib/i18n/request.ts",
  experimental: {
    // The locale files are compiled at build time: every message becomes a
    // small structure the browser formats without ICU's parser, which was
    // ~23 KB of every page's JavaScript, and no message is parsed at runtime.
    // Every message must therefore be valid ICU — a literal `{`, `}` or `<`
    // is quoted, as in '{{1}}' — or the build fails
    // (tests/i18n-messages-icu.test.ts says which). And `t.raw()` returns
    // the compiled form, not the text: use messageTemplate
    // (lib/i18n/message-template.ts) for a template another component fills.
    messages: {
      path: "./locales",
      format: "json",
      locales: "infer",
      precompile: true,
    },
  },
});

/**
 * Sent with every response.
 *
 * - Framing: only this origin may frame the store. The admin, account pages
 *   and checkout could be framed by any site, which could then lay invisible
 *   buttons over them (clickjacking). The theme editor and page builder frame
 *   same-origin pages, which both rules allow; the maps and videos the store
 *   itself frames are not affected.
 * - `nosniff`: a response is only ever used as the type it was sent as.
 * - Referrer: a cross-site request carries the origin, never the path — order,
 *   payment and unsubscribe links carry tokens in theirs.
 * - HSTS in production only: browsers ignore it over plain HTTP, and on an
 *   https://localhost dev server it would pin localhost to HTTPS for a year.
 *   No `includeSubDomains`: the buyer's other subdomains are not ours to bind.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
    : []),
];

/**
 * A size set in megabytes in the environment, in bytes. Unset, empty,
 * negative or not a number, `fallback`.
 */
function envMegabytes(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const mb = raw ? Number(raw) : Number.NaN;
  return Math.round((Number.isFinite(mb) && mb >= 0 ? mb : fallback) * 1024 * 1024);
}

const nextConfig: NextConfig = {
  // Pages rendered on demand and `unstable_cache` data are kept in memory,
  // never written to disk — Next's own cache kept every URL it rendered in
  // `.next` for good, so a crawl could fill the disk. See cache-handler.cjs.
  // Resolved from the working directory, which is the project for `next
  // build` and `next start` (and /app in the image).
  cacheHandler: path.join(process.cwd(), "cache-handler.cjs"),
  // Memory for those pages and data: PAGE_CACHE_MEMORY_MB, unset 50 (Next's
  // own default). 0 caches nothing.
  cacheMaxMemorySize: envMegabytes("PAGE_CACHE_MEMORY_MB", 50),
  // No React Compiler; it was on through 2.3. Measured on this codebase
  // (2026-09-28), it spent about a third of the build's CPU in Babel workers
  // that BUILD_MAX_CPUS does not limit, and added 19–30 KB of compressed
  // JavaScript to every storefront page, while no interaction responded
  // noticeably faster (within one 8 ms frame on a 4x-slowed CPU). A build that
  // still passes on a small server is worth more. To bring it back: add the
  // babel-plugin-react-compiler devDependency and set `reactCompiler: true`.

  // 16.3 upserts a managed AGENTS.md/CLAUDE.md block at the project root
  // whenever `next dev` detects a coding agent. This source ships to buyers,
  // so nothing may write files into the tree on its own; the bundled docs
  // under node_modules/next/dist/docs are still there for anyone who wants
  // them.
  agentRules: false,
  skipTrailingSlashRedirect: true,
  // A second dev server in the same checkout (tooling, screenshot runs,
  // E2E against a scratch port) needs its own dist dir — Next refuses two
  // servers sharing one .next. Unset, this is exactly the default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The storage hosts added to `images.remotePatterns` below (a custom CDN
  // domain in STORAGE_PUBLIC_URL, a MinIO endpoint), inlined into the server
  // and browser bundles alike so AppImage sends them through the optimizer
  // instead of serving the full-size original (lib/remote-image-domains.ts).
  env: {
    STORIFY_IMAGE_ORIGINS: imageOriginsForBundle(getEnvRemoteImageDomains()),
  },
  // No `serverExternalPackages` entry is needed for HTML sanitization any
  // more. It used to carry `isomorphic-dompurify` and `jsdom`, which had to
  // stay unbundled because jsdom resolves files relative to its own package at
  // runtime — and marking them external only moved the problem, since the
  // build then depended on the host's file tracer copying the right tree.
  // `lib/sanitize.ts` now uses `sanitize-html`: pure JavaScript, no DOM, no
  // disk reads, so it bundles like any other module.
  // Skip the tsc pass inside `next build`. On a 373k-LOC codebase the type
  // check needs more heap than Node's default ~4GB cap, which is what made
  // buyer builds die with "JavaScript heap out of memory" even on big
  // machines — and it is the slowest build phase after compilation. Types are
  // still enforced, just not here: run `pnpm typecheck` before shipping.
  // Turbopack still fails the build on real syntax/resolution errors.
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // 16.3 turned the build-time Turbopack cache on by default. Builds here
    // are cold by choice (see the September 2026 build audit): writing the
    // cache made the first build the heaviest, and the CI image and Dokploy
    // builds never restore `.next/cache`, so it would be written and never
    // read. The dev cache stays on — that one is what cut dev memory.
    turbopackFileSystemCacheForBuild: false,
    // Server-side source maps for the production build. Off by default: the
    // September 2026 build audit measured them at 190 MB of `.next/server`
    // (more than half of it) and ~40 % of Turbopack's compile time, and
    // `next start` never reads them — Node only resolves .map files when
    // source maps are enabled, which Next does for `next dev` and the build
    // workers, not for the production server. Set BUILD_SOURCE_MAPS=true in
    // the build environment when you want them anyway (uploading to an error
    // tracker, or reading a build-time prerender error against the source).
    turbopackSourceMaps: process.env.BUILD_SOURCE_MAPS === "true",
    // Cap the build's parallelism on memory-constrained servers. Static
    // generation spawns one Node worker per CPU by default; on a busy
    // production host each worker's memory stacks on top of everything
    // already running, which is how a deploy can OOM the whole machine.
    // Set BUILD_MAX_CPUS (e.g. 2) in the deploy environment to trade build
    // speed for a bounded footprint. Unset, Next keeps its default.
    ...(process.env.BUILD_MAX_CPUS
      ? { cpus: Math.max(1, Number(process.env.BUILD_MAX_CPUS) || 1) }
      : {}),
    // Turbopack's filesystem cache for builds (`turbopackFileSystemCacheForBuild`)
    // was tried and removed: writing the cache makes the first build the
    // heaviest, and on a production host that also runs the store it pushed
    // memory over the edge. Builds are cold each time by choice — predictable
    // footprint over rebuild speed.
    // Next's client-side Router Cache defaults to reusing a prefetched static
    // route for 300s. On a storefront that means a shopper who is already
    // browsing keeps seeing the pre-edit catalog for up to five minutes after
    // an admin publishes a product. 30s is the floor Next accepts here (0 is
    // rejected by config validation) and cuts that window by an order of
    // magnitude; the refetch is a server render from the `unstable_cache`
    // layer, so it costs a round trip, not a database query.
    staleTimes: {
      dynamic: 0,
      static: 30,
    },
  },
  outputFileTracingIncludes: {
    // The install wizard's "sample data" imports the chosen template's
    // snapshot from `scripts/seed-data/<template>/` at runtime (see
    // lib/install/snapshot.ts). Traced rather than bundled: it is ~1 MB of
    // JSON per template, read once by a route a store runs exactly once.
    "/api/install/complete": ["./scripts/seed-data/**/*.json"],
    "/api/admin/ai-authoring/hero-banner": [
      "./node_modules/@fontsource/noto-sans/files/*.woff2",
      "./node_modules/@fontsource/noto-sans-bengali/files/*.woff2",
    ],
    // The invoice PDF registers Inter from disk (lib/orders/invoice-pdf.tsx);
    // any route that emails or serves an invoice needs the files traced.
    "/**": ["./public/fonts/inter/*.ttf"],
  },
  async headers() {
    return [
      // First, so a rule below that sets one of the same keys for its own
      // paths (the uploads CSP) replaces it there.
      { source: "/:path*", headers: SECURITY_HEADERS },
      // Stop browsers reusing storefront/admin documents without asking — see
      // lib/http-cache-policy.ts for why Next's default header let them.
      // Overriding Cache-Control here is the supported escape hatch:
      // `sendRenderResult` only applies Next's own value when the response does
      // not already carry one. Server-side caching is untouched; the ISR cache
      // and the `unstable_cache` getters still serve the render, and
      // lib/cache-invalidation.ts expires them on write.
      {
        source: APP_PAGE_HEADER_SOURCE,
        headers: [{ key: "Cache-Control", value: PAGE_CACHE_CONTROL }],
      },
      {
        // `APP_PAGE_HEADER_SOURCE` cannot match the bare root — which is the
        // store default language's own home page, not a redirect to `/en`.
        source: "/",
        headers: [{ key: "Cache-Control", value: PAGE_CACHE_CONTROL }],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, max-age=0",
          },
        ],
      },
      {
        // Chrome asks for the manifest again on every client-side navigation
        // (the metadata <link> is re-emitted per page) and a route handler
        // carries no ETag, so `no-cache` meant a full download each time.
        // Its contents — store name, description, versioned icon paths —
        // change only when an admin edits branding, and an hour of browser
        // staleness there is harmless; a hard reload still bypasses it.
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600",
          },
        ],
      },
      {
        // Local-storage uploads (default path prefix). Keys embed a
        // timestamp + random suffix so they never change → cache forever.
        // The CSP sandbox neutralizes scripts in user-supplied SVGs, which
        // would otherwise run same-origin when opened directly.
        source: "/uploads/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          },
        ],
      },
    ];
  },
  images: {
    // Single source of truth shared with AppImage's trusted-host check
    // (lib/remote-image-domains.ts) so the optimizer whitelist and the
    // client-side "can the optimizer load this?" decision never drift apart.
    // Env-configured custom storage domains (STORAGE_PUBLIC_URL etc.) are
    // appended so self-hosted CDN setups get optimized images too.
    remotePatterns: getRemotePatterns(getEnvRemoteImageDomains()),
    // Storage never redirects an image. The optimizer checks only the first
    // URL against remotePatterns: a bucket answering 3xx could send it to any
    // public host it cares to name.
    maximumRedirects: 0,
    // Optimized output is cached in .next/cache/images, which most deploys
    // discard — so after every release the whole catalogue is re-encoded by
    // sharp on the first requests, pinning CPU exactly when traffic returns.
    // Storage keys embed a timestamp and random suffix and are never reused,
    // so a stored image can never change under a URL: there is no reason to
    // re-optimize for a year. Persist .next/cache across deploys (a volume on
    // Coolify/Dokploy) to get the full benefit — see docs/STORAGE_SETUP.md.
    minimumCacheTTL: 31536000,
    // Those files are capped at IMAGE_CACHE_DISK_MB (unset 1024), the least
    // recently used going first. Next's own cap is half the free disk, and
    // the hosts above include whole provider domains (any r2.dev bucket), so
    // anyone could have a store resize other people's images until that half
    // was full. 0 keeps none: every request encodes the image again.
    maximumDiskCacheSize: envMegabytes("IMAGE_CACHE_DISK_MB", 1024),
  },
};

export default withNextIntl(nextConfig);
