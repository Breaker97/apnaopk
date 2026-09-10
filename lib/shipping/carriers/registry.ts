import type { CarrierProvider } from "@/lib/shipping/carrier-config";
import type { CarrierAdapter } from "./types";

import { shippoAdapter } from "./shippo";
import { shiprocketAdapter } from "./shiprocket";

const ADAPTERS: Record<CarrierProvider, CarrierAdapter> = {
  shippo: shippoAdapter,
  shiprocket: shiprocketAdapter,
};

export function carrierAdapter(provider: CarrierProvider): CarrierAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    // Exhaustive by construction, but a provider added to the union without an
    // adapter must fail loudly rather than silently never ship anything.
    throw new Error(`No carrier adapter is registered for ${provider}`);
  }
  return adapter;
}

