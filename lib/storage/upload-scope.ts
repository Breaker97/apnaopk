import "server-only";

import { connectDB } from "@/lib/db";
import { Vendor } from "@/models";
import { isVendor } from "@/lib/access/rbac";
import type { UserRole } from "@/config/app.config";
import { vendorMediaScope } from "@/lib/storage/key";

/**
 * Resolve the owner scope for an upload from the signed-in user.
 *
 * A marketplace that stores every vendor's media in one flat date tree cannot
 * answer the questions it eventually has to answer: how much space is this
 * vendor using, what do we bill them, and what do we delete when they leave.
 * Scoping the key at write time is the only cheap moment to fix that — once
 * the objects exist, attributing them means walking the whole catalogue.
 *
 * Derived here, on the server, from the session. The client's `customPath` is
 * validated for shape but not ownership, so it can never be the source of this
 * value: a vendor could otherwise file uploads under a rival's prefix.
 *
 * Returns undefined for admins and customers — their uploads (store branding,
 * review photos, avatars) belong to the store, not to a vendor, and keeping
 * them unscoped leaves the existing key layout untouched.
 *
 * The role check is what makes that true, and it is not just an optimization.
 * In single-vendor mode the admin owns the default vendor record, so looking
 * the caller up by userId alone filed the store's own logo and banners under
 * `vendor/<default vendor id>/` — the opposite of what this promises. It also
 * spends a query per upload on customers, who can never have one.
 */
export async function resolveUploadScope(user: {
  id: string;
  role?: string | null;
}): Promise<string | undefined> {
  // The session carries `role` as a plain string; narrowing it here is the
  // same boundary cast the vendor routes make before reaching for rbac.
  if (!user?.id || !isVendor({ id: user.id, role: user.role as UserRole }))
    return undefined;

  await connectDB();
  const vendor = await Vendor.findOne({ userId: user.id })
    .select("_id")
    .lean<{ _id: unknown } | null>();

  if (!vendor?._id) return undefined;
  return vendorMediaScope(String(vendor._id)) || undefined;
}
