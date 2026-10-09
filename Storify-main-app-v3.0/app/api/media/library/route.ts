/**
 * GET /api/media/library
 * The stored files the caller may pick from, a page at a time: the admin
 * Media Library, the slider background picker and the product media picker
 * all read it. What "the library" is depends on who asks — the store's whole
 * library for an admin, a vendor's own folder for a vendor — and is decided
 * from the session alone (resolveMediaLibraryScope). Uploads go through
 * POST /api/upload, deletion through DELETE /api/upload.
 */

import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { AuthorizationError } from "@/lib/api/errors";
import { validateQuery } from "@/lib/api/validate";
import {
  listMediaLibrary,
  MEDIA_LIBRARY_KINDS,
} from "@/lib/storage/media-library";
import { resolveMediaLibraryScope } from "@/lib/storage/upload-scope";

const LibraryQuerySchema = z.object({
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** One kind or a comma-separated list, e.g. `image,video,model`. */
  kind: z
    .string()
    .transform((value) => value.split(",").map((kind) => kind.trim()))
    .pipe(z.array(z.enum(MEDIA_LIBRARY_KINDS)))
    .optional(),
  q: z.string().max(200).optional(),
});

export const GET = withApi(
  {
    auth: "user",
    // Every page is a bucket listing — a billed operation on R2 and S3.
    rateLimit: { action: "media:library", preset: "lenient" },
  },
  async ({ request, session }) => {
    const scope = await resolveMediaLibraryScope(session.user);
    if (!scope) {
      throw new AuthorizationError(
        "Your account cannot browse the media library",
      );
    }

    const { cursor, limit, kind, q } = validateQuery(
      request,
      LibraryQuerySchema,
    );
    const page = await listMediaLibrary({
      ownerScope: scope.ownerScope,
      cursor,
      limit,
      kinds: kind,
      query: q,
    });

    // Which provider backs the store is the store's business; a vendor
    // browsing their own folder is shown files, not infrastructure.
    return successResponse(
      scope.ownerScope
        ? { files: page.files, nextCursor: page.nextCursor }
        : page,
    );
  },
);
