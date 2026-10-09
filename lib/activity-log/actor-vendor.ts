/**
 * Which store an actor was acting for — the value stamped on an audit row as
 * `actorVendorId`, and the only thing a vendor's Activity Log is scoped on.
 *
 * - A vendor owner acts for their own store.
 * - A vendor-owned staff member acts for the one vendor that created them. They
 *   work in `/staff` against `/api/admin/*`, so the route that audits their
 *   change is an admin route and knows nothing about which vendor that is.
 * - An admin, a platform staff member, a customer and the system act for no
 *   store: an admin's change to a vendor's store is never the vendor's to see.
 *
 * Never throws. A failed lookup leaves the id empty, and an empty id shows the
 * row to admins only — the safe side — so the audit write still goes through.
 */

const OBJECT_ID = /^[0-9a-f]{24}$/i;

export async function resolveActorVendorId(
  userId: string | undefined,
  userRole: string | undefined,
): Promise<string | undefined> {
  if (!userId || !OBJECT_ID.test(userId)) return undefined;

  try {
    if (userRole === "vendor") {
      const { Vendor } = await import("@/models/vendor.model");
      const vendor = await Vendor.findOne({ userId }).select("_id").lean();
      return vendor ? String(vendor._id) : undefined;
    }

    if (userRole === "staff" || userRole === "seller") {
      const [{ StaffProfile }, { isVendorOwnedStaffProfile }] = await Promise.all([
        import("@/models/staff-profile.model"),
        import("@/lib/access/staff-ownership"),
      ]);
      const profile = await StaffProfile.findOne({ userId })
        .select("managedBy vendorIds")
        .lean();
      if (!profile || !isVendorOwnedStaffProfile(profile)) return undefined;

      const vendorIds = (profile.vendorIds ?? []) as unknown[];
      if (vendorIds.length === 1) return String(vendorIds[0]);
      if (vendorIds.length > 1) {
        // A legacy profile scoped to several vendors. Guessing one would show
        // this member's rows to the wrong store; leaving it empty shows them to
        // admins only.
        console.warn(
          `[Audit] Staff ${userId} works for ${vendorIds.length} vendors; their activity is not attributed to a store.`,
        );
      }
      return undefined;
    }
  } catch (error) {
    console.error("[Audit] Could not resolve the actor's store:", error);
  }

  return undefined;
}
