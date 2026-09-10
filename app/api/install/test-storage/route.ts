import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { installStorageSchema } from "@/lib/install/payload";
import { assertInstallable } from "@/lib/install/status";
import { testStorageConnection, type StorageConfig } from "@/lib/storage";

/**
 * "Test connection" for the wizard's storage step — the pre-install twin of
 * `/api/admin/settings/test-storage`, which cannot be used here because no
 * admin exists yet to authenticate as.
 *
 * Unauthenticated by necessity, so `assertInstallable()` is the whole gate:
 * the moment the store has an admin this answers 404 like every other wizard
 * route. That matters more than usual — the MinIO branch dials a host the
 * caller supplies, so leaving it reachable after setup would hand a live
 * store a request-forgery probe. Rate-limited on top, since a buyer fixing
 * their keys retries a handful of times and an attacker would not stop there.
 *
 * Credentials arrive in full: nothing is stored yet, so there is no saved
 * value to fall back to the way the admin route does.
 */
export const POST = withApi(
  {
    auth: "optional",
    rateLimit: { action: "install:test-storage", preset: "moderate" },
  },
  async ({ request }) => {
    await assertInstallable();

    const body = await request.json().catch(() => null);
    const parsed = installStorageSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid storage configuration",
      );
    }
    const draft = parsed.data;

    const config: StorageConfig = {
      provider: draft.provider,
      accountId:
        draft.provider === "cloudflare_r2" ? draft.accountId : undefined,
      endpoint: draft.provider === "minio" ? draft.endpoint : undefined,
      region: "region" in draft ? draft.region || "auto" : "auto",
      bucketName: draft.bucketName,
      accessKeyId: draft.accessKeyId,
      secretAccessKey: draft.secretAccessKey,
      publicUrl: draft.publicUrl || undefined,
      // Not part of the test: the limits and the type allow-list are the
      // upload path's business and keep their model defaults until the admin
      // narrows them on the Storage tab.
      maxFileSizeMB: 10,
      allowedMimeTypes: [],
    };

    // `true` = also prove the public URL serves what was just written. A
    // bucket that accepts uploads but is not anonymously readable passes the
    // API check and then 403s on every product image.
    const result = await testStorageConnection(config, true);
    return successResponse({ ok: result.success, message: result.message });
  },
);
