import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { audit, createAuditContext } from "@/lib/audit";
import {
  CACHE_TAGS,
  revalidateCacheTags,
  revalidateLocalizedPaths,
} from "@/lib/cache-invalidation";
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import { resolveAdminPageRef } from "@/lib/storefront/pages/handles";
import { sectionsEqual } from "@/lib/storefront/pages/lifecycle";
import {
  prepareSectionsForWrite,
  SectionWriteError,
} from "@/lib/storefront/sections/write";
import { buildStorePageIdentity, StorePage } from "@/models/store-page.model";
import { z } from "zod";
import { validateOptionalBody } from "@/lib/api/validate";

/**
 * Draft autosave for a store page. Deliberately NOT audited — the
 * storefront-affecting acts (publish, discard, delete) are; logging every
 * debounced keystroke batch would bury them.
 *
 * The home page is upserted on first save (until its first publish the
 * storefront keeps rendering the legacy settings config). Landing pages
 * must already exist — they are created explicitly via the collection
 * route, never as a side effect of typing.
 */
// The sections themselves are validated by prepareSectionsForWrite below.
const StorePageSectionsSchema = z.object({ sections: z.unknown().optional() });

export const PATCH = withApi<{ handle: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:store-pages:save" },
    // A demo visitor may rearrange the builder all they like; nothing about
    // the storefront may actually change.
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ request, session, params }) => {
    const ref = resolveAdminPageRef(params.handle);
    if (!ref) {
      throw new ValidationError("Invalid page handle");
    }

    const body = await validateOptionalBody(request, StorePageSectionsSchema);

    let sections;
    try {
      sections = prepareSectionsForWrite(body.sections, {
        templateType:
          ref.parsed.kind === "template" ? ref.parsed.templateType : undefined,
        zone: ref.parsed.kind === "group" ? ref.parsed.group : undefined,
      });
    } catch (error) {
      if (error instanceof SectionWriteError) {
        throw new ValidationError(error.message);
      }
      throw error;
    }

    const now = new Date();
    const draft = { sections, updatedAt: now, updatedBy: session.user.id };

    // Template pages and chrome groups are upserted on first save (the
    // storefront keeps rendering their built-in defaults until a first
    // publish). Landing pages must already exist — they are created
    // explicitly via the collection route, never as a side effect of typing.
    const upsertTitle =
      ref.parsed.kind === "template"
        ? ref.parsed.templateType.charAt(0).toUpperCase() +
          ref.parsed.templateType.slice(1)
        : ref.parsed.kind === "group"
          ? ref.parsed.group.charAt(0).toUpperCase() + ref.parsed.group.slice(1)
          : null;
    const doc =
      upsertTitle !== null
        ? await StorePage.findOneAndUpdate(
            { key: ref.key },
            {
              $set: { draft },
              $setOnInsert: {
                ...buildStorePageIdentity(ref.key),
                title: upsertTitle,
                published: null,
                history: [],
              },
            },
            { new: true, upsert: true },
          ).lean()
        : await StorePage.findOneAndUpdate(
            { key: ref.key },
            { $set: { draft } },
            { new: true },
          ).lean();

    if (!doc) {
      throw new NotFoundError("Page not found — create it first");
    }

    return successResponse({
      draftUpdatedAt: now.toISOString(),
      isPublished: Boolean(doc.published),
      hasUnpublishedChanges: !sectionsEqual(sections, doc.published?.sections),
    });
  },
);

/** Delete a landing page. The home page is not deletable — only rebuilt. */
export const DELETE = withApi<{ handle: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:store-pages:delete" },
    // A demo visitor may rearrange the builder all they like; nothing about
    // the storefront may actually change.
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ request, session, params }) => {
    const ref = resolveAdminPageRef(params.handle);
    if (!ref || ref.parsed.kind !== "landing") {
      throw new ValidationError("This page cannot be deleted");
    }
    const { handle } = ref.parsed;

    const doc = await StorePage.findOneAndDelete({ key: ref.key }).lean();
    if (!doc) {
      throw new NotFoundError("Page not found");
    }

    revalidateCacheTags([CACHE_TAGS.storePages]);
    revalidateLocalizedPaths([`/pages/${handle}`]);

    await audit(createAuditContext(request, session), {
      action: "DELETE",
      resource: "storePage",
      resourceId: String(doc._id),
      resourceName: handle,
      changes: { summary: `Deleted landing page /pages/${handle}` },
    });

    return successResponse({ deleted: true });
  },
);
