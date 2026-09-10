import { Suspense } from "react";
import { POSWorkspace } from "@/components/pos/pos-workspace";
import { POSPageSkeleton } from "@/components/pos/pos-skeleton";
import {
  listPOSProducts,
  type POSProductListUser,
} from "@/lib/pos/list-products";
import { listPOSLocations } from "@/lib/pos/list-locations";
import { resolvePOSLocationId } from "@/lib/pos/resolve-location";
import type { POSSettings } from "@/lib/pos/build-pos-settings";

interface POSPageShellProps {
  settings: POSSettings;
  /** `name` rides along for the shift-start screen; the queries only need id/role. */
  user: POSProductListUser & { name?: string | null };
}

/**
 * The product query is the one slow part of the page, so it sits behind its own
 * Suspense boundary: the skeleton streams immediately and the populated grid
 * replaces it as soon as the database answers — no client-side loading round
 * trip, and no blank page while the query runs.
 */
export function POSPageShell({ settings, user }: POSPageShellProps) {
  return (
    <Suspense fallback={<POSPageSkeleton />}>
      <POSTerminalLoader settings={settings} user={user} />
    </Suspense>
  );
}

async function POSTerminalLoader({ settings, user }: POSPageShellProps) {
  // Resolved once, here, rather than in `buildPOSSettings`: the client sends
  // this id back on every search, scan, hold and sale, so the whole terminal
  // has to agree on one location — and only this layer knows who is standing
  // at the register.
  //
  // This is the SERVER's answer, from the platform default. The browser may
  // hold a different counter for this machine (`lib/pos/register-location.ts`),
  // which the workspace applies on mount — the server cannot read localStorage,
  // and rendering the wrong grid briefly is better than rendering none.
  const [posLocationId, locations] = await Promise.all([
    resolvePOSLocationId(user, settings.posLocationId),
    listPOSLocations(user),
  ]);

  const initialData = await listPOSProducts(user, {
    locationId: posLocationId,
  });

  const posLocationName = locations.find(
    (location) => location.id === posLocationId,
  )?.name;

  return (
    <POSWorkspace
      settings={{ ...settings, posLocationId, posLocationName }}
      locations={locations}
      cashierName={user.name ?? null}
      initialData={initialData}
    />
  );
}
