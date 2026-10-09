import "server-only";

import { NextResponse } from "next/server";
import { ReturnRequest } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { notFoundResponse } from "@/lib/api/response";
import { getStorageService } from "@/lib/storage";
import {
  RETURN_LABEL_KEY_PREFIX,
  RETURN_LABEL_MAX_SIZE_MB,
  RETURN_LABEL_MIME_TYPES,
  RETURN_LABEL_UPLOAD_STATUSES,
  isReturnLabelKey,
} from "@/lib/returns/return-shipping";

/**
 * A return label the store uploads, kept privately and served only through the
 * return's own label routes — the store's, the seller's and the shopper's.
 *
 * The same shape as expense receipts (app/api/admin/finance/expenses/receipts):
 * a label carries the shopper's name and address, and the public media upload
 * would have put it in the Media Library beside product photos.
 */

const VIEW_URL_TTL_SECONDS = 300;

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/** RFC 6266 Content-Disposition with a UTF-8 fallback for non-ASCII names. */
function inlineDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Store an uploaded label and put it on the return, replacing any earlier one.
 *
 * Refused once the parcel is on its way: a label changed after the shopper
 * posted the parcel describes a journey that already happened.
 */
export async function attachReturnLabel(params: {
  returnRequest: { _id: unknown; status?: string | null; shipment?: { labelFileKey?: string | null } | null };
  file: unknown;
  userId: string;
}) {
  const { returnRequest, file } = params;
  if (!(file instanceof File)) {
    throw new ValidationError("No file provided");
  }
  if (
    !(RETURN_LABEL_UPLOAD_STATUSES as readonly string[]).includes(
      String(returnRequest.status || ""),
    )
  ) {
    throw new ValidationError(
      "This return's parcel is already on its way or back, so its label can no longer be changed.",
    );
  }
  const mimeType = file.type || "application/octet-stream";
  if (!(RETURN_LABEL_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new ValidationError("Use a PDF, PNG or JPG file");
  }
  if (file.size > RETURN_LABEL_MAX_SIZE_MB * 1024 * 1024) {
    throw new ValidationError(`That file is larger than ${RETURN_LABEL_MAX_SIZE_MB} MB`);
  }

  const storage = await getStorageService();
  const uploaded = await storage.uploadPrivateFile(
    Buffer.from(await file.arrayBuffer()),
    {
      fileName: file.name,
      contentType: mimeType,
      fileSize: file.size,
      customPath: RETURN_LABEL_KEY_PREFIX,
      metadata: {
        uploadedBy: params.userId,
        originalName: file.name,
        purpose: "return-label",
        returnRequestId: String(returnRequest._id),
      },
    },
  );

  // Re-checked in the write, so a return the shopper posted between the read
  // and here keeps the label they posted it with.
  const updated = await ReturnRequest.findOneAndUpdate(
    {
      _id: returnRequest._id,
      status: { $in: RETURN_LABEL_UPLOAD_STATUSES },
    },
    {
      $set: {
        "shipment.labelFileKey": uploaded.key,
        "shipment.labelFileName": file.name.slice(0, 255),
        "shipment.labelAddedAt": new Date(),
        updatedBy: params.userId,
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!updated) {
    await storage.deletePrivateFile(uploaded.key).catch(() => null);
    throw new ValidationError(
      "This return changed while the label was uploading. Reload it and try again.",
    );
  }

  const previous = returnRequest.shipment?.labelFileKey;
  if (previous && previous !== uploaded.key && isReturnLabelKey(previous)) {
    await storage.deletePrivateFile(previous).catch((error) =>
      console.error("Failed to remove a replaced return label:", error),
    );
  }
  return updated;
}

/**
 * The label file as a response: a short-lived signed URL on S3/R2, the bytes
 * themselves on local storage. Only the three types the upload accepts are
 * shown inline; anything else is handed over as bytes.
 */
export async function returnLabelResponse(
  key: string | null | undefined,
  filename?: string | null,
): Promise<Response> {
  if (!isReturnLabelKey(key)) return notFoundResponse("Return label");
  const storage = await getStorageService();
  const name = String(filename || "").trim() || String(key).split("/").pop() || "label";

  let download;
  try {
    download = await storage.getPrivateDownload(String(key), {
      expiresInSeconds: VIEW_URL_TTL_SECONDS,
      filename: name,
      disposition: "inline",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return notFoundResponse("Return label");
    }
    throw error;
  }

  if (download.kind === "redirect") {
    return NextResponse.redirect(download.url, 302);
  }

  const extension = String(key).split(".").pop()?.toLowerCase() ?? "";
  const headers = new Headers({
    "Content-Type": CONTENT_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream",
    "Content-Disposition": CONTENT_TYPE_BY_EXTENSION[extension]
      ? inlineDisposition(name)
      : "attachment",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });
  if (download.size) headers.set("Content-Length", String(download.size));
  return new Response(download.body, { headers });
}
