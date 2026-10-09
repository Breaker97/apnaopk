import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import { connectDB, mongoose } from "@/lib/db";
import { VendorStorePage } from "@/models/vendor-store-page.model";
import { sanitizeSectionInstances } from "@/lib/storefront/sections/instances";
import type { SectionInstance } from "@/lib/storefront/sections/types";
import {
  DEFAULT_VENDOR_PAGE_SETTINGS,
  isVendorPageSectionType,
  normalizeVendorPageSettings,
  type VendorPageSettings,
} from "@/lib/vendors/vendor-store-page";

/** Every vendor page, and one vendor's page. */
export const VENDOR_STORE_PAGES_TAG = "vendor-store-pages";
export const vendorStorePageTag = (vendorId: string) =>
  `vendor-store-page:${vendorId}`;

export interface VendorStorefrontPage {
  /** The PUBLISHED Home tab; empty when nothing is published. */
  sections: SectionInstance[];
  settings: VendorPageSettings;
}

const EMPTY_PAGE: VendorStorefrontPage = {
  sections: [],
  settings: DEFAULT_VENDOR_PAGE_SETTINGS,
};

/** Sections a vendor page may draw: stored instances of types still on offer. */
export function vendorPageSections(stored: unknown): SectionInstance[] {
  return sanitizeSectionInstances(stored).filter((section) =>
    isVendorPageSectionType(section.type),
  );
}

/**
 * What /vendors/<slug> draws from the vendor's landing page: the published
 * sections and the live page settings. Cached per vendor; a publish, an
 * unpublish or a settings save expires the vendor's own tag.
 *
 * Never throws: a vendor page is decoration on top of the store, and a failed
 * read must leave the storefront exactly as it was before the Vendor CMS.
 */
export async function getVendorStorefrontPage(
  vendorId: string,
): Promise<VendorStorefrontPage> {
  if (!mongoose.isValidObjectId(vendorId)) return EMPTY_PAGE;
  try {
    const page = await unstable_cache(
      async (): Promise<VendorStorefrontPage> => {
        await connectDB();
        const doc = await VendorStorePage.findOne({ vendorId })
          .select("published settings")
          .lean();
        if (!doc) return EMPTY_PAGE;
        return {
          sections: doc.published
            ? vendorPageSections(doc.published.sections)
            : [],
          settings: normalizeVendorPageSettings(doc.settings),
        };
      },
      ["vendor-storefront-page", vendorId],
      {
        tags: [VENDOR_STORE_PAGES_TAG, vendorStorePageTag(vendorId)],
        revalidate: 60,
      },
    )();
    // Normalized again on the way out: an entry cached before a setting
    // existed reads with that setting's default rather than without it.
    return { ...page, settings: normalizeVendorPageSettings(page.settings) };
  } catch (error) {
    console.error("Vendor landing page read failed:", error);
    return EMPTY_PAGE;
  }
}

/** Expire one vendor's cached page after a write. */
export function revalidateVendorStorePage(vendorId: string) {
  revalidateTag(vendorStorePageTag(vendorId), { expire: 0 });
}
