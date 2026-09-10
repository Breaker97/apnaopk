/**
 * Pull a point out of a pasted map link.
 *
 * Deliberately free of `server-only` and of any import: the location form runs
 * the same parser as it types, so a merchant is told their link was understood
 * *before* they save, rather than discovering on the storefront that their shop
 * never appeared in a radius search. One implementation, so the two answers can
 * never disagree.
 */

/**
 * A merchant who wants an exact pin already knows how to find their shop on a
 * map; asking them to paste the URL is far less friction than an embedded map
 * picker, and it costs no third-party script, no API key, and no outbound
 * request from a self-hosted admin.
 *
 * Handles the shapes Maps actually produces, most authoritative first:
 *   .../place/X/data=!3d23.78!4d90.42 the place's own pin
 *   ...?q=23.7808,90.4217             a raw coordinate query
 *   .../@23.7808,90.4217,17z          the viewport centre
 *   23.7808, 90.4217                  coordinates pasted on their own
 *
 * Order matters: a place URL carries BOTH the pin and an `@` camera position,
 * and they are not the same point — the camera is wherever the map happened to
 * be sitting when the link was copied, which is off by a block if the user
 * panned first. Reading `@` first put shops on the wrong street.
 */
export function coordinatesFromMapsUrl(
  value: string,
): { lat: number; lng: number } | null {
  const input = value.trim();
  if (!input) return null;

  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(input);
    if (!match) continue;

    const lat = Number(match[1]);
    const lng = Number(match[2]);
    // The `!3d!4d` form is the only one that could plausibly be something else,
    // so every candidate is range-checked rather than trusted by shape. Null
    // island is rejected too: it is what a truncated or half-written link
    // produces, and it would silently place the branch in the Atlantic.
    if (
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180 &&
      !(lat === 0 && lng === 0)
    ) {
      return { lat, lng };
    }
  }

  return null;
}
