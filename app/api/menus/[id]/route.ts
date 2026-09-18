import mongoose from "mongoose";
import { Menu } from "@/models";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { UpdateMenuSchema } from "@/lib/validations";
import { formatMenuValidationErrors } from "@/lib/site-config/menu-validation-errors";
import { MAX_MEGA_MENU_DEPTH, trimMenuTreeDepth } from "@/lib/site-config/menu-depth";
import { revalidateMenuContent } from "@/lib/cache-invalidation";
import { withApi } from "@/lib/api/handler";
import { pickSubmittedKeys } from "@/lib/api/validate";
import { slugify } from "@/lib/strings";

// System menus wired into the storefront — editable, but never deletable.
const PROTECTED_MENU_HANDLES = new Set(["main-header", "main-mega-menu"]);

function getMenuLookup(key: string) {
  const decoded = decodeURIComponent(key).trim();
  if (mongoose.Types.ObjectId.isValid(decoded)) {
    return { _id: decoded };
  }

  const handle = slugify(decoded);
  if (!handle) {
    throw new ValidationError("Invalid menu id or handle");
  }

  return { handle };
}

export const GET = withApi<{ id: string }>(
  {},
  async ({ params }) => {
    const { id } = params;
    const menu = await Menu.findOne(getMenuLookup(id)).lean();
    if (!menu) throw new NotFoundError("Menu");
    return successResponse(menu);
  },
);

export const PUT = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params }) => {
    const { id } = params;
    const lookup = getMenuLookup(id);
    const currentMenu = await Menu.findOne(lookup)
      .select("_id location")
      .lean();
    if (!currentMenu) throw new NotFoundError("Menu");

    const body = await request.json();
    const parsed = UpdateMenuSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatMenuValidationErrors(parsed.error));
    }
    // Only write back what the caller sent — `.partial()` keeps the
    // base schema's `.default()` values, which would otherwise overwrite
    // untouched fields on a partial update.
    const data = pickSubmittedKeys(body, parsed.data);
    const finalLocation = data.location || currentMenu.location;
    if (finalLocation === "header-mega" && Array.isArray(data.items)) {
      data.items = trimMenuTreeDepth(data.items, MAX_MEGA_MENU_DEPTH).items;
    }
    if (data.handle || data.name) {
      const candidate = slugify(data.handle || data.name || "");
      if (candidate) {
        const exists = await Menu.findOne({
          handle: candidate,
          _id: { $ne: currentMenu._id },
        });
        data.handle = exists ? `${candidate}-${Date.now()}` : candidate;
      }
    }
    const menu = await Menu.findOneAndUpdate(
      lookup,
      { $set: data },
      { returnDocument: "after" },
    ).lean();
    if (!menu) throw new NotFoundError("Menu");
    revalidateMenuContent();
    return successResponse(menu);
  },
);

export const DELETE = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ params }) => {
    const { id } = params;
    const menu = await Menu.findOne(getMenuLookup(id)).select("handle").lean();
    if (!menu) throw new NotFoundError("Menu");
    if (PROTECTED_MENU_HANDLES.has(menu.handle)) {
      throw new ValidationError(
        "This menu is managed by the system and cannot be deleted.",
      );
    }
    await Menu.findByIdAndDelete(menu._id);
    revalidateMenuContent();
    return successResponse({ deleted: true });
  },
);
