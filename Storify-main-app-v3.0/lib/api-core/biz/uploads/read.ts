import { Types } from "mongoose";
import { BizUpload, BizUploadRequest } from "@/contracts/mobile/biz/v1/uploads";
import type { BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import { MobileApiError } from "@/lib/api-core/errors";
import { connectDB } from "@/lib/db";
import { resolveBizUpload } from "@/lib/api-next/biz-upload";
import { BizUploadRecord } from "@/models/biz-upload.model";

export const uploadNotAvailable = () => new MobileApiError(404, "NOT_FOUND", "Upload not found.", { reason: "UPLOAD_NOT_AVAILABLE" });

/** Metadata is discovered internally, then authorized against its current resource. */
export async function scopedBizUpload(input: { id: string; actorId: string; grant: BizWorkspaceGrant }) {
  if (!Types.ObjectId.isValid(input.id)) throw uploadNotAvailable();
  await connectDB();
  const workspaceId = input.grant.workspace === "vendor" ? input.grant.vendor.id : "platform";
  const candidate = await BizUploadRecord.findOne({ _id: input.id, workspaceId, state: "ready" }).select("purpose target").lean();
  const request = BizUploadRequest.safeParse(candidate);
  if (!request.success) throw uploadNotAvailable();
  return resolveBizUpload({ ...input, request: request.data, access: "read" });
}

export async function readBizUpload(input: Parameters<typeof scopedBizUpload>[0]): Promise<BizUpload> {
  const row = await scopedBizUpload(input);
  if (!row.value) throw uploadNotAvailable();
  // The contract strips internal keys and actor/owner fields even on legacy rows.
  const value = BizUpload.parse(row.value);
  if (row.private) return { ...value, private: true, url: undefined, image: undefined, expiresAt: undefined };
  return value;
}
