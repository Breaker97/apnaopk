import { fetchStoredFile, readCappedBody } from "@/lib/storage/fetch-stored-file";
import { appBaseUrl } from "@/lib/app-url";
import { NextResponse } from "next/server";
import { renderAppIcon } from "@/lib/pwa/pwa-icon-render";
import { parseAppIconSpec } from "@/lib/pwa/pwa-icons";
import { getStorefrontMetadataSettings } from "@/lib/storefront/storefront-metadata";

/**
 * Renders the installed-app icon at the exact size the PWA manifest advertises.
 *
 * Reads settings per request so a newly uploaded app icon takes effect without
 * a rebuild; the response itself is immutable because the manifest appends a
 * `?v=` token derived from the source URL (see `lib/pwa-icons.ts`).
 */
export const dynamic = "force-dynamic";

const NOT_FOUND = { status: 404 } as const;

/** An icon source far past this is not an icon. */
const MAX_ICON_SOURCE_BYTES = 10 * 1024 * 1024;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spec: string }> },
) {
  const spec = parseAppIconSpec((await params).spec);
  if (!spec) return new NextResponse(null, NOT_FOUND);

  const { appIconUrl } = await getStorefrontMetadataSettings();
  if (!appIconUrl) return new NextResponse(null, NOT_FOUND);

  // The source may be a storage path ("/uploads/...") or an absolute CDN URL.
  // A path resolves against the store's own address — never the request's,
  // whose Host header the caller chooses and whose answer is cached for a
  // year. Only http(s) is followed — the value is admin-supplied, and this
  // fetch runs from inside the server.
  let source: URL;
  try {
    source = new URL(appIconUrl, `${appBaseUrl()}/`);
  } catch {
    return new NextResponse(null, NOT_FOUND);
  }
  if (source.protocol !== "http:" && source.protocol !== "https:") {
    return new NextResponse(null, NOT_FOUND);
  }

  try {
    // No redirect followed, a deadline and a size cap
    // (lib/storage/fetch-stored-file.ts).
    const response = await fetchStoredFile(source, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return new NextResponse(null, NOT_FOUND);
    }

    const rendered = await renderAppIcon(
      await readCappedBody(response, MAX_ICON_SOURCE_BYTES),
      spec,
    );

    return new NextResponse(new Uint8Array(rendered), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(rendered.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    // Unreachable source or an image sharp cannot decode: report no icon rather
    // than a broken one, exactly as an unconfigured store does.
    return new NextResponse(null, NOT_FOUND);
  }
}
