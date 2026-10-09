import { createHash } from "node:crypto";
import { Types } from "mongoose";
import type { BizUploadRequest, BizUploadResult, UploadTarget } from "@/contracts/mobile/biz/v1/uploads";
import { MobileApiError } from "@/lib/api-core/errors";
import type { BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import { authorizeBizUploadTarget } from "@/lib/api-core/biz/upload-context";
import { BIZ_UPLOAD_FILE_MAX_BYTES } from "@/lib/api-core/biz/upload-form";
import { assertBizUploadFile, isPrivateBizUpload } from "@/lib/api-core/biz/uploads/policy";
import { bizOperationBinding, runDurableBizOperation, type BizOperationStore } from "@/lib/api-core/biz/durable-operation";
import { uploadMediaFile } from "@/lib/media-upload/upload-file";
import { mimeEssence } from "@/lib/storage/content-type";
import { BIZ_PRIVATE_UPLOAD_PREFIX } from "@/lib/storage/private-prefixes";
import { digitalAssetKeyPrefix } from "@/lib/products/digital-assets";
import type { StorageConfig, StorageService, PrivateDownload } from "@/lib/storage/types";
import { BizUploadRecord, type StoredBizUpload } from "@/models/biz-upload.model";
import { mongoBizOperationStore } from "./biz-operation-store";

const targetMatches = (left: UploadTarget, right: UploadTarget) => left.kind === right.kind && left.id === right.id;
const unavailable = () => new MobileApiError(404, "NOT_FOUND", "Upload not found.", { reason: "UPLOAD_NOT_AVAILABLE" });

/** Buffer only bounded multipart files; byte digest is part of the immutable attempt, not File's JSON shape. */
export async function uploadBizFile(input: {
  request: BizUploadRequest; file: File; actorId: string; grant: BizWorkspaceGrant; key: string | undefined;
  config: StorageConfig; storage: StorageService; operations?: BizOperationStore;
}): Promise<BizUploadResult> {
  if (input.file.size <= 0 || input.file.size > BIZ_UPLOAD_FILE_MAX_BYTES) throw new MobileApiError(413, "VALIDATION_ERROR", "The file exceeds the upload limit.", { reason: "UPLOAD_TOO_LARGE" });
  assertBizUploadFile(input.request, input.file, input.config);
  const type = mimeEssence(input.file.type);
  const isPrivate = isPrivateBizUpload(input.request.purpose);
  if (isPrivate && (!input.config.privateBucketName || input.config.privateBucketName === input.config.bucketName)) {
    throw new MobileApiError(503, "SERVICE_UNAVAILABLE", "Private storage is not configured.", { reason: "UPLOAD_NOT_AVAILABLE" });
  }
  const bytes = Buffer.from(await input.file.arrayBuffer());
  if (bytes.length !== input.file.size) throw new MobileApiError(400, "VALIDATION_ERROR", "The file size changed.");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const binding = bizOperationBinding({ actorId: input.actorId, workspace: input.grant, key: input.key,
    routeId: "uploads.create", target: `${input.request.target.kind}:${input.request.target.id}`,
    payload: { ...input.request, filename: input.file.name, mimeType: type, size: bytes.length, digest } });
  const authorize = async (resources: readonly { kind: string; id: string }[]) => {
    const context = await authorizeBizUploadTarget({ request: input.request, actorId: input.actorId, grant: input.grant });
    for (const resource of resources) {
      const row = await BizUploadRecord.findOne({ _id: resource.id, actorId: input.actorId, workspaceId: context.workspaceId }).lean<StoredBizUpload | null>();
      if (!row || row.ownerVendorId !== context.ownerVendorId || !targetMatches(row.target, input.request.target)) throw unavailable();
    }
  };
  const storeFile = async (operation: import("@/lib/api-core/biz/durable-operation").BizOperationExecution) => {
      const context = await authorizeBizUploadTarget({ request: input.request, actorId: input.actorId, grant: input.grant });
      const id = new Types.ObjectId(createHash("sha256").update(operation.effectKey).digest("hex").slice(0, 24));
      const previous = await BizUploadRecord.findOne({ _id: id }).lean<StoredBizUpload | null>();
      if (previous && (previous.actorId !== input.actorId || previous.workspaceId !== context.workspaceId || previous.ownerVendorId !== context.ownerVendorId || previous.digest !== digest)) throw unavailable();
      await BizUploadRecord.updateOne({ _id: id }, { $setOnInsert: { ...input.request, actorId: input.actorId,
        workspaceId: context.workspaceId, ownerVendorId: context.ownerVendorId, operationId: operation.id, digest,
        state: "pending", private: isPrivate } }, { upsert: true });
      const filename = input.file.name.split(/[\\/]/).pop()?.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "") || "upload";
      const customPath = `${id}/${filename}`;
      let storageKey: string;
      let value: BizUploadResult["upload"];
      if (isPrivate) {
        const prefix = input.request.purpose === "digital_asset" ? digitalAssetKeyPrefix(context.ownerVendorId) : `${BIZ_PRIVATE_UPLOAD_PREFIX}${context.workspaceId}/`;
        const stored = await input.storage.uploadPrivateFile(bytes, { fileName: filename, fileSize: bytes.length,
          contentType: type || "application/octet-stream", customPath: `${prefix}${customPath}`,
          metadata: { uploadedBy: input.actorId, bizOperationId: operation.id } });
        if (!stored.success) throw new Error("Private upload did not complete");
        storageKey = stored.key;
        value = { id: String(id), ...input.request, filename, mimeType: stored.contentType, size: stored.size, private: true };
      } else {
        const stored = await uploadMediaFile(input.file, { config: input.config, storage: input.storage,
          uploadedBy: input.actorId, ownerScope: context.ownerScope, customPath, createId: () => String(id) });
        storageKey = stored.key;
        value = { id: String(id), ...input.request, filename: stored.filename, mimeType: stored.mimeType, size: stored.size, private: false, url: stored.url };
      }
      const saved = await BizUploadRecord.updateOne({ _id: id, actorId: input.actorId, digest, state: "pending" }, { $set: { state: "ready", storageKey, value } });
      if (saved.matchedCount !== 1) throw new Error("Upload receipt changed concurrently");
      return { data: value, resources: [{ kind: "upload" as const, id: String(id) }] };
  };
  const result = await runDurableBizOperation<BizUploadResult["upload"]>({ binding, store: input.operations ?? mongoBizOperationStore, authorize,
    async reconcile(operation) {
      const row = await BizUploadRecord.findOne({ operationId: operation.id }).lean<StoredBizUpload & { _id: unknown } | null>();
      if (row?.state === "ready" && row.value) return { state: "succeeded", data: row.value, resources: [{ kind: "upload", id: String(row._id) }] };
      if (!row) return { state: "not_applied" };
      // Reconcile the blob by writing identical bytes to the SAME immutable
      // object, then finish its receipt. This does not claim an uncertain
      // effect was absent or authorize a second financial/stock effect.
      const reconciled = await storeFile(operation);
      return { state: "succeeded", ...reconciled };
    },
    execute: storeFile,
  });
  return { operation: result.operation, upload: result.data };
}

/** Domain save routes resolve only typed IDs; private keys never come from the app. */
export async function resolveBizUpload(input: {
  id: string; actorId: string; grant: BizWorkspaceGrant; request: BizUploadRequest; access?: "read" | "write";
}): Promise<StoredBizUpload> {
  const context = await authorizeBizUploadTarget(input);
  if (!Types.ObjectId.isValid(input.id)) throw unavailable();
  const row = await BizUploadRecord.findOne({ _id: input.id, ...(input.access === "read" && input.request.target.kind !== "product_draft" ? {} : { actorId: input.actorId }), workspaceId: context.workspaceId,
    purpose: input.request.purpose, state: "ready" }).lean<StoredBizUpload | null>();
  if (!row || !targetMatches(row.target, input.request.target) || row.ownerVendorId !== context.ownerVendorId || !row.storageKey) throw unavailable();
  return row;
}

/** Scoped file route may redirect/stream this result with no-store and safe disposition. */
export async function readBizPrivateUpload(input: Parameters<typeof resolveBizUpload>[0] & { storage: StorageService }): Promise<PrivateDownload> {
  const row = await resolveBizUpload({ ...input, access: "read" });
  if (!row.private || !row.storageKey || !row.value) throw unavailable();
  return input.storage.getPrivateDownload(row.storageKey, { expiresInSeconds: 300, filename: row.value.filename, disposition: "attachment" });
}
