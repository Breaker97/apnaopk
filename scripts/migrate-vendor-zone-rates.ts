/**
 * Move vendors off their own shipping geography and onto the store's zones.
 *
 * Vendors used to draw their own zones (countries, regions and rates), which is
 * the Etsy model. The store now defines the zones and a vendor supplies only
 * what it charges inside each one — the Dokan/Mirakl split — so a shopper's
 * address resolves to the same zone whichever vendor they buy from, and a
 * vendor who has configured nothing still ships everywhere the store does.
 *
 * A legacy vendor zone cannot be matched to a platform zone by id (both sides
 * generated their own), so it is matched by the geography it describes: the
 * platform zone sharing the most countries with it, preferring one whose regions
 * also overlap. Rates from every legacy zone mapping to the same platform zone
 * are concatenated, keeping their ids.
 *
 * Vendor zones that match no platform zone are LEFT BEHIND and reported. They
 * describe places the store does not zone at all, so there is nothing to attach
 * their prices to — the store's fallback will cover those addresses instead.
 *
 * `lib/shipping/shipping.ts` keeps rating unmigrated vendors the old way, so running
 * this is safe at any time and re-running it is a no-op.
 *
 * Run with --dry-run first: the report says how many vendors carry rates the
 * store has no zone for, which is a question for the admin, not for a script.
 */

import { connectDB, disconnectDB } from "@/lib/db";
import { Vendor } from "@/models/vendor.model";
import { getSettings } from "@/models/settings.model";

const dryRun = process.argv.includes("--dry-run");

type LegacyRate = Record<string, unknown> & { id?: string };

type LegacyZone = {
  id?: string;
  name?: string;
  countries?: string[];
  regions?: string[];
  rates?: LegacyRate[];
};

type VendorRow = {
  _id: unknown;
  storeName?: string;
  shipping?: {
    enabled?: boolean;
    zones?: LegacyZone[];
    zoneRates?: Array<{ zoneId?: string }>;
  };
};

type PlatformZone = {
  id?: string;
  name?: string;
  countries?: string[];
  regions?: string[];
};

const normalize = (value: unknown) => String(value || "").trim().toLowerCase();

function overlapCount(a: string[] | undefined, b: string[] | undefined): number {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  const target = new Set(b.map(normalize));
  return a.filter((entry) => target.has(normalize(entry))).length;
}

/**
 * The platform zone a legacy vendor zone most nearly describes: most shared
 * countries wins, with region overlap breaking ties so a vendor's
 * "Dhaka Division" lands on the store's Dhaka zone rather than its Bangladesh
 * one. No shared country at all means no match.
 */
function bestPlatformZone(
  legacy: LegacyZone,
  platformZones: PlatformZone[],
): PlatformZone | null {
  let best: PlatformZone | null = null;
  let bestScore = 0;
  let bestRegionScore = -1;

  for (const zone of platformZones) {
    const countryScore = overlapCount(legacy.countries, zone.countries);
    if (countryScore === 0) continue;
    const regionScore = overlapCount(legacy.regions, zone.regions);

    if (
      countryScore > bestScore ||
      (countryScore === bestScore && regionScore > bestRegionScore)
    ) {
      best = zone;
      bestScore = countryScore;
      bestRegionScore = regionScore;
    }
  }

  return best;
}

async function main() {
  await connectDB();

  const settings = await getSettings();
  const platformZones: PlatformZone[] = (settings.shipping?.zones ?? []).map(
    (zone) => ({
      id: zone.id,
      name: zone.name,
      countries: zone.countries ?? [],
      regions: zone.regions ?? [],
    }),
  );

  if (platformZones.length === 0) {
    console.error(
      "The store has no shipping zones. Create them in Admin → Settings → " +
        "Shipping first — there is nothing for vendor rates to attach to.",
    );
    await disconnectDB();
    process.exitCode = 1;
    return;
  }

  const vendors = (await Vendor.find({
    "shipping.zones.0": { $exists: true },
  })
    .select("storeName shipping")
    .lean()) as VendorRow[];

  const writes: Array<{
    id: unknown;
    storeName: string;
    zoneRates: Array<{ zoneId: string; rates: LegacyRate[] }>;
  }> = [];
  let alreadyMigrated = 0;
  let droppedZones = 0;
  const droppedSamples: string[] = [];

  for (const vendor of vendors) {
    const storeName = vendor.storeName || String(vendor._id);

    if ((vendor.shipping?.zoneRates ?? []).length > 0) {
      alreadyMigrated += 1;
      continue;
    }

    const byZoneId = new Map<string, LegacyRate[]>();
    for (const legacy of vendor.shipping?.zones ?? []) {
      const target = bestPlatformZone(legacy, platformZones);
      if (!target?.id) {
        droppedZones += 1;
        if (droppedSamples.length < 10) {
          droppedSamples.push(
            `${storeName}: "${legacy.name || legacy.id}" (${
              (legacy.countries ?? []).join(", ") || "no countries"
            })`,
          );
        }
        continue;
      }
      const rates = Array.isArray(legacy.rates) ? legacy.rates : [];
      byZoneId.set(target.id, [...(byZoneId.get(target.id) ?? []), ...rates]);
    }

    if (byZoneId.size === 0) continue;

    writes.push({
      id: vendor._id,
      storeName,
      zoneRates: [...byZoneId.entries()].map(([zoneId, rates]) => ({
        zoneId,
        rates,
      })),
    });
  }

  console.log(`Platform zones:            ${platformZones.length}`);
  console.log(`Vendors with legacy zones: ${vendors.length}`);
  console.log(`Already migrated:          ${alreadyMigrated}`);
  console.log(`To migrate:                ${writes.length}`);
  console.log(`Vendor zones with no matching platform zone: ${droppedZones}`);
  if (droppedSamples.length > 0) {
    console.log(
      "\nThese vendor zones have no platform zone covering their countries.\n" +
        "Their rates are not carried over — the store's fallback will price\n" +
        "those addresses. Add matching zones first if that is not what you want:",
    );
    for (const sample of droppedSamples) console.log(`  - ${sample}`);
  }

  if (dryRun) {
    console.log("\nDry run — nothing written.");
    await disconnectDB();
    return;
  }

  for (const write of writes) {
    await Vendor.updateOne(
      { _id: write.id },
      // The legacy zones go at the same moment their rates land, so the engine
      // never sees a vendor holding both models at once.
      { $set: { "shipping.zoneRates": write.zoneRates, "shipping.zones": [] } },
    );
  }

  console.log(`\nMigrated ${writes.length} vendor(s).`);
  await disconnectDB();
}

main().catch(async (error) => {
  console.error("Migration failed:", error);
  await disconnectDB().catch(() => {});
  process.exitCode = 1;
});
