import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { StaffProfile } from "@/models";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError, handleApiError } from "@/lib/api/errors";
import { requireVendorStaffPermission } from "@/lib/access/vendor-staff-guard";
import { VENDOR_OWNED_STAFF_FILTER } from "@/lib/access/staff-ownership";
import { getDemoModeMutationResponse } from "@/lib/demo-mode";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const StaffNoteSchema = z.object({
  body: z.string().max(4000).optional(),
});

/**
 * POST /api/vendor/staff/[id]/notes
 * Append a dated internal note to a staff member this vendor owns.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { session, vendor } = await requireVendorStaffPermission(
      request,
      [
        VENDOR_PERMISSIONS.EDIT_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
      ],
      "vendor:staff:note",
      "moderate",
    );

    const demoBlock = getDemoModeMutationResponse();
    if (demoBlock) return demoBlock;

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return notFoundResponse("Staff member");

    const body = await validateBody(request, StaffNoteSchema);
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    if (!text) throw new ValidationError("Note cannot be empty");
    if (text.length > 2000) {
      throw new ValidationError("Note is too long (2000 characters max)");
    }

    const profile = await StaffProfile.findOneAndUpdate(
      { userId: id, vendorIds: vendor._id, ...VENDOR_OWNED_STAFF_FILTER },
      {
        $push: {
          noteEntries: {
            body: text,
            authorId: session.user.id,
            authorEmail: session.user.email,
            createdAt: new Date(),
          },
        },
      },
      { returnDocument: "after" },
    ).lean();

    if (!profile) return notFoundResponse("Staff member");

    return successResponse({ noteEntries: profile.noteEntries || [] });
  } catch (error) {
    return handleApiError(error);
  }
}
