/**
 * POST /api/upload
 * Direct server-side file upload endpoint
 * Supports both single file and batch uploads
 * Uses configurable storage (Cloudflare R2, AWS S3)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { canManageStoreMedia } from "@/lib/access/rbac";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { getStorageConfig, getStorageService } from "@/lib/storage";
import { resolveUploadScope } from "@/lib/storage/upload-scope";
import { getDemoModeMutationResponse } from "@/lib/demo-mode";
import {
  uploadMediaFile,
  type UploadedMediaRecord,
} from "@/lib/media-upload/upload-file";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

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

    const formData = await request.formData();

    // Support both 'file' (single) and 'files' (batch) field names
    // The logo exception, asked for by the uploader and granted only to a
    // caller who already manages store media — raw SVG can carry script and
    // is served from the store's own media host.
    const keepVector =
      formData.get("keepVector") === "1" &&
      (await canManageStoreMedia(session.user));

    const files = formData.getAll("files") as File[];
    const singleFile = formData.get("file") as File | null;

    const allFiles = singleFile ? [singleFile, ...files] : files;

    if (!allFiles || allFiles.length === 0) {
      return NextResponse.json(
        { success: false, message: "No files provided" },
        { status: 400 },
      );
    }

    // Get storage configuration
    const config = await getStorageConfig();
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
          }),
        );
      } catch (error) {
        errors.push(`${file.name}: ${getErrorMessage(error, "Upload failed")}`);
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
        message: getErrorMessage(error, "Failed to upload files"),
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

    // Deletion accepts an arbitrary storage key, so it is limited to callers
    // who actually manage store media: an admin, or a vendor/staff account
    // holding a product-management grant. "Any signed-in non-customer" was too
    // wide — a staff member with an empty permission list could delete any
    // object in the bucket by key.
    if (!(await canManageStoreMedia(session.user))) {
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

    const storage = await getStorageService();
    const result = await storage.deleteFile(key);

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
        message: getErrorMessage(error, "Failed to delete file"),
      },
      { status: 500 },
    );
  }
}
