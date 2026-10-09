import { NextResponse } from "next/server";
import { defaultLocale, isValidLocale } from "@/config/i18n.config";
import { withApi } from "@/lib/api/handler";
import { buildVendorPreviewPath } from "@/lib/vendors/vendor-store-page";

/**
 * Entry into the vendor's draft preview (the builder's Preview button, its
 * live panel and the per-row section frames). The preview pages check the
 * vendor again themselves; this route only builds the URL and spares an
 * anonymous hit a page render.
 */
export const GET = withApi({ auth: "user", db: false }, async ({ request }) => {
  const params = request.nextUrl.searchParams;
  const locale = params.get("locale") ?? "";
  const target = buildVendorPreviewPath({
    locale: isValidLocale(locale) ? locale : defaultLocale,
    section: params.get("section") ?? "",
    block: params.get("block") ?? "",
  });
  // Relative redirect, as the admin's: behind a proxy the request origin is
  // the internal host.
  return new NextResponse(null, { status: 307, headers: { Location: target } });
});
