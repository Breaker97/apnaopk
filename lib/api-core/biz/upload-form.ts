import * as z from "zod";
import { BizUploadRequest, UploadTarget } from "@/contracts/mobile/biz/v1/uploads";

/** The server converts multipart text to the contract; the contract copy has no transport transforms. */
export const BizUploadFormInput = z.object({
  purpose: BizUploadRequest.shape.purpose,
  target: z.string().max(512).transform((value, context) => {
    try { return UploadTarget.parse(JSON.parse(value)); }
    catch { context.addIssue({ code: "custom", message: "Send a valid upload target as JSON." }); return z.NEVER; }
  }),
  file: z.custom<File>((value) => typeof value === "object" && value !== null && "arrayBuffer" in value && "size" in value && "name" in value && "type" in value, "Send a file."),
});
// The returned UploadPolicy advertises this actual transport ceiling. Larger
// digital/video files need the web's direct upload surface until native resumable upload exists.
export const BIZ_UPLOAD_FILE_MAX_BYTES = 4 * 1024 * 1024;
export const BIZ_UPLOAD_FORM_POLICY = { maxBytes: BIZ_UPLOAD_FILE_MAX_BYTES + 32 * 1024, files: ["file"] } as const;
