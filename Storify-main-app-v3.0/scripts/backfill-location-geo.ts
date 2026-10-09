/**
 * Put a point on every collection branch, so "near me" has something to measure.
 *
 * Radius search used to run over `Vendor.address.geo` — a payouts/KYC address,
 * routinely an accountant's office or a home in another city. It now runs over
 * `InventoryLocation.geo`, the place a shopper actually walks into. Branches
 * created before that field existed carry no point at all, which means they are
 * reachable only through the coarse city fallback until this pass runs.
 *
 * Default pass is purely local and makes no network calls: each branch inherits
 * its own vendor's geocoded address, which for the overwhelming majority of
 * merchants — one shop, one address — *is* the branch.
 *
 * Pass --geocode to additionally resolve each branch's own free-text address,
 * which is strictly better information than the vendor's when a merchant runs
 * more than one place. Opt-in because it costs one Nominatim call per branch at
 * roughly one per second, per their usage policy.
 *
 * Run --dry-run first. The report is the point: the share of collection points
 * carrying a real pin is what decides whether "Pickup near me" is worth
 * surfacing on this install at all.
 */

import { connectDB, disconnectDB } from "@/lib/db";
import { InventoryLocation } from "@/models/inventory-location.model";
import { Vendor } from "@/models/vendor.model";
import {
  distanceKm,
  latLngFromGeoPoint,
  vendorGeoPoint,
} from "@/lib/locations/vendor-geo";
import { coordinatesFromMapsUrl } from "@/lib/locations/maps-url";
import { geocodeAddress } from "@/lib/intl/geocoding";

const dryRun = process.argv.includes("--dry-run");
const shouldGeocode = process.argv.includes("--geocode");

/**
 * How far a freshly geocoded branch may sit from its vendor's own address
 * before the result is treated as a bad match rather than as a second shop.
 *
 * Nominatim degrades a query it cannot match by dropping parts until only the
 * city and country remain, so an unrecognised street silently returns a city
 * centroid. That is indistinguishable from a genuine answer by shape — but a
 * branch 200 km from its own merchant's registered address is far more likely
 * to be a wrong match than a real second location, and inheriting is the safer
 * answer when the two disagree that much.
 */
const GEOCODE_SANITY_KM = 200;

type LocationRow = {
  _id: unknown;
  vendorId?: unknown;
  name?: string;
  address?: string;
  pickupEnabled?: boolean;
  mapsUrl?: string;
  geo?: unknown;
};

type VendorRow = {
  _id: unknown;
  storeName?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    coordinates?: { lat?: number; lng?: number };
    geo?: unknown;
  };
};

function percent(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function label(location: LocationRow): string {
  return String(location.name || location._id);
}

async function main() {
  await connectDB();

  const locations = (await InventoryLocation.find({})
    .select("vendorId name address pickupEnabled mapsUrl geo")
    .lean()) as LocationRow[];

  const vendorIds = Array.from(
    new Set(locations.map((row) => String(row.vendorId ?? "")).filter(Boolean)),
  );
  const vendors = (await Vendor.find({ _id: { $in: vendorIds } })
    .select("storeName address")
    .lean()) as VendorRow[];
  const vendorById = new Map(vendors.map((v) => [String(v._id), v]));

  const writes: Array<{ id: unknown; geo: ReturnType<typeof vendorGeoPoint> }> =
    [];
  let alreadyDone = 0;
  let fromMapsUrl = 0;
  let inherited = 0;
  let geocoded = 0;
  let geocodeRejected = 0;
  let unowned = 0;
  const stranded: string[] = [];
  const rejected: string[] = [];
  /** Branches worth spending a network call on, deferred to the geocode pass. */
  const needsGeocode: LocationRow[] = [];

  const pickupPoints = locations.filter((row) => row.pickupEnabled);

  for (const location of locations) {
    if (location.geo) {
      alreadyDone += 1;
      continue;
    }

    // A pasted map link outranks everything: the merchant is telling us the
    // counter is not where the paperwork says it is.
    const pasted = coordinatesFromMapsUrl(location.mapsUrl ?? "");
    if (pasted) {
      const geo = vendorGeoPoint({ coordinates: pasted });
      if (geo) {
        fromMapsUrl += 1;
        writes.push({ id: location._id, geo });
        continue;
      }
    }

    const vendor = location.vendorId
      ? vendorById.get(String(location.vendorId))
      : undefined;
    if (!vendor) {
      // `scripts/backfill-location-vendor.ts` assigns owners; a row still
      // without one has nothing to inherit from.
      unowned += 1;
      continue;
    }

    // Its own address, resolved properly, beats the vendor's — but only the
    // opt-in pass pays for that. Queued before the inherit fallback so a
    // multi-branch merchant is not silently collapsed onto one point.
    if (shouldGeocode && location.address && (vendor.address?.city || vendor.address?.country)) {
      needsGeocode.push(location);
      continue;
    }

    const geo = vendorGeoPoint(vendor.address);
    if (!geo) {
      // Vendor never geocoded either. The branch stays reachable through the
      // city fallback, which is exactly what that fallback is for.
      if (stranded.length < 10) {
        stranded.push(`${label(location)} → ${vendor.storeName || vendor._id}`);
      }
      continue;
    }

    inherited += 1;
    writes.push({ id: location._id, geo });
  }

  if (needsGeocode.length > 0) {
    console.log(
      `Geocoding ${needsGeocode.length} branch addresses (~${needsGeocode.length} seconds)...`,
    );

    for (const location of needsGeocode) {
      const vendor = vendorById.get(String(location.vendorId))!;
      const vendorPoint =
        latLngFromGeoPoint(vendor.address?.geo) ??
        (vendor.address?.coordinates?.lat !== undefined &&
        vendor.address?.coordinates?.lng !== undefined
          ? {
              lat: vendor.address.coordinates.lat,
              lng: vendor.address.coordinates.lng,
            }
          : undefined);

      const resolved = await geocodeAddress({
        // The branch's free text is the street line; the vendor supplies the
        // city and country it sits in, which a one-line shop address usually
        // omits and Nominatim needs to disambiguate.
        street: location.address,
        city: vendor.address?.city,
        country: vendor.address?.country,
      });

      const geo = resolved ? vendorGeoPoint({ coordinates: resolved }) : null;
      const wildlyOff =
        geo && vendorPoint && resolved
          ? distanceKm(vendorPoint, { lat: resolved.lat, lng: resolved.lng }) >
            GEOCODE_SANITY_KM
          : false;

      if (geo && !wildlyOff) {
        geocoded += 1;
        writes.push({ id: location._id, geo });
        continue;
      }

      if (wildlyOff) {
        geocodeRejected += 1;
        if (rejected.length < 10) {
          rejected.push(`${label(location)} → ${location.address}`);
        }
      }

      // Fall back to inheriting, so a failed lookup costs nothing.
      const inheritedGeo = vendorGeoPoint(vendor.address);
      if (inheritedGeo) {
        inherited += 1;
        writes.push({ id: location._id, geo: inheritedGeo });
      } else if (stranded.length < 10) {
        stranded.push(`${label(location)} → ${vendor.storeName || vendor._id}`);
      }
    }
  }

  const total = locations.length;
  const withPoint = alreadyDone + writes.length;

  console.log("");
  console.log(`Locations scanned:      ${total}`);
  console.log(`  collection points:    ${pickupPoints.length}  <- searchable`);
  console.log(
    `  will have a point:    ${withPoint} (${percent(withPoint, total)})`,
  );
  console.log(`    already had geo:    ${alreadyDone}`);
  console.log(`    from a map link:    ${fromMapsUrl}`);
  console.log(`    inherited:          ${inherited}`);
  if (shouldGeocode) {
    console.log(`    geocoded:           ${geocoded}`);
    console.log(`    geocode rejected:   ${geocodeRejected}`);
  } else {
    console.log(`    (rerun with --geocode to pin branches individually)`);
  }
  console.log(`  no owner:             ${unowned}`);
  console.log(
    `  no source at all:     ${total - withPoint - unowned}  <- city fallback only`,
  );
  console.log("");

  if (rejected.length > 0) {
    console.log(
      `Geocoded more than ${GEOCODE_SANITY_KM} km from their own store, inherited instead:`,
    );
    for (const line of rejected) console.log(`  ${line}`);
    console.log("");
  }

  if (stranded.length > 0) {
    console.log("Branches whose vendor has no coordinates either:");
    for (const line of stranded) console.log(`  ${line}`);
    console.log("  (run db:migrate vendor-geo --geocode first)");
    console.log("");
  }

  if (dryRun) {
    console.log(`Dry run complete: ${writes.length} locations would be updated.`);
    return;
  }

  if (writes.length > 0) {
    await InventoryLocation.bulkWrite(
      writes.map((write) => ({
        updateOne: {
          filter: { _id: write.id },
          update: { $set: { geo: write.geo } },
        },
      })),
    );
  }

  // Builds the sparse 2dsphere index if this database has never had one. After
  // the writes, so it is built once over final data.
  await InventoryLocation.createIndexes();

  console.log(`Backfill complete: ${writes.length} locations updated.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
  });
