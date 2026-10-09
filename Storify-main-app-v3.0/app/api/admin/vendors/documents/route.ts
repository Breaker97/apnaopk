/**
 * Admin access to vendor verification (KYC) documents.
 *
 * GET  ?key=… — serve a privately stored document to an admin: S3/R2 installs
 *               get a 302 to a short-lived signed URL, local storage streams
 *               the bytes. Legacy documents saved as public URLs never reach
 *               this route (the UI links to them directly).
 * POST         — upload a replacement document on the vendor's behalf from the
 *               admin Documents tab. Stored privately, like wizard uploads;
 *               the returned key is saved onto the vendor via the vendor PUT.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ValidationError } from "@/lib/api/errors";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { getStorageConfig, getStorageService, validateUpload } from "@/lib/storage";
import {
  isVendorDocumentKey,
  VENDOR_DOCUMENT_KEY_PREFIX,
  VENDOR_DOCUMENT_MAX_SIZE_MB,
  VENDOR_DOCUMENT_MIME_TYPES,
} from "@/lib/vendors/vendor-documents";

const DOWNLOAD_URL_TTL_SECONDS = 300;

/** RFC 6266 Content-Disposition with a UTF-8 fallback for non-ASCII names. */
function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendor-documents:file", preset: "moderate" },
  },
  async ({ request }) => {
    const key = new URL(request.url).searchParams.get("key") || "";

    // The prefix + segment check is the authorization boundary within private
    // storage: it stops a crafted key from reaching other private files
    // (digital product deliverables live in the same store).
    if (!isVendorDocumentKey(key)) {
      throw new ValidationError("Invalid document key");
    }

    const storage = await getStorageService();
    const filename = key.split("/").pop() || "document";

    let download;
    try {
      download = await storage.getPrivateDownload(key, {
        expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
        filename,
      });
    } catch (error) {
      // Local storage stats the file before streaming — a removed or
      // never-written document should read as missing, not as a server error.
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return notFoundResponse("Document");
      }
      throw error;
    }

    if (download.kind === "redirect") {
      return NextResponse.redirect(download.url, 302);
    }

    const headers = new Headers({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": attachmentDisposition(filename),
      "Cache-Control": "private, no-store",
    });
    if (download.size) headers.set("Content-Length", String(download.size));
    return new Response(download.body, { headers });
  },
);

export const POST = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendor-documents:upload", preset: "moderate" },
  },
  async ({ request, session }) => {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new ValidationError("No file provided");
    }

    const mimeType = file.type || "application/octet-stream";
    if (!(VENDOR_DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new ValidationError("Only PDF, PNG, JPG or WebP files are allowed");
    }
    if (file.size > VENDOR_DOCUMENT_MAX_SIZE_MB * 1024 * 1024) {
      throw new ValidationError(
        `File is larger than ${VENDOR_DOCUMENT_MAX_SIZE_MB}MB`,
      );
    }

    const config = await getStorageConfig();
    const validation = validateUpload(config, file.size, mimeType);
    if (!validation.valid) {
      throw new ValidationError(validation.error || "Upload rejected");
    }

    const storage = await getStorageService();
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await storage.uploadPrivateFile(buffer, {
      fileName: file.name,
      contentType: mimeType,
      fileSize: file.size,
      customPath: VENDOR_DOCUMENT_KEY_PREFIX,
      metadata: {
        uploadedBy: session.user.id,
        originalName: file.name,
        purpose: "vendor-verification",
      },
    });

    return successResponse({
      key: result.key,
      filename: file.name,
      mimeType,
      size: file.size,
    });
  },
);
