/**
 * POST /api/vendor/apply/documents
 * Uploads a single verification document during vendor registration.
 *
 * The generic /api/upload endpoint authenticates with auth.api.getSession,
 * which returns null while a user is "blocked_pending" email verification.
 * Applicants sign up inside the wizard and reach the document step before
 * verifying their email, so this route uses getRegistrationSession — the same
 * posture as the sibling apply route — and stays narrowly scoped: one file,
 * document mime types only, and only while the caller has no vendor profile.
 *
 * These are identity documents, so they go to PRIVATE storage: the response
 * carries a storage key (no URL), and only the admin-authenticated
 * /api/admin/vendors/documents route can serve the bytes back.
 */

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { Vendor } from "@/models";
import { USER_ROLES } from "@/config/app.config";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { getStorageConfig, getStorageService, validateUpload } from "@/lib/storage";
import { getSettings } from "@/models/settings.model";
import {
  VENDOR_DOCUMENT_MAX_SIZE_MB,
  VENDOR_DOCUMENT_MIME_TYPES,
  vendorDocumentScope,
} from "@/lib/vendors/vendor-documents";

const ALLOWED_MIME_TYPES = new Set<string>(VENDOR_DOCUMENT_MIME_TYPES);
const MAX_SIZE_BYTES = VENDOR_DOCUMENT_MAX_SIZE_MB * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getRegistrationSession({
      headers: await headers(),
    });
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 },
      );
    }
    if (
      session.user.emailVerificationStatus === "blocked_pending" &&
      session.user.emailVerificationAudience !== USER_ROLES.VENDOR
    ) {
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 },
      );
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:apply:documents",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) {
      return NextResponse.json(
        { success: false, message: "Not found" },
        { status: 404 },
      );
    }

    // This endpoint exists for the registration wizard only. Once a vendor
    // profile exists, documents go through the vendor settings screens.
    const existingVendor = await Vendor.findOne({ userId: session.user.id })
      .select("_id")
      .lean();
    if (existingVendor) {
      return NextResponse.json(
        { success: false, message: "You already have a vendor application" },
        { status: 400 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, message: "No file provided" },
        { status: 400 },
      );
    }

    const mimeType = file.type || "application/octet-stream";
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { success: false, message: "Only PDF, PNG, JPG or WebP files are allowed" },
        { status: 400 },
      );
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          message: `File is larger than ${VENDOR_DOCUMENT_MAX_SIZE_MB}MB`,
        },
        { status: 400 },
      );
    }

    const config = await getStorageConfig();
    const validation = validateUpload(config, file.size, mimeType);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, message: validation.error || "Upload rejected" },
        { status: 400 },
      );
    }

    const storage = await getStorageService();
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await storage.uploadPrivateFile(buffer, {
      fileName: file.name,
      contentType: mimeType,
      fileSize: file.size,
      // Trailing slash → the key generator appends a collision-safe
      // directory and the sanitized filename under this applicant's scope.
      customPath: vendorDocumentScope(session.user.id),
      metadata: {
        uploadedBy: session.user.id,
        originalName: file.name,
        purpose: "vendor-verification",
      },
    });

    return NextResponse.json({
      success: true,
      data: [
        {
          // Private files have no URL — the key is the stored reference.
          key: result.key,
          filename: file.name,
          mimeType,
          size: file.size,
        },
      ],
    });
  } catch (error) {
    console.error("Vendor document upload error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to upload document" },
      { status: 500 },
    );
  }
}
