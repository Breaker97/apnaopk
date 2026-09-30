import { getStorageConfig, testStorageConnection } from "@/lib/storage";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { isStorageConfigured } from "@/lib/storage/storage-readiness";

export const GET = withApi(
  { auth: "admin" },
  async () => {
    const config = await getStorageConfig();

    const connection = await testStorageConnection(config);

    return successResponse({
      provider: config.provider,
      configured: isStorageConfigured(config.provider, (field) =>
        Boolean(config[field]),
      ),
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

