import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { buildDraftPreviewPath } from "@/lib/storefront/pages/preview-target";

/**
 * Friendly, admin-gated entry into the draft preview routes (the builder's
 * Preview button, its embedded panel and the per-row section frames all come
 * through here). The preview pages check the admin session again themselves —
 * this route only saves them a 404 for anonymous hits and centralizes the URL
 * construction (`buildDraftPreviewPath`). No draft-mode cookie is involved:
 * preview is a URL, not a browser state.
 */
export const GET = withApi(
  { auth: "admin", db: false },
  async ({ request }) => {
    const params = request.nextUrl.searchParams;
    const target = buildDraftPreviewPath({
      locale: params.get("locale") ?? "",
      handle: params.get("handle") ?? "home",
      // One section on its own — the builder's per-row preview frame …
      section: params.get("section") ?? "",
      // … and, inside it, ONE of its blocks — the per-row previews a block
      // list draws beside each row's own fields.
      block: params.get("block") ?? "",
    });
    // Relative redirect: behind a reverse proxy `request.nextUrl.origin` is
    // the internal host (localhost:3000), so let the browser resolve the
    // Location against whichever public origin it actually requested.
    return new NextResponse(null, {
      status: 307,
      headers: { Location: target },
    });
  },
);
