import { getMobileRuntimeSettings } from "@/lib/api-next/ports";
import { androidAssetLinks } from "@/lib/settings/mobile-app-links";

/**
 * GET /.well-known/assetlinks.json: Android's proof that the shopper app may
 * open the store's links (lib/settings/mobile-app-links.ts). 404 while the
 * mobile API is off or the app's package and signing fingerprints are not set
 * (Settings → Mobile app).
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { mobileApp } = await getMobileRuntimeSettings();
  const body = androidAssetLinks(mobileApp.shop);
  if (!body) return new Response("Not found", { status: 404 });
  return Response.json(body, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
