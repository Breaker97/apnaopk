import { ConflictError, ValidationError } from "@/lib/api/errors";
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
import { buildPublishState } from "@/lib/storefront/pages/lifecycle";
import {
  prepareSectionsForWrite,
  SectionWriteError,
} from "@/lib/storefront/sections/write";
import { StorePage } from "@/models/store-page.model";

/**
 * Publish a page's draft: previous published snapshot moves to the front of
 * history (capped), draft becomes published, storefront caches revalidate.
 * One document update — a publish can never half-happen.
 *
 * For the home page the FIRST publish is also the cutover moment: from then
 * on the storefront renders this document instead of the legacy settings
 * config.
 */
export const POST = withApi<{ handle: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:store-pages:publish" },
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

    // Read → validate → CONDITIONAL write: the update only lands if the
    // draft is still the one we validated (matched by its updatedAt), so a
    // concurrent autosave can never be silently reverted to an older copy.
    // On a lost race we re-read and try again with the newer draft.
    let published;
    let sections;
    let docId = "";
    for (let attempt = 0; ; attempt += 1) {
      const doc = await StorePage.findOne({ key: ref.key }).lean();
      if (!doc?.draft || !Array.isArray(doc.draft.sections)) {
        throw new ValidationError("There is no draft to publish yet");
      }

      // Defensive re-validation: the draft was validated when saved, but the
      // document is reachable by other writers (scripts, manual edits).
      try {
        sections = prepareSectionsForWrite(doc.draft.sections, {
          templateType:
            ref.parsed.kind === "template"
              ? ref.parsed.templateType
              : undefined,
          zone: ref.parsed.kind === "group" ? ref.parsed.group : undefined,
        });
      } catch (error) {
        if (error instanceof SectionWriteError) {
          throw new ValidationError(
            `Draft failed validation: ${error.message}`,
          );
        }
        throw error;
      }

      const now = new Date();
      const state = buildPublishState(
        sections,
        doc.published && Array.isArray(doc.published.sections)
          ? {
              sections: doc.published.sections as typeof sections,
              publishedAt: doc.published.publishedAt,
              publishedBy: doc.published.publishedBy,
            }
          : null,
        (doc.history ?? []) as {
          sections: typeof sections;
          publishedAt?: Date;
          publishedBy?: string;
        }[],
        session.user.id,
        now,
      );
      published = state.published;
      docId = String(doc._id);

      const draftUpdatedAt = doc.draft.updatedAt;
      const result = await StorePage.updateOne(
        {
          _id: doc._id,
          // Pre-CAS documents (e.g. hand-seeded) may lack the stamp; for
          // them the guard degrades to the old unconditional write.
          ...(draftUpdatedAt ? { "draft.updatedAt": draftUpdatedAt } : {}),
        },
        {
          $set: {
            published,
            history: state.history,
            // Re-aligned so the dirty check (draft vs published) reads clean.
            "draft.sections": sections,
          },
        },
      );
      if (result.modifiedCount > 0) break;
      if (attempt >= 2) {
        throw new ConflictError(
          "The draft changed while publishing — try again",
        );
      }
    }

    revalidateCacheTags([CACHE_TAGS.storePages]);
    // Fixed-path surfaces revalidate directly; per-resource templates
    // (product, category, collection) refresh through the storePages tag
    // their fetchers carry.
    if (ref.parsed.kind === "landing") {
      revalidateLocalizedPaths([`/pages/${ref.parsed.handle}`]);
    } else if (ref.parsed.kind === "template") {
      const path = { home: "/", products: "/products", cart: "/cart" }[
        ref.parsed.templateType as string
      ];
      if (path) revalidateLocalizedPaths([path]);
    } else if (ref.parsed.kind === "group") {
      // Chrome renders on every page; the tag reaches the layout's fetcher
      // and the home path covers the most-cached entry point.
      revalidateLocalizedPaths(["/"]);
    }

    await audit(createAuditContext(request, session), {
      action: "UPDATE",
      resource: "storePage",
      resourceId: docId,
      resourceName: handle,
      changes: {
        summary: `Published ${ref.parsed.kind === "landing" ? `/pages/${ref.parsed.handle}` : `${handle} page`} (${sections.length} sections)`,
      },
    });

    return successResponse({
      publishedAt: published?.publishedAt?.toISOString() ?? new Date().toISOString(),
      isPublished: true,
      hasUnpublishedChanges: false,
    });
  },
);
