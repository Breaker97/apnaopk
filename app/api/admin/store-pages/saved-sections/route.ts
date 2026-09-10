import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { createdResponse, successResponse } from "@/lib/api/response";
import { auditCreate, createAuditContext } from "@/lib/audit";
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import { sanitizeSectionInstances } from "@/lib/storefront/sections/instances";
import {
  prepareSectionsForWrite,
  SectionWriteError,
} from "@/lib/storefront/sections/write";
import {
  SAVED_SECTION_LIMIT,
  SavedSection,
} from "@/models/saved-section.model";
import { z } from "zod";
import { validateOptionalBody } from "@/lib/api/validate";

/**
 * The saved-sections library. Entries are inserted back into pages as
 * copies with fresh ids, so the list can stay small and deletable without
 * ever breaking a page.
 */
const SaveSectionSchema = z.object({
  name: z.string().max(200).optional(),
  section: z.unknown().optional(),
});

export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:saved-sections:list", preset: "lenient" },
  },
  async () => {
    const items = await SavedSection.find({})
      .sort({ updatedAt: -1 })
      .limit(SAVED_SECTION_LIMIT)
      .lean();

    return successResponse(
      items.flatMap((item) => {
        // Salvage on read: an entry saved by a newer deploy (or hand-edited)
        // that no longer parses is skipped, not fatal.
        const [section] = sanitizeSectionInstances([item.section]);
        if (!section) return [];
        return [
          {
            _id: String(item._id),
            name: item.name,
            section,
            updatedAt: item.updatedAt,
          },
        ];
      }),
    );
  },
);

export const POST = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:saved-sections:create" },
    // A demo visitor may rearrange the builder all they like; nothing about
    // the storefront may actually change.
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ request, session }) => {
    const body = await validateOptionalBody(request, SaveSectionSchema);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) {
      throw new ValidationError("A name (max 80 characters) is required");
    }

    // The list endpoint shows at most SAVED_SECTION_LIMIT entries; letting
    // the collection grow past it would mint invisible, undeletable ghosts.
    const count = await SavedSection.countDocuments();
    if (count >= SAVED_SECTION_LIMIT) {
      throw new ValidationError(
        `The library is full (${SAVED_SECTION_LIMIT}) — delete entries you no longer need first`,
      );
    }

    let section;
    try {
      [section] = prepareSectionsForWrite([body?.section], {
        purpose: "library",
      });
    } catch (error) {
      if (error instanceof SectionWriteError) {
        throw new ValidationError(error.message);
      }
      throw error;
    }

    const saved = await SavedSection.create({
      name,
      section,
      createdBy: session.user.id,
    });

    await auditCreate(
      createAuditContext(request, session),
      "storePage",
      String(saved._id),
      { name, type: section.type },
      `saved-section:${name}`,
    );

    return createdResponse({
      _id: String(saved._id),
      name,
      section,
      updatedAt: saved.updatedAt,
    });
  },
);
