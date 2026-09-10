import "server-only";

import { Settings, getSettings, type ISettings } from "@/models/settings.model";
import {
  resolveShippoCredentials,
  resolveShiprocketCredentials,
} from "@/lib/settings/credentials";
import {
  carrierSupportsOrigin,
  type CarrierProvider,
} from "@/lib/shipping/carrier-config";
import { CARRIER_ERROR_CODES, CarrierError } from "./errors";
import {
  resolveVendorCarrierCredentials,
  vendorShiprocketOverrideApplies,
} from "./vendor-carriers";
import type { CarrierContext } from "./types";
import type { IVendor } from "@/types";

/**
 * Build the account context an adapter talks through.
 *
 * One place decides which credentials a shipment uses, so the vendor override
 * (Chunk 6) has a single seam to hook into rather than every route learning
 * about it.
 */
export async function resolveCarrierContext(params: {
  provider: CarrierProvider;
  settings?: ISettings;
  /**
   * The vendor whose parcel this is. When it ships on its own account those
   * credentials win; otherwise it falls through to the platform's.
   */
  vendor?: Pick<IVendor, "shipping"> | null;
  /** Skips the enabled checks — the Test-connection action needs that. */
  ignoreEnabled?: boolean;
}): Promise<CarrierContext> {
  const settings = params.settings ?? (await getSettings());
  const carriers = settings.shipping?.carriers;
  const own = resolveVendorCarrierCredentials(
    params.vendor?.shipping?.carriers,
  );

  if (!params.ignoreEnabled && !carriers?.enabled) {
    throw new CarrierError({
      provider: params.provider,
      code: CARRIER_ERROR_CODES.DISABLED,
      message: "Carrier shipping is turned off in Settings → Shipping",
      permanent: true,
    });
  }

  if (params.provider === "shippo") {
    const shippo = carriers?.shippo;
    if (!params.ignoreEnabled && !shippo?.enabled) {
      throw new CarrierError({
        provider: "shippo",
        code: CARRIER_ERROR_CODES.DISABLED,
        message: "Shippo is not enabled",
        permanent: true,
      });
    }
    const resolved = resolveShippoCredentials(shippo);
    // A vendor on its own account only overrides when it actually holds a
    // usable token — a half-configured override must not silently disable
    // shipping that was working on the platform account.
    const useOwn = Boolean(own?.shippo?.token);
    return {
      provider: "shippo",
      accountOwner: useOwn ? "vendor" : "platform",
      mode: useOwn ? own!.shippo!.mode : resolved.mode,
      token: useOwn ? own!.shippo!.token : resolved.token,
      shippo: {
        labelFileType: shippo?.labelFileType,
        serviceTokenAllowList: shippo?.serviceTokenAllowList,
      },
    };
  }

  const shiprocket = carriers?.shiprocket;
  if (!params.ignoreEnabled && !shiprocket?.enabled) {
    throw new CarrierError({
      provider: "shiprocket",
      code: CARRIER_ERROR_CODES.DISABLED,
      message: "Shiprocket is not enabled",
      permanent: true,
    });
  }

  const originCountry = settings.shipping?.origin?.country;
  if (!carrierSupportsOrigin("shiprocket", originCountry)) {
    throw new CarrierError({
      provider: "shiprocket",
      code: CARRIER_ERROR_CODES.UNSUPPORTED_ORIGIN,
      message:
        "Shiprocket only dispatches from India. Set your shipping origin country to India to use it.",
      permanent: true,
    });
  }

  const resolved = resolveShiprocketCredentials(shiprocket);
  const useOwn = vendorShiprocketOverrideApplies(own);
  return {
    provider: "shiprocket",
    accountOwner: useOwn ? "vendor" : "platform",
    // Shiprocket has no sandbox — a working login is always a live account.
    mode: "live",
    shiprocket: {
      email: useOwn ? own!.shiprocket!.email : resolved.email,
      password: useOwn ? own!.shiprocket!.password : resolved.password,
      pickupLocationName: useOwn
        ? own!.shiprocket!.pickupLocationName
        : resolved.pickupLocationName,
      channelId: shiprocket?.channelId,
      // The persisted token cache belongs to the platform account, so a vendor
      // on its own login must not reuse or overwrite it.
      cachedToken: useOwn ? undefined : shiprocket?.tokenCache?.token,
      cachedTokenExpiresAt: useOwn
        ? undefined
        : shiprocket?.tokenCache?.expiresAt,
      onToken: useOwn ? undefined : persistShiprocketToken,
    },
  };
}

/**
 * Store a freshly minted Shiprocket token.
 *
 * Written straight to the collection rather than through the hydrated settings
 * document: this fires from inside a carrier call that may be running in a
 * cron worker, and a full `settings.save()` would race whatever else that
 * request is editing.
 */
async function persistShiprocketToken(token: string, expiresAt: Date) {
  await Settings.updateOne(
    {},
    {
      $set: {
        "shipping.carriers.shiprocket.tokenCache.token": token,
        "shipping.carriers.shiprocket.tokenCache.expiresAt": expiresAt,
      },
    },
  );
}

/**
 * Providers that are switched on and hold enough credentials to be tried.
 *
 * The vendor is consulted as well as the platform, because a vendor shipping on
 * its own account is the *only* holder of those credentials. Checking the
 * platform alone meant a store that enabled Shiprocket without filling in a
 * login could never use a vendor's own — the provider was filtered out before
 * `resolveCarrierContext` ever got the chance to prefer it.
 *
 * The `enabled` flags stay the platform's call throughout: they are the store's
 * policy about which carriers may be used at all, and a vendor's own account
 * overrides the credentials, not the policy.
 */
export async function enabledCarrierProviders(
  settings?: ISettings,
  vendor?: Pick<IVendor, "shipping"> | null,
): Promise<CarrierProvider[]> {
  const resolved = settings ?? (await getSettings());
  const carriers = resolved.shipping?.carriers;
  if (!carriers?.enabled) return [];

  const own = resolveVendorCarrierCredentials(vendor?.shipping?.carriers);
  const providers: CarrierProvider[] = [];

  if (carriers.shippo?.enabled) {
    const token =
      own?.shippo?.token || resolveShippoCredentials(carriers.shippo).token;
    if (token) providers.push("shippo");
  }

  if (
    carriers.shiprocket?.enabled &&
    carrierSupportsOrigin("shiprocket", resolved.shipping?.origin?.country)
  ) {
    // The same predicate `resolveCarrierContext` decides with, so a provider is
    // never offered on an account the context resolver would then decline to
    // use. An override is taken whole or not at all, never mixed.
    const account = vendorShiprocketOverrideApplies(own)
      ? own!.shiprocket!
      : resolveShiprocketCredentials(carriers.shiprocket);
    if (account.email && account.password && account.pickupLocationName) {
      providers.push("shiprocket");
    }
  }

  return providers;
}
