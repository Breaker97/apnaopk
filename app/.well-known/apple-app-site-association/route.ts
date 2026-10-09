import { getMobileRuntimeSettings } from "@/lib/api-next/ports";
import { appleAppSiteAssociation } from "@/lib/settings/mobile-app-links";

/**
 * GET /.well-known/apple-app-site-association: which of the store's links
 * iOS opens in its shopper app (lib/settings/mobile-app-links.ts). JSON with
 * no file extension, as Apple asks; 404 while the mobile API is off or the
 * app's team and bundle id are not set (Settings → Mobile app).
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { mobileApp } = await getMobileRuntimeSettings();
  const body = appleAppSiteAssociation(mobileApp.shop);
  if (!body) return new Response("Not found", { status: 404 });
  return Response.json(body, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
