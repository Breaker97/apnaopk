import { NextResponse } from "next/server";
import { getStorefrontMetadataSettings } from "@/lib/storefront/storefront-metadata";

/**
 * `/favicon.ico` is requested blind — browsers, and link-preview crawlers like
 * WhatsApp/Slack/Telegram, ask for it whether or not the page declares an icon.
 * The app ships no file at this path on purpose, so the request is answered
 * from settings: redirect to the admin-configured favicon, or 404 when none is
 * configured. That is what keeps a buyer's storefront from ever showing this
 * app's own icon in a shared link.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { faviconUrl } = await getStorefrontMetadataSettings();

  if (!faviconUrl) {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "public, max-age=0, s-maxage=60" },
    });
  }

  // `faviconUrl` may be a storage path ("/uploads/...") or an absolute CDN URL;
  // resolving against the request URL covers both.
  let target: URL;
  try {
    target = new URL(faviconUrl, request.url);
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.redirect(target, {
    status: 307,
    headers: { "Cache-Control": "public, max-age=0, s-maxage=60" },
  });
}
