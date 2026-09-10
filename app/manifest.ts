import type { MetadataRoute } from "next";
import { appConfig } from "@/config/app.config";
import {
  APP_ICON_MANIFEST_SPECS,
  appIconPath,
  appIconVersion,
} from "@/lib/pwa/pwa-icons";
import { getStorefrontMetadataSettings } from "@/lib/storefront/storefront-metadata";

// Read store settings per request so the installed-app name and icon
// (the "Open in app" / Add-to-Home-Screen icon) always come from the
// admin-configured branding. The app ships no bundled icon to fall back on.
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { storeName, storeDescription, appIconUrl } =
    await getStorefrontMetadataSettings();

  // Icons are served by `app/app-icon/[spec]/route.ts`, which resizes the
  // configured source to the exact advertised dimensions. Chrome downloads the
  // image and measures it before deciding a site is installable, so pointing
  // straight at the uploaded file — typically a 32px favicon — silently
  // disqualifies the whole app. With nothing configured the manifest declares
  // no icons at all and the platform draws its own generic placeholder, never
  // this app's branding.
  const version = appIconUrl ? appIconVersion(appIconUrl) : undefined;
  const icons: MetadataRoute.Manifest["icons"] = version
    ? APP_ICON_MANIFEST_SPECS.map((spec) => ({
        src: appIconPath(spec, version),
        sizes: `${spec.size}x${spec.size}`,
        type: "image/png",
        purpose: spec.purpose,
      }))
    : undefined;

  const shortcutIcons = version
    ? [
        {
          src: appIconPath({ size: 192, purpose: "any" }, version),
          sizes: "192x192",
          type: "image/png",
        },
      ]
    : undefined;

  return {
    id: "/",
    name: storeName,
    short_name: storeName,
    description: storeDescription || appConfig.description,
    // Left locale-less on purpose: "/" lets the proxy honour the visitor's own
    // NEXT_LOCALE cookie, where a resolved "/en" would pin the installed app to
    // one language.
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "browser"],
    background_color: "#ffffff",
    theme_color: "#111111",
    orientation: "any",
    categories: ["shopping", "business", "productivity"],
    ...(icons ? { icons } : {}),
    shortcuts: [
      {
        name: "Orders",
        short_name: "Orders",
        url: "/admin/orders",
        ...(shortcutIcons ? { icons: shortcutIcons } : {}),
      },
      {
        name: "POS",
        short_name: "POS",
        url: "/admin/pos",
        ...(shortcutIcons ? { icons: shortcutIcons } : {}),
      },
    ],
  };
}
