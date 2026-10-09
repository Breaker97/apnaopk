import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { audit, createAuditContext } from "@/lib/audit";
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import { resolveAdminPageRef } from "@/lib/storefront/pages/handles";
import { sanitizeSectionInstances } from "@/lib/storefront/sections/instances";
import { StorePage } from "@/models/store-page.model";

/** Throw away unpublished edits: copy the published sections back to draft. */
export const POST = withApi<{ handle: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:store-pages:discard" },
    // A demo visitor may rearrange the builder all they like; nothing about
    // the storefront may actually change.
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ request, session, params }) => {
    const { handle } = params;
    const ref = resolveAdminPageRef(handle);
    if (!ref) {
      throw new ValidationError("Invalid page handle");
    }

    const doc = await StorePage.findOne({ key: ref.key })
      .select("published")
      .lean();
    if (!doc?.published || !Array.isArray(doc.published.sections)) {
      throw new ValidationError(
        "Nothing published to restore — publish first or keep editing",
      );
    }

    const sections = sanitizeSectionInstances(doc.published.sections);
    const now = new Date();
    await StorePage.updateOne(
      { _id: doc._id },
      {
        $set: {
          draft: { sections, updatedAt: now, updatedBy: session.user.id },
        },
      },
    );

    await audit(createAuditContext(request, session), {
      action: "UPDATE",
      resource: "storePage",
      resourceId: String(doc._id),
      resourceName: handle,
      changes: { summary: `Discarded draft for ${handle}` },
    });

    return successResponse({
      sections,
      isPublished: true,
      hasUnpublishedChanges: false,
    });
  },
);
