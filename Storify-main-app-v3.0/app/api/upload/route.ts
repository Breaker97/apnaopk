/**
 * POST /api/upload
 * Direct server-side file upload endpoint
 * Supports both single file and batch uploads
 * Uses configurable storage (Cloudflare R2, AWS S3)
 */

import { NextRequest, NextResponse } from "next/server";
import { isInternalError, publicErrorMessage } from "@/lib/api/errors";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { isAdmin } from "@/lib/access/rbac";
import { isPublicMediaKey } from "@/lib/storage/private-prefixes";
import { auditDelete, createAuditContext } from "@/lib/audit";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { getStorageConfig, getStorageService } from "@/lib/storage";
import { resolveUploadScope } from "@/lib/storage/upload-scope";
import { getDemoModeMutationResponse } from "@/lib/demo-mode";
import {
  uploadMediaFile,
  type UploadedMediaRecord,
} from "@/lib/media-upload/upload-file";
import {
  isShopper,
  maxFilesPerUpload,
  readUploadForm,
  uploadBodyLimit,
  UploadTooLargeError,
} from "@/lib/media-upload/upload-policy";

export async function POST(request: NextRequest) {
  try {
    // Require authentication. Customers legitimately upload review/profile
    // images and privileged users upload product/store media, so any signed-in
    // user is allowed — but anonymous uploads to the storage bucket are not.
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 },
      );
    }
    // Uploading is deliberately left open on demo deployments — a demo store
    // is only convincing if products can be given real images. The per-user
    // rate limit below is what keeps storage spend bounded there.

    // Throttle per user to prevent storage-cost abuse from a compromised or
    // automated account.
    await rateLimitByUser(
      request,
      session.user.id,
      "upload:create",
      "moderate",
      session.user.role,
    );

    // A shopper uploads photos within tighter limits than the store's own —
    // see lib/media-upload/upload-policy.ts. The limit is known before the
    // body is read, so an oversized request is refused as it arrives.
    const shopper = isShopper(session.user);
    const config = await getStorageConfig();

    let formData: FormData;
    try {
      formData = await readUploadForm(request, uploadBodyLimit(config, shopper));
    } catch (error) {
      if (error instanceof UploadTooLargeError) {
        return NextResponse.json(
          { success: false, message: error.message },
          { status: 413 },
        );
      }
      throw error;
    }

    // Support both 'file' (single) and 'files' (batch) field names
    // The logo exception, asked for by the uploader and granted only to an
    // admin — the store's logos are the one place it is used, and raw SVG can
    // carry script served from the store's own media host.
    const keepVector =
      formData.get("keepVector") === "1" && isAdmin(session.user);

    const files = formData.getAll("files") as File[];
    const singleFile = formData.get("file") as File | null;

    const allFiles = singleFile ? [singleFile, ...files] : files;

    if (!allFiles || allFiles.length === 0) {
      return NextResponse.json(
        { success: false, message: "No files provided" },
        { status: 400 },
      );
    }

    const maxFiles = maxFilesPerUpload(shopper);
    if (allFiles.length > maxFiles) {
      return NextResponse.json(
        { success: false, message: `Upload at most ${maxFiles} files at a time` },
        { status: 400 },
      );
    }

    const storage = await getStorageService();
    // Vendor uploads are filed under their own key prefix — resolved from the
    // session, so the caller cannot claim someone else's scope.
    const ownerScope = await resolveUploadScope(session.user);

    const uploaded: UploadedMediaRecord[] = [];

    const errors: string[] = [];

    for (const file of allFiles) {
      if (!(file instanceof File)) continue;

      try {
        uploaded.push(
          await uploadMediaFile(file, {
            config,
            storage,
            uploadedBy: session.user.id,
            ownerScope,
            keepVector,
            shopper,
          }),
        );
      } catch (error) {
        // A storage or runtime failure reaches the caller only as "Upload
        // failed", so it is logged here in full.
        if (error instanceof Error && isInternalError(error)) {
          console.error(`Upload of "${file.name}" failed:`, error);
        }
        errors.push(`${file.name}: ${publicErrorMessage(error, "Upload failed")}`);
      }
    }

    if (uploaded.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "No valid files were uploaded",
          errors,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      data: uploaded,
      message: `${uploaded.length} file(s) uploaded successfully`,
      provider: config.provider,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      {
        success: false,
        message: publicErrorMessage(error, "Failed to upload files"),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Require authentication for deletion
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 },
      );
    }

    // Deletion takes a storage key, and nothing records who uploaded what:
    // a vendor or staff member with the product grant could delete another
    // store's photos — or the store's own logo — by reading the key off a
    // public URL. The admin Media Library is the only screen that deletes by
    // key, so only an admin may.
    if (!isAdmin(session.user)) {
      return NextResponse.json(
        { success: false, message: "You do not have permission to delete files" },
        { status: 403 },
      );
    }
    const demoBlock = getDemoModeMutationResponse();
    if (demoBlock) return demoBlock;

    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key") || searchParams.get("filename");

    if (!key) {
      return NextResponse.json(
        { success: false, message: "File key or filename is required" },
        { status: 400 },
      );
    }

    // Public media only: a private file (an identity document, a paid
    // download, a receipt) is removed by what owns it, and a crafted key
    // must not reach outside the media folder.
    const config = await getStorageConfig();
    if (!isPublicMediaKey(key, config.pathPrefix || "")) {
      return NextResponse.json(
        { success: false, message: "Only files in the media library can be deleted here" },
        { status: 400 },
      );
    }

    const storage = await getStorageService();
    const result = await storage.deleteFile(key);
    await auditDelete(
      createAuditContext(request, session),
      "media",
      key,
      { key },
      key.split("/").pop(),
    );

    return NextResponse.json({
      success: true,
      data: result,
      message: "File deleted successfully",
    });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json(
      {
        success: false,
        message: publicErrorMessage(error, "Failed to delete file"),
      },
      { status: 500 },
    );
  }
}
