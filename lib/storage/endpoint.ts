/**
 * Endpoint and region derivation, shared by everything that needs to know
 * where a provider's objects actually live.
 *
 * This used to happen inside `S3CompatibleProvider`'s constructor alone, which
 * meant `getStorageConfig()` handed every other caller `endpoint: undefined`
 * for Cloudflare R2 and DigitalOcean Spaces — the two providers that derive it
 * rather than store it. Anything building an allowlist from the config (the AI
 * authoring source-image guard, the 3D model proxy) then had no origin to
 * allow, and refused the store's own files.
 *
 * Pure functions, no SDK import: safe for any module to pull in.
 */

import type { StorageConfig } from "./types";

/**
 * Resolve a usable region for the providers that need a real one. "auto" is
 * R2's convention and can linger on a document migrated from it; AWS and MinIO
 * both reject it, so treat "auto"/empty as us-east-1.
 */
export function awsRegion(region: string | undefined): string {
  return region && region !== "auto" ? region : "us-east-1";
}

/**
 * DigitalOcean Spaces addresses every datacenter as `<region>.digitaloceanspaces.com`,
 * so the region slug is the only thing an admin has to supply. nyc3 matches the
 * schema default.
 */
function spacesRegion(region: string | undefined): string {
  return region && region !== "auto" ? region : "nyc3";
}

/** The region the S3 client should be constructed with. */
export function clientRegion(
  config: Pick<StorageConfig, "provider" | "region">,
): string {
  if (config.provider === "cloudflare_r2") return "auto";
  if (config.provider === "digitalocean") return spacesRegion(config.region);
  return awsRegion(config.region);
}

/**
 * The S3 API endpoint for a configuration, or undefined when the SDK derives
 * it from the region (real AWS).
 *
 * Only MinIO supplies its own — every other backend derives one from a field
 * the admin already gave us, so there is no way to mistype a hostname. A
 * stored endpoint on any other provider is deliberately ignored: pre-v1.5
 * documents shared one endpoint field across providers, and a leftover value
 * would otherwise route AWS-bound traffic somewhere else.
 *
 * Returns undefined for R2 without an account ID and MinIO without an
 * endpoint; the provider constructor turns those into a named error.
 */
export function resolveStorageEndpoint(
  config: Pick<
    StorageConfig,
    "provider" | "accountId" | "region" | "endpoint"
  >,
): string | undefined {
  switch (config.provider) {
    case "cloudflare_r2":
      return config.accountId
        ? `https://${config.accountId}.r2.cloudflarestorage.com`
        : undefined;
    case "digitalocean":
      return `https://${spacesRegion(config.region)}.digitaloceanspaces.com`;
    case "minio":
      return config.endpoint || undefined;
    default:
      // Real AWS S3, and the legacy "local" value which has no endpoint at all.
      return undefined;
  }
}
