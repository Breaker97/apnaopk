import { Types } from "mongoose";
import type { BizUploadAccess } from "@/contracts/mobile/biz/v1/uploads";
import { BizUploadRecord } from "@/models/biz-upload.model";
import { getStorageService, getStorageConfig } from "@/lib/storage";
import { MobileApiError } from "@/lib/api-core/errors";
import { scopedReturn, returnNotFound, type ReturnContext } from "./context";

/** Membership and current whole-order authority precede every signed URL. */
export async function readReturnAttachment(id: string, uploadId: string | undefined, context: ReturnContext): Promise<BizUploadAccess> {
  const { returned } = await scopedReturn(id, context);
  let key: string | undefined; let filename: string | undefined;
  if (uploadId) {
    if (!Types.ObjectId.isValid(uploadId) || !returned.evidenceIds?.includes(uploadId)) throw returnNotFound();
    const upload = await BizUploadRecord.findOne({ _id: uploadId, state: "ready", private: true, purpose: "return_evidence", "target.kind": { $in: ["order", "return"] }, "target.id": { $in: [String(returned.orderId), id] } }).lean<{ storageKey?: string; value?: { filename?: string } } | null>();
    if (!upload) throw returnNotFound(); key = upload.storageKey; filename = upload.value?.filename;
  } else {
    key = returned.shipment?.labelFileKey; filename = returned.shipment?.labelFileName;
    if (!key && returned.shipment?.labelUrl) return { url: returned.shipment.labelUrl, expiresAt: new Date(Date.now() + 300_000).toISOString() };
  }
  if (!key) throw returnNotFound();
  const config = await getStorageConfig();
  if (!config.privateBucketName || config.privateBucketName === config.bucketName) throw new MobileApiError(503, "SERVICE_UNAVAILABLE", "Private return storage is not configured.");
  const result = await (await getStorageService()).getPrivateDownload(key, { filename, expiresInSeconds: 300, disposition: "inline" });
  if (result.kind !== "redirect") throw new MobileApiError(503, "SERVICE_UNAVAILABLE", "This private storage provider cannot issue a native download URL.");
  return { url: result.url, expiresAt: new Date(Date.now() + 300_000).toISOString() };
}
