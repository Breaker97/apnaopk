/**
 * Backfill `Vendor.address.geo` from the existing `address.coordinates`.
 *
 * The storefront's location filter finds vendors by radius, which needs a
 * GeoJSON point on a 2dsphere index. Vendors geocoded before that field existed
 * have `{ lat, lng }` and nothing else, so without this pass they are invisible
 * to every radius search.
 *
 * By default it is purely local: it re-projects coordinates already stored and
 * never calls the geocoder.
 *
 * Pass --geocode to also resolve vendors that have an address but have never
 * been geocoded — vendors created by seeding or by an import never pass through
 * `/api/vendor/settings`, which is the only path that geocodes on save, so they
 * carry a perfectly good address and no coordinates at all. That pass is opt-in
 * because it makes one network call per vendor at roughly one per second, per
 * Nominatim's usage policy.
 *
 * Run with --dry-run first. The report it prints is the point of the exercise —
 * the share of vendors carrying usable coordinates decides whether radius is
 * the primary control in the UI or a refinement on top of a city list.
 */

import { connectDB, disconnectDB } from "@/lib/db";
import { Vendor } from "@/models/vendor.model";
import { vendorGeoPoint } from "@/lib/locations/vendor-geo";
import { geocodeAddress, type GeoCoordinates } from "@/lib/intl/geocoding";

const dryRun = process.argv.includes("--dry-run");
const shouldGeocode = process.argv.includes("--geocode");

type VendorAddressRow = {
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

async function main() {
  await connectDB();

  const vendors = (await Vendor.find({})
    .select("storeName address")
    .lean()) as VendorAddressRow[];

  const writes: Array<{
    id: unknown;
    geo: ReturnType<typeof vendorGeoPoint>;
    /** Set only for rows resolved by the --geocode pass. */
    coordinates?: GeoCoordinates;
  }> = [];
  let alreadyDone = 0;
  let noCoordinates = 0;
  let unusable = 0;
  let withCity = 0;
  let geocoded = 0;
  let geocodeFailed = 0;
  const unusableSamples: string[] = [];
  const geocodeFailures: string[] = [];
  /** Rows with an address but no coordinates, deferred to the geocode pass. */
  const needsGeocode: VendorAddressRow[] = [];

  for (const vendor of vendors) {
    const address = vendor.address ?? {};
    if (address.city) withCity += 1;

    const coords = address.coordinates;
    if (!coords || (coords.lat === undefined && coords.lng === undefined)) {
      noCoordinates += 1;
      // An address with nothing to geocode is not worth a network call.
      if (address.street || address.city) needsGeocode.push(vendor);
      continue;
    }

    const geo = vendorGeoPoint({ coordinates: coords });
    if (!geo) {
      // Coordinates are present but out of range or Null Island. Reported
      // rather than written: a 2dsphere index rejects these outright, which
      // would fail the vendor's next save.
      unusable += 1;
      if (unusableSamples.length < 5) {
        unusableSamples.push(
          `${vendor.storeName || vendor._id} → lat=${coords.lat}, lng=${coords.lng}`,
        );
      }
      continue;
    }

    if (address.geo) {
      alreadyDone += 1;
      continue;
    }

    writes.push({ id: vendor._id, geo });
  }

  // Opt-in network pass. `geocodeAddress` paces itself to Nominatim's one
  // request per second and never throws, so a single unresolvable address
  // costs one slot and no more.
  if (shouldGeocode && needsGeocode.length > 0) {
    console.log(
      `Geocoding ${needsGeocode.length} addresses (~${needsGeocode.length} seconds)...`,
    );

    for (const vendor of needsGeocode) {
      const address = vendor.address ?? {};
      const resolved = await geocodeAddress({
        street: address.street,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country,
      });

      const geo = vendorGeoPoint({ coordinates: resolved ?? undefined });
      if (!resolved || !geo) {
        geocodeFailed += 1;
        if (geocodeFailures.length < 10) {
          geocodeFailures.push(
            `${vendor.storeName || vendor._id} → ${[address.street, address.city, address.country].filter(Boolean).join(", ")}`,
          );
        }
        continue;
      }

      geocoded += 1;
      // Both fields are written together: `coordinates` is what the storefront
      // map link reads, `geo` is what radius search queries.
      writes.push({ id: vendor._id, geo, coordinates: resolved });
    }
  }

  const total = vendors.length;
  const geocodable = writes.length + alreadyDone;

  console.log("");
  console.log(`Vendors scanned:        ${total}`);
  console.log(
    `  usable coordinates:   ${geocodable} (${percent(geocodable, total)})`,
  );
  console.log(`    already had geo:    ${alreadyDone}`);
  console.log(`    to write:           ${writes.length}`);
  // Reported net of anything the geocode pass just resolved, so the two lines
  // always add up to the total rather than counting a vendor in both.
  const stillWithout = noCoordinates - geocoded;
  console.log(
    `  no coordinates:       ${stillWithout} (${percent(stillWithout, total)})`,
  );
  console.log(`  unusable coordinates: ${unusable}`);
  if (shouldGeocode) {
    console.log(`    newly geocoded:     ${geocoded}`);
    console.log(`    geocode failed:     ${geocodeFailed}`);
  } else if (needsGeocode.length > 0) {
    console.log(
      `    (${needsGeocode.length} have an address but no coordinates — rerun with --geocode)`,
    );
  }
  console.log(
    `  city name present:    ${withCity} (${percent(withCity, total)})  <- fallback reach`,
  );
  console.log("");

  if (unusableSamples.length > 0) {
    console.log("Unusable coordinate samples:");
    for (const sample of unusableSamples) console.log(`  ${sample}`);
    console.log("");
  }

  if (geocodeFailures.length > 0) {
    console.log("Addresses the geocoder could not resolve:");
    for (const failure of geocodeFailures) console.log(`  ${failure}`);
    console.log("");
  }

  if (dryRun) {
    console.log(`Dry run complete: ${writes.length} vendors would be updated.`);
    return;
  }

  if (writes.length > 0) {
    await Vendor.bulkWrite(
      writes.map((write) => ({
        updateOne: {
          filter: { _id: write.id },
          update: {
            $set: {
              "address.geo": write.geo,
              // Only present for rows the geocode pass resolved. Re-projected
              // rows already have their coordinates on disk and must not have
              // them rewritten.
              ...(write.coordinates
                ? { "address.coordinates": write.coordinates }
                : {}),
            },
          },
        },
      })),
    );
  }

  // Builds the 2dsphere index if the running process has not yet. Done after
  // the writes so the index is built once over final data.
  await Vendor.createIndexes();

  console.log(`Backfill complete: ${writes.length} vendors updated.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
  });
