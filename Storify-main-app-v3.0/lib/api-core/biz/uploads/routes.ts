import { BizUpload, BizUploadAccess, BizUploadResult, BIZ_UPLOAD_REASONS } from "@/contracts/mobile/biz/v1/uploads";
import { OPERATION_REASONS } from "@/contracts/mobile/biz/v1/operations";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { authorizeBizUploadTarget } from "@/lib/api-core/biz/upload-context";
import { BizUploadFormInput, BIZ_UPLOAD_FORM_POLICY } from "@/lib/api-core/biz/upload-form";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineBizRoute } from "@/lib/api-core/registry";
import { uploadBizFile, readBizPrivateUpload } from "@/lib/api-next/biz-upload";
import { createStorageService, getStorageConfig } from "@/lib/storage";
import { isSelectableStorageProvider, type StorageConfig } from "@/lib/storage/types";
import { readBizUpload, scopedBizUpload, uploadNotAvailable } from "./read";
import { isPrivateBizUpload } from "./policy";

const unavailable = () => new MobileApiError(503, "SERVICE_UNAVAILABLE", "Private upload access is not available.", { reason: "UPLOAD_NOT_AVAILABLE" });
function assertStorage(config: StorageConfig, privateFile: boolean) {
  if (!isSelectableStorageProvider(config.provider) || (privateFile && (!config.privateBucketName || config.privateBucketName === config.bucketName))) throw unavailable();
}
const readPolicy = {
  cache: { kind: "private" as const },
  rateLimit: { bucket: "biz:uploads:read", preset: "lenient" as const }, reasons: { values: BIZ_UPLOAD_REASONS },
};

export const bizUploadCreateRoute = defineBizRoute({
  auth: "user", ...BIZ_ACCESS.workspace, cache: { kind: "private" },
  id: "uploads.create", method: "POST", path: "/uploads", status: 201,
  rateLimit: { bucket: "biz:uploads:create", preset: "moderate" }, demo: "default",
  idempotency: "required", durable: true, form: BIZ_UPLOAD_FORM_POLICY,
  input: BizUploadFormInput, output: BizUploadResult,
  reasons: { values: [...BIZ_UPLOAD_REASONS, ...OPERATION_REASONS] },
  handler: async ({ input, workspace, session, client }) => {
    const request = { purpose: input.purpose, target: input.target };
    await authorizeBizUploadTarget({ request, actorId: session.user.id, grant: workspace });
    const config = await getStorageConfig();
    assertStorage(config, isPrivateBizUpload(input.purpose));
    const result = await uploadBizFile({ request, file: input.file, actorId: session.user.id, grant: workspace,
      key: client.idempotencyKey, config, storage: createStorageService(config) });
    return BizUploadResult.parse(result);
  },
});

export const bizUploadDetailRoute = defineBizRoute({
  auth: "user", ...BIZ_ACCESS.workspace, ...readPolicy, id: "uploads.detail", method: "GET", path: "/uploads/{id}", output: BizUpload,
  handler: ({ params, workspace, session }) => readBizUpload({ id: params.id, actorId: session.user.id, grant: workspace }),
});

export const bizUploadAccessRoute = defineBizRoute({
  auth: "user", ...BIZ_ACCESS.workspace, ...readPolicy, id: "uploads.access", method: "GET", path: "/uploads/{id}/access", output: BizUploadAccess,
  handler: async ({ params, workspace, session }) => {
    const input = { id: params.id, actorId: session.user.id, grant: workspace };
    const row = await scopedBizUpload(input);
    if (!row.private || !row.value) throw uploadNotAvailable();
    const config = await getStorageConfig();
    assertStorage(config, true);
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    const result = await readBizPrivateUpload({ ...input, request: { purpose: row.purpose, target: row.target }, storage: createStorageService(config) });
    if (result.kind === "stream") {
      await result.body.cancel().catch(() => undefined);
      throw unavailable();
    }
    if (!result.url) throw unavailable();
    return { url: result.url, expiresAt };
  },
});
