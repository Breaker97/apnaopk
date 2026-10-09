import * as z from "zod";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Vendor } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { validateOptionalBody } from "@/lib/api/validate";
import { audit, createAuditContext } from "@/lib/audit";
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import {
  revalidateVendorStorePage,
  vendorPageSections,
} from "@/lib/vendors/vendor-store-page-read";
import {
  VENDOR_STORE_PAGE_HISTORY_LIMIT,
  VendorStorePage,
} from "@/models/vendor-store-page.model";

/**
 * GET /api/admin/vendors/[id]/store-page
 *
 * Where one vendor's landing page (Vendor CMS) stands, for the admin's vendor
 * screen. Admins can look and unpublish; they cannot edit a vendor's page.
 */
export const GET = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendors:store-page:read", preset: "lenient" },
  },
  async ({ params }) => {
    await connectDB();
    if (!Types.ObjectId.isValid(params.id)) return notFoundResponse("Vendor");

    const [vendor, doc] = await Promise.all([
      Vendor.findById(params.id).select("slug").lean<{ slug?: string } | null>(),
      VendorStorePage.findOne({ vendorId: params.id })
        .select("published takedown updatedAt")
        .lean(),
    ]);
    if (!vendor) return notFoundResponse("Vendor");

    return successResponse({
      slug: vendor.slug ?? null,
      published: doc?.published
        ? {
            publishedAt: doc.published.publishedAt ?? null,
            sectionsCount: vendorPageSections(doc.published.sections).length,
          }
        : null,
      takedown: doc?.takedown?.at
        ? { at: doc.takedown.at, reason: doc.takedown.reason ?? "" }
        : null,
    });
  },
);

const UnpublishSchema = z.object({ reason: z.string().trim().max(500).optional() });

/**
 * POST /api/admin/vendors/[id]/store-page
 *
 * Unpublish the vendor's landing page: the store goes back to opening on its
 * Products tab at once. The live version moves to the page's history and the
 * vendor's draft is untouched, so they can fix it and publish again; their
 * editor shows that the marketplace team took it down, with the reason.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendors:store-page:unpublish" },
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ request, params, session }) => {
    await connectDB();
    if (!Types.ObjectId.isValid(params.id)) return notFoundResponse("Vendor");

    const body = await validateOptionalBody(request, UnpublishSchema);

    const vendor = await Vendor.findById(params.id)
      .select("storeName")
      .lean<{ storeName?: string } | null>();
    if (!vendor) return notFoundResponse("Vendor");

    const doc = await VendorStorePage.findOne({ vendorId: params.id })
      .select("published history")
      .lean();
    if (!doc?.published) {
      throw new ValidationError("This store has no published landing page");
    }

    const now = new Date();
    await VendorStorePage.updateOne(
      { _id: doc._id },
      {
        $set: {
          published: null,
          history: [doc.published, ...(doc.history ?? [])].slice(
            0,
            VENDOR_STORE_PAGE_HISTORY_LIMIT,
          ),
          takedown: { at: now, by: session.user.id, reason: body.reason ?? "" },
        },
      },
    );

    revalidateVendorStorePage(params.id);

    await audit(createAuditContext(request, session), {
      action: "UPDATE",
      resource: "vendor",
      resourceId: params.id,
      resourceName: vendor.storeName,
      changes: {
        summary: `Unpublished the store landing page${body.reason ? `: ${body.reason}` : ""}`,
      },
    });

    return successResponse({ published: null, takedown: { at: now, reason: body.reason ?? "" } });
  },
);
