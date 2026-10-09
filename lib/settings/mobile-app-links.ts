import { APP_LINK_PATTERNS } from "@/contracts/mobile/shop/v1/links";
import type { MobileShopAppSettings } from "@/lib/settings/mobile-app";

/**
 * The two files that let the store's own links open in its shopper app
 * instead of the browser: Apple's apple-app-site-association and
 * Android's assetlinks.json, served under /.well-known/ from Settings →
 * Mobile app. Each is null — and its route answers 404 — while the mobile API
 * is off or the app's identity is not filled in.
 */

/**
 * The paths the app claims: the link table's (contracts … links.ts), with and
 * without a language in front ("/products/*" and "/??/products/*" — every
 * store language is two letters). Anything else stays on the website.
 */
function claimedPaths(): string[] {
  const paths: string[] = [];
  for (const pattern of APP_LINK_PATTERNS) {
    const path = pattern.replace(/:[^/]+/g, "*");
    if (path === "/") {
      paths.push("/", "/??", "/??/");
    } else {
      paths.push(path, `/??${path}`);
    }
  }
  return paths;
}

export function appleAppSiteAssociation(shop: MobileShopAppSettings) {
  const { teamId, bundleId } = shop.ios;
  if (!shop.enabled || !teamId || !bundleId) return null;
  const appId = `${teamId}.${bundleId}`;
  return {
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: claimedPaths().map((path) => ({ "/": path })),
        },
      ],
    },
    // The website's saved passwords offered in the app's sign-in.
    webcredentials: { apps: [appId] },
  };
}

export function androidAssetLinks(shop: MobileShopAppSettings) {
  const { packageName, sha256CertFingerprints } = shop.android;
  if (!shop.enabled || !packageName || sha256CertFingerprints.length === 0) return null;
  return [
    {
      relation: [
        "delegate_permission/common.handle_all_urls",
        // The website's saved passwords offered in the app's sign-in.
        "delegate_permission/common.get_login_creds",
      ],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: sha256CertFingerprints,
      },
    },
  ];
}
