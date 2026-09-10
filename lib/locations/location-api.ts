import "server-only";

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import {
  resolveLocationScope,
  type InventoryLocationScope,
} from "@/lib/inventory/inventory-location-scope";
import { ApiError } from "@/lib/api/errors";
import {
  coordinatesFromMapsUrl,
  inheritedVendorGeo,
} from "@/lib/locations/location-geo";
import { vendorGeoPoint } from "@/lib/locations/vendor-geo";

/**
 * Shared request handling for the inventory-location endpoints.
 *
 * These lived in `app/api/admin/locations/route.ts` and were imported from the
 * `[id]` route next to it. A `route.ts` may only export HTTP handlers and the
 * framework's own config keys, so every extra export there fails the generated
 * route types — `Property 'requireScope' is incompatible with index signature`,
 * which breaks `next build` rather than anything at runtime. Moving them out is
 * the fix; sharing them between the two routes was always the intent.
 */

type ScopedSession = {
  user: { id: string; role?: string | null; roles?: (string | null)[] | null };
};

export async function requireScope(
  mode: "read" | "write",
): Promise<
  | { ok: true; scope: InventoryLocationScope }
  | { ok: false; response: NextResponse }
> {
  const session = (await auth.api.getSession({
    headers: await headers(),
  })) as ScopedSession | null;

  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 },
      ),
    };
  }

  try {
    return { ok: true, scope: await resolveLocationScope(session.user, mode) };
  } catch (error) {
    const status = error instanceof ApiError ? error.statusCode : 403;
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          message:
            error instanceof ApiError
              ? error.message
              : "You do not have permission to manage locations",
        },
        { status },
      ),
    };
  }
}

/**
 * A collection point needs somewhere to send people.
 *
 * `lib/pickup-locations.ts` silently drops an address-less branch at checkout,
 * so one saved without an address is a shop that appears in "pickup near me"
 * and then offers no pickup at all. Refusing the save is the only place that
 * mismatch can be prevented rather than papered over.
 */
export function pickupAddressError(
  body: Record<string, unknown>,
  fallbackAddress?: string,
): string | null {
  if (!body.pickupEnabled) return null;

  const address =
    typeof body.address === "string" ? body.address : (fallbackAddress ?? "");
  return address.trim()
    ? null
    : "Add the address customers should collect from, or turn off collection";
}

/**
 * The collection-facing fields, normalised.
 *
 * Only carried when the place actually admits the public: a warehouse must not
 * end up holding collection copy that could later be published if someone flips
 * the toggle without reviewing it.
 */
export function pickupFieldsFromBody(body: Record<string, unknown>) {
  const pickupEnabled = Boolean(body.pickupEnabled);
  if (!pickupEnabled) {
    return {
      pickupEnabled: false,
      pickupArea: "",
      instructions: "",
      weeklyHours: [],
    };
  }

  const hours = Array.isArray(body.weeklyHours) ? body.weeklyHours : [];
  return {
    pickupEnabled: true,
    pickupArea: String(body.pickupArea ?? "").trim().slice(0, 160),
    instructions: String(body.instructions ?? "").trim().slice(0, 1000),
    weeklyHours: hours
      .filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object",
      )
      .map((entry) => ({
        weekday: Number(entry.weekday) || 0,
        enabled: Boolean(entry.enabled),
        start: String(entry.start ?? "").slice(0, 5),
        end: String(entry.end ?? "").slice(0, 5),
      }))
      .filter((entry) => entry.weekday >= 0 && entry.weekday <= 6)
      .slice(0, 7),
  };
}

/**
 * The dispatch-facing fields, normalised.
 *
 * Only what the body actually carried: a client editing a branch's opening
 * hours sends neither of these, and defaulting a missing `fulfillsOnlineOrders`
 * to false would silently take that branch out of the dispatch order — the
 * merchant would find orders coming from the wrong shop with nothing on screen
 * to explain it.
 */
export function dispatchFieldsFromBody(body: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};

  if ("fulfillsOnlineOrders" in body) {
    fields.fulfillsOnlineOrders = Boolean(body.fulfillsOnlineOrders);
  }
  if ("fulfillmentPriority" in body) {
    const priority = Number(body.fulfillmentPriority);
    // Clamped rather than rejected: this arrives from a drag-to-reorder list,
    // where an out-of-range value is a client bug, not something a merchant
    // needs an error message about.
    fields.fulfillmentPriority = Number.isFinite(priority)
      ? Math.max(0, Math.min(999, Math.trunc(priority)))
      : 0;
  }

  return fields;
}

/**
 * The counter capability, normalised.
 *
 * Separate from `dispatchFieldsFromBody` because it answers a different
 * question — who may sell here, not where an order ships from — and follows the
 * same "only what the body carried" rule for the same reason: a client saving a
 * branch's opening hours sends neither field, and defaulting a missing one to
 * false would quietly take that branch off every register with nothing on
 * screen to explain where it went.
 */
export function counterFieldsFromBody(body: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};

  if ("sellsAtCounter" in body) {
    fields.sellsAtCounter = Boolean(body.sellsAtCounter);
  }

  return fields;
}

/**
 * The point this branch is found by, from the cheapest source that has one.
 *
 * An explicit map link wins, because a merchant who pasted one is telling us
 * their counter is not at their registered address. Otherwise the vendor's own
 * geocoded address is inherited, which is right for the one-shop store that
 * will never open this field.
 *
 * `mapsUrl` comes back alongside the point so the caller can persist exactly
 * what produced it: an unparseable link is stored as empty rather than kept
 * around to be re-tried on every later save.
 */
export async function resolveLocationGeo(
  body: Record<string, unknown>,
  vendorId: string,
  fallbackMapsUrl?: string,
) {
  // `??` not `||`: an empty string is a merchant clearing the field, and must
  // not fall through to the stored link they just deleted.
  const pasted =
    typeof body.mapsUrl === "string" ? body.mapsUrl : (fallbackMapsUrl ?? "");
  const point = coordinatesFromMapsUrl(pasted);
  if (point) {
    return {
      mapsUrl: pasted.trim().slice(0, 500),
      geo: vendorGeoPoint({ coordinates: point }),
    };
  }

  return { mapsUrl: "", geo: await inheritedVendorGeo(vendorId) };
}
