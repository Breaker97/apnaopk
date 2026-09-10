import {
  shiprocketLogin,
  shiprocketPickupAddresses,
  shiprocketServiceability,
  shiprocketTrackByAwb,
  clearShiprocketTokenCache,
} from "@/lib/shipping/carriers/shiprocket-client";
import { shiprocketAdapter } from "@/lib/shipping/carriers/shiprocket";
import type {
  CarrierContext,
  CarrierShipmentRequest,
} from "@/lib/shipping/carriers/types";

/**
 * Shiprocket live contract probe — READ ONLY
 * ==========================================
 *
 * Shiprocket has no sandbox, so the adapter's unit tests run against a stubbed
 * `fetch` shaped from their documentation. That verifies our logic and proves
 * nothing about their actual responses: a renamed field (`pin_code`,
 * `available_courier_companies`, `courier_company_id`) would pass every test in
 * the suite and fail on the first real parcel.
 *
 * This closes that gap using the *real* client functions — not a copy of them,
 * so what passes here is what the app will do.
 *
 * SAFETY. Only the endpoints that create nothing and cost nothing are called:
 *
 *     POST /auth/login                 — free
 *     GET  /settings/company/pickup    — free
 *     GET  /courier/serviceability     — free, this is rate shopping
 *     GET  /courier/track/awb/{awb}    — free, only with --awb
 *
 * It NEVER calls `orders/create/adhoc`, `courier/assign/awb`,
 * `courier/generate/pickup` or `courier/generate/label`. Nothing appears in the
 * merchant's panel, no AWB is assigned and no money moves. Booking a real
 * consignment is a deliberate manual step, not something a probe should do.
 *
 * Usage:
 *   SHIPROCKET_EMAIL=… SHIPROCKET_PASSWORD=… SHIPROCKET_PICKUP_LOCATION=… \
 *     pnpm probe:shiprocket -- --to 560025 --weight 1.5
 *
 *   # optional: also read back a real AWB's tracking
 *   pnpm probe:shiprocket -- --to 560025 --awb 1234567890
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const checks: Array<{ ok: boolean; label: string; detail?: string }> = [];

function check(ok: boolean, label: string, detail?: string) {
  checks.push({ ok, label, detail });
  console.log(`   ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function preview(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .split("\n")
    .slice(0, 24)
    .map((line) => `      ${line}`)
    .join("\n");
}

async function run() {
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  const pickupLocation = process.env.SHIPROCKET_PICKUP_LOCATION;

  if (!email || !password) {
    console.error(
      "❌ Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD.\n" +
        "   These are the API user's credentials (Shiprocket → Settings → API →\n" +
        "   Configure), NOT your dashboard login. A dashboard login returns 403\n" +
        "   from every endpoint below, which is the single most common setup error.",
    );
    process.exit(1);
  }

  const deliveryPostcode = arg("to") || "560025";
  const weight = Number(arg("weight") || "1.5");
  const awb = arg("awb");

  clearShiprocketTokenCache();

  console.log("\n🔎 Shiprocket live contract probe (read-only)\n");

  // ── 1. Authentication ───────────────────────────────────────────────────
  console.log("-- auth/login --");
  let token: string;
  try {
    token = await shiprocketLogin({ email, password });
    check(typeof token === "string" && token.length > 0, "login returns a token");
  } catch (error) {
    check(false, "login", error instanceof Error ? error.message : String(error));
    return summarize();
  }

  // ── 2. Pickup addresses — what the origin pincode is read from ──────────
  console.log("\n-- settings/company/pickup --");
  const addresses = await shiprocketPickupAddresses({ token });
  check(addresses.length > 0, "account has at least one pickup location");
  console.log(preview(addresses));

  // The fields fix #4 depends on. A rename here is invisible to every unit test.
  check(
    addresses.every((address) => Boolean(address.name)),
    "every location has a `pickup_location` name",
  );
  const withPincode = addresses.filter((address) => Boolean(address.pincode));
  check(
    withPincode.length === addresses.length,
    "every location has a `pin_code`",
    `${withPincode.length}/${addresses.length}`,
  );

  let originPostcode = addresses[0]?.pincode;
  if (pickupLocation) {
    const match = addresses.find(
      (address) =>
        address.name.trim().toLowerCase() === pickupLocation.trim().toLowerCase(),
    );
    check(
      Boolean(match),
      `configured SHIPROCKET_PICKUP_LOCATION "${pickupLocation}" exists on the account`,
      match ? undefined : `found: ${addresses.map((a) => a.name).join(", ")}`,
    );
    if (match?.pincode) originPostcode = match.pincode;
  }

  if (!originPostcode) {
    check(false, "resolved an origin pincode to quote from");
    return summarize();
  }
  console.log(`   → quoting from ${originPostcode} → ${deliveryPostcode}`);

  // ── 3. Serviceability — the rate list ───────────────────────────────────
  console.log("\n-- courier/serviceability (prepaid) --");
  const couriers = await shiprocketServiceability({
    token,
    pickupPostcode: originPostcode,
    deliveryPostcode,
    weight,
    cod: false,
  });
  check(couriers.length > 0, "returns at least one courier", `${couriers.length}`);
  if (couriers[0]) {
    console.log(preview(couriers[0]));
    const first = couriers[0];
    check(
      Number.isFinite(Number(first.courier_company_id)),
      "`courier_company_id` is numeric — it is used as the rate id",
    );
    check(Boolean(first.courier_name), "`courier_name` is present");
    check(Number.isFinite(Number(first.rate)), "`rate` is numeric");
    check(
      first.estimated_delivery_days !== undefined || first.etd !== undefined,
      "an ETA field is present (`estimated_delivery_days` or `etd`)",
    );
  }

  console.log("\n-- courier/serviceability (COD) --");
  const codCouriers = await shiprocketServiceability({
    token,
    pickupPostcode: originPostcode,
    deliveryPostcode,
    weight,
    cod: true,
    declaredValue: 2400,
  });
  check(
    codCouriers.length > 0,
    "returns at least one COD-capable courier",
    `${codCouriers.length}`,
  );

  // ── 4. The adapter's own path, end to end ───────────────────────────────
  // Not a re-implementation: this is the function the Send-to-courier dialog
  // calls, so a pass here is a pass for the real flow — including the pickup
  // pincode resolution, which no stubbed test can prove against a live account.
  if (pickupLocation) {
    console.log("\n-- shiprocketAdapter.getRates (the real path) --");
    const ctx: CarrierContext = {
      provider: "shiprocket",
      accountOwner: "platform",
      mode: "live",
      shiprocket: { email, password, pickupLocationName: pickupLocation },
    };
    const request: CarrierShipmentRequest = {
      reference: "PROBE-DO-NOT-BOOK",
      orderNumber: "PROBE",
      shipFrom: {
        name: "Probe Origin",
        street1: "1 Test Road",
        city: "Probe City",
        state: "MH",
        // Deliberately NOT the pickup location's pincode: if the adapter quotes
        // from this, fix #4 has regressed and the rates describe a lane the
        // consignment would never travel.
        postalCode: "999999",
        country: "IN",
        phone: "9999999999",
      },
      shipTo: {
        name: "Probe Consignee",
        street1: "2 Test Street",
        city: "Probe Town",
        state: "KA",
        postalCode: deliveryPostcode,
        country: "IN",
        phone: "9999999999",
      },
      parcels: [
        {
          length: 30,
          width: 20,
          height: 15,
          dimensionUnit: "cm",
          weight,
          weightUnit: "kg",
        },
      ],
      declaredValue: { amount: 2400, currency: "INR" },
      shippingAmount: 80,
      items: [{ name: "Probe item", sku: "PROBE", quantity: 1, unitPrice: 2400 }],
    };

    try {
      const quotes = await shiprocketAdapter.getRates(ctx, request);
      check(quotes.length > 0, "adapter returns quotes", `${quotes.length}`);
      check(
        quotes.every((quote) => quote.currency === "INR"),
        "quotes are denominated in INR",
      );

      // Positive proof that the pickup pincode was used, not the ship-from.
      // Getting rates at all is weaker than it looks — it only says *some*
      // origin worked. Comparing the courier set against the direct quote from
      // `originPostcode` says it was the right one.
      const fromPickup = new Set(
        couriers.map((courier) => String(courier.courier_company_id)),
      );
      const matched = quotes.filter((quote) =>
        fromPickup.has(quote.rateId),
      ).length;
      check(
        matched > 0,
        "adapter priced from the pickup location, not the ship-from record",
        `${matched}/${quotes.length} couriers match a direct quote from ${originPostcode}; ship-from was an unusable 999999`,
      );
      console.log(preview(quotes.slice(0, 2)));
    } catch (error) {
      check(
        false,
        "adapter getRates",
        error instanceof Error ? error.message : String(error),
      );
    }
  } else {
    console.log(
      "\n   • SHIPROCKET_PICKUP_LOCATION unset — skipping the adapter path",
    );
  }

  // ── 5. Tracking, only if given a real AWB ───────────────────────────────
  if (awb) {
    console.log("\n-- courier/track/awb --");
    const result = await shiprocketTrackByAwb({ token, awb });
    console.log(preview(result));
    const data = result.tracking_data;
    check(Boolean(data), "`tracking_data` is present");
    check(
      Array.isArray(data?.shipment_track_activities) ||
        data?.shipment_track_activities === undefined,
      "`shipment_track_activities` is an array when present",
    );
    const tracking = await shiprocketAdapter.track(
      {
        provider: "shiprocket",
        accountOwner: "platform",
        mode: "live",
        shiprocket: { email, password, pickupLocationName: pickupLocation },
      },
      { trackingNumber: awb },
    );
    check(
      Boolean(tracking.status),
      "adapter normalises a status",
      tracking.status,
    );
  }

  summarize();
}

function summarize() {
  const failed = checks.filter((entry) => !entry.ok);
  console.log(
    `\n${failed.length === 0 ? "✅" : "❌"} ${checks.length - failed.length}/${checks.length} contract checks passed\n`,
  );
  if (failed.length > 0) {
    for (const entry of failed) {
      console.log(`   ✗ ${entry.label}${entry.detail ? ` — ${entry.detail}` : ""}`);
    }
    console.log(
      "\nA failure here means Shiprocket's live response does not match what the\n" +
        "adapter reads. Fix the adapter, then update the stubs in\n" +
        "tests/carrier-adapters.test.ts to match reality.\n",
    );
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("\n❌ Probe failed:", error);
  process.exit(1);
});
