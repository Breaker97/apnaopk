import type { ContactPageData } from "@/lib/site-config/content-pages-config";

/**
 * Where the Contact page's map points, for the website's embedded map and its
 * "open the map" link, and for the app's address row. The pin when the
 * merchant set coordinates, else the address they typed for the map, else the
 * store's own address or name.
 */

function hasCoordinates(page: ContactPageData) {
  return page.mapLatitude.trim() && page.mapLongitude.trim();
}

function mapQuery(page: ContactPageData, address: string, storeName: string) {
  if (hasCoordinates(page)) {
    return `${page.mapLatitude.trim()},${page.mapLongitude.trim()}`;
  }

  return page.mapAddress.trim() || address || storeName;
}

/** The map the Contact page embeds. */
export function contactMapEmbedUrl(page: ContactPageData, address: string, storeName: string) {
  const encodedQuery = encodeURIComponent(mapQuery(page, address, storeName));

  if (
    page.mapProvider === "custom" &&
    /^https?:\/\//i.test(page.mapEmbedUrl.trim())
  ) {
    return page.mapEmbedUrl.trim();
  }

  if (page.mapProvider === "openstreetmap") {
    if (hasCoordinates(page)) {
      const lat = encodeURIComponent(page.mapLatitude.trim());
      const lon = encodeURIComponent(page.mapLongitude.trim());
      return `https://www.openstreetmap.org/export/embed.html?mlat=${lat}&mlon=${lon}&zoom=${page.mapZoom}`;
    }

    return `https://www.openstreetmap.org/search?query=${encodedQuery}`;
  }

  return `https://www.google.com/maps?q=${encodedQuery}&z=${page.mapZoom}&output=embed`;
}

/** The same place, as a page of the map's own site to open. */
export function contactMapExternalUrl(page: ContactPageData, address: string, storeName: string) {
  const encodedQuery = encodeURIComponent(mapQuery(page, address, storeName));

  if (page.mapProvider === "openstreetmap") {
    if (hasCoordinates(page)) {
      const lat = encodeURIComponent(page.mapLatitude.trim());
      const lon = encodeURIComponent(page.mapLongitude.trim());
      return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${page.mapZoom}/${lat}/${lon}`;
    }

    return `https://www.openstreetmap.org/search?query=${encodedQuery}`;
  }

  if (
    page.mapProvider === "custom" &&
    /^https?:\/\//i.test(page.mapEmbedUrl.trim())
  ) {
    return page.mapEmbedUrl.trim();
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`;
}
