/**
 * POST /api/admin/digital-assets
 *
 * Upload digital product deliverables (ebooks, zips, license files, …) to
 * PRIVATE storage. Returns { _id, filename, storageKey, size, mimeType }
 * records the product form attaches as `digitalAssets` — no public URL ever
 * exists for these files; customers download via the order-gated route.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { digitalAssetKeyPrefix } from "@/lib/products/digital-assets";
import { uploadDigitalAssetFiles } from "@/lib/products/digital-asset-upload";

export const POST = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [
      STAFF_PERMISSIONS.CREATE_PRODUCTS,
      STAFF_PERMISSIONS.MANAGE_PRODUCTS,
    ],
    rateLimit: { action: "admin:digital-assets:upload", preset: "moderate" },
    db: false,
  },
  async ({ request }) => {
    const formData = await request.formData();
    const files = [
      ...formData.getAll("files"),
      formData.get("file"),
    ].filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, message: "No files provided" },
        { status: 400 },
      );
    }

    const { uploaded, errors } = await uploadDigitalAssetFiles(
      files,
      digitalAssetKeyPrefix(),
    );

    if (uploaded.length === 0) {
      return NextResponse.json(
        { success: false, message: "No valid files were uploaded", errors },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      data: uploaded,
      errors: errors.length > 0 ? errors : undefined,
    });
  },
);
