import "server-only";

import { headers } from "next/headers";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { auth } from "@/lib/auth/auth";
import { hasVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { connectDB } from "@/lib/db";
import type { SectionInstance } from "@/lib/storefront/sections/types";
import {
  normalizeVendorPageSettings,
  type VendorPageSettings,
} from "@/lib/vendors/vendor-store-page";
import { vendorPageSections } from "@/lib/vendors/vendor-store-page-read";
import { VendorStorePage } from "@/models/vendor-store-page.model";

export interface VendorPagePreview {
  vendorId: string;
  slug: string;
  /** The DRAFT (or, before the first save, the published page). */
  sections: SectionInstance[];
  settings: VendorPageSettings;
}

/**
 * The signed-in vendor's own draft, for the preview routes. Null for anyone
 * else — no session, no vendor, no permission to see store settings — and
 * the routes answer 404, so the preview URLs reveal nothing. The vendor is
 * always the session's own: no preview takes a vendor from the URL.
 */
export async function loadVendorPagePreview(): Promise<VendorPagePreview | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;
  if (
    !(await hasVendorPermission(
      session.user,
      VENDOR_PERMISSIONS.VIEW_STORE_SETTINGS,
    ))
  ) {
    return null;
  }

  await connectDB();
  let vendor;
  try {
    vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });
  } catch {
    return null;
  }

  const doc = await VendorStorePage.findOne({ vendorId: vendor._id })
    .select("draft published settings")
    .lean();
  const stored = Array.isArray(doc?.draft?.sections)
    ? doc.draft.sections
    : doc?.published?.sections;

  return {
    vendorId: String(vendor._id),
    slug: vendor.slug,
    sections: vendorPageSections(stored ?? []),
    settings: normalizeVendorPageSettings(doc?.settings),
  };
}
