import { MetadataRoute } from "next";
import { resolveStorefrontBaseUrl } from "@/lib/storefront/storefront-metadata";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = resolveStorefrontBaseUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Paths listed here are never fetched, so a `noindex` on them is never
        // read either — which is why the auth pages are deliberately absent.
        // They carry `robots: { index: false }` from the locale layout instead,
        // and a crawler has to be allowed in to see it.
        disallow: [
          "/api/",
          "/admin/",
          "/vendor/",
          "/staff/",
          "/checkout",
          "/cart",
          "/account",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
