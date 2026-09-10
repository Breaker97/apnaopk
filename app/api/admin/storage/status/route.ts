import { getStorageConfig, testStorageConnection } from "@/lib/storage";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";

function isConfigured(config: Awaited<ReturnType<typeof getStorageConfig>>) {
  if (config.provider === "local") {
    // Retired in v1.5. A store still on it can serve what it already has but
    // cannot accept a single new upload, so reporting it as configured would
    // put a green chip on a storefront that is one product away from failing.
    return false;
  }

  const hasKeys = Boolean(
    config.bucketName && config.accessKeyId && config.secretAccessKey,
  );
  if (!hasKeys) return false;

  // The one extra field each backend needs before a client can be built.
  switch (config.provider) {
    case "cloudflare_r2":
      return Boolean(config.accountId);
    case "minio":
      return Boolean(config.endpoint);
    default:
      // AWS S3 and DigitalOcean Spaces derive their endpoint from the region,
      // which always has a schema default.
      return true;
  }
}

export const GET = withApi(
  { auth: "admin" },
  async () => {
    const config = await getStorageConfig();

    const connection = await testStorageConnection(config);

    return successResponse({
      provider: config.provider,
      configured: isConfigured(config),
      connection,
      details: {
        bucketName: config.bucketName,
        region: config.region,
        publicUrl: config.publicUrl,
        pathPrefix: config.pathPrefix,
        maxFileSizeMB: config.maxFileSizeMB,
        allowedMimeTypesCount: config.allowedMimeTypes.length,
      },
    });
  },
);

