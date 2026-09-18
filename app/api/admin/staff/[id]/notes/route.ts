import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { StaffProfile, User } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { STAFF_USER_ROLES } from "@/lib/access/staff-role";
import { isVendorOwnedStaff } from "@/lib/access/staff-ownership";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

const StaffNoteSchema = z.object({
  body: z.string().max(4000).optional(),
});

/**
 * POST /api/admin/staff/[id]/notes
 * Append a dated internal note. Notes are add-only: the standing summary in
 * `notes` is what an admin edits, these are the record of what happened.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:staff:note", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!Types.ObjectId.isValid(id)) return notFoundResponse("Staff member");

    await connectDB();

    const user = await User.findOne({
      _id: id,
      role: { $in: STAFF_USER_ROLES },
    })
      .select("_id")
      .lean();
    if (!user) return notFoundResponse("Staff member");

    if (await isVendorOwnedStaff(id)) return notFoundResponse("Staff member");

    const body = await validateBody(request, StaffNoteSchema);
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    if (!text) throw new ValidationError("Note cannot be empty");
    if (text.length > 2000) {
      throw new ValidationError("Note is too long (2000 characters max)");
    }

    const profile = await StaffProfile.findOneAndUpdate(
      { userId: id },
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
  },
);
