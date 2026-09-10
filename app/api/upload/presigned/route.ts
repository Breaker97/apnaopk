/**
 * POST /api/upload/presigned
 * Generate presigned URLs for direct client-to-storage uploads.
 *
 * Why this path exists: POST /api/upload streams the bytes through the app
 * server, which caps uploads at the hosting platform's request-body limit
 * (4.5MB on Vercel) regardless of the storage settings. Product photos and
 * videos routinely exceed that, so they failed in production while working
 * locally, where no such limit applies. Handing the browser a presigned PUT
 * lets the file go straight to R2/S3 and removes the ceiling entirely.
 *
 * Local storage has no presigned equivalent — the response says so via
 * `supportsDirectUpload: false` so the client can fall back to /api/upload
 * instead of surfacing an error.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  getStorageConfig,
  getStorageService,
  validateUpload,
} from "@/lib/storage";
import { isSafeUploadDirectory } from "@/lib/storage/key";
import { resolveUploadScope } from "@/lib/storage/upload-scope";
import { z } from "zod";

const PresignedUploadSchema = z.object({
  fileName: z.string().min(1).max(512),
  contentType: z.string().min(1).max(200),
  fileSize: z.number().finite().positive(),
  customPath: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Same authentication rule as /api/upload: any signed-in user may upload
    // (customers post review and profile images), anonymous callers may not.
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 },
      );
    }
    // Left open on demo deployments for the same reason as POST /api/upload.

    // Mirrors /api/upload. Without this, the cheaper presigned endpoint would
    // be an unthrottled way to mint write URLs for the bucket.
    await rateLimitByUser(
      request,
      session.user.id,
      "upload:create",
      "moderate",
      session.user.role,
    );

    // fileSize is a number, never a string: a falsy-but-valid 0 and a
    // non-numeric value must both be rejected, because the size ceiling below
    // is what the presigned URL commits to.
    const parsed = PresignedUploadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "fileName, contentType, and a positive fileSize are required",
        },
        { status: 400 },
      );
    }
    const { fileName, contentType, fileSize, customPath } = parsed.data;

    // customPath comes from the client, and a non-slash-terminated value
    // becomes the WHOLE object key — a presigned PUT for an existing key
    // would let any signed-in user overwrite any stored file. Only accept
    // directory-style values ("avatars/"); the key generator then appends a
    // collision-safe directory so the URL can never target an existing object.
    if (customPath !== undefined && !isSafeUploadDirectory(customPath)) {
      return NextResponse.json(
        {
          success: false,
          message:
            'customPath must be a folder path of letters, digits, "-" or "_" ending with "/" (e.g. "avatars/")',
        },
        { status: 400 },
      );
    }

    // Get storage configuration
    const config = await getStorageConfig();

    // Local storage cannot presign — tell the client to use /api/upload. This
    // is a normal outcome, not an error, so it returns 200.
    if (config.provider === "local") {
      return NextResponse.json({
        success: true,
        supportsDirectUpload: false,
        data: null,
      });
    }

    // Validate upload against configuration. This is the only place the size
    // and type limits are enforced for direct uploads — once the client holds
    // the presigned URL the app is no longer in the path. ContentLength is
    // pinned into the signature by the provider, so a client cannot present
    // a small size here and then PUT a larger body.
    const validation = validateUpload(config, fileSize, contentType);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, message: validation.error },
        { status: 400 },
      );
    }

    // Get storage service and generate presigned URL
    const storage = await getStorageService();

    // Derived from the session, never from the request: customPath is checked
    // for shape, not ownership, so it cannot be trusted to say who owns the
    // object. A vendor's uploads land under their own prefix either way.
    const ownerScope = await resolveUploadScope(session.user);

    const result = await storage.getPresignedUploadUrl({
      fileName,
      contentType,
      fileSize,
      customPath,
      ownerScope,
      metadata: {
        uploadedBy: session.user.id,
        originalName: fileName,
      },
    });

    return NextResponse.json({
      success: true,
      supportsDirectUpload: true,
      data: {
        uploadUrl: result.uploadUrl,
        publicUrl: result.publicUrl,
        key: result.key,
        filename: fileName,
        expiresIn: result.expiresIn,
        provider: config.provider,
      },
    });
  } catch (error) {
    console.error("Presigned URL generation error:", error);
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error && error.message
            ? error.message
            : "Failed to generate upload URL",
      },
      { status: 500 },
    );
  }
}
