import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

// Default exchange rates (relative to USD)
const DEFAULT_EXCHANGE_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  BDT: 110,
  INR: 83,
  TRY: 41,
  PKR: 283,
  JPY: 149,
  CNY: 7.24,
  AUD: 1.53,
  CAD: 1.36,
  SAR: 3.75,
  AED: 3.67,
  SGD: 1.34,
  MYR: 4.47,
  THB: 35.5,
  KRW: 1320,
  ZAR: 18.5,
  KES: 155,
  UGX: 3690,
  NGN: 1550,
  QAR: 3.64,
  KWD: 0.31,
  BHD: 0.38,
  OMR: 0.38,
};

// In a production app, you would cache these and update periodically
let cachedRates = { ...DEFAULT_EXCHANGE_RATES };
let lastUpdated = new Date();

const ExchangeRatesSchema = z.object({
  rates: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive()).optional(),
});

/**
 * GET /api/settings/exchange-rates
 * Get current exchange rates
 */
export const GET = withApi(
  {},
  async () => {
    return successResponse({
      baseCurrency: "USD",
      rates: cachedRates,
      lastUpdated: lastUpdated.toISOString(),
    });
  },
);

/**
 * PUT /api/settings/exchange-rates
 * Update exchange rates (admin only)
 */
export const PUT = withApi(
  { auth: "admin" },
  async ({ request }) => {
    const { rates } = await validateBody(request, ExchangeRatesSchema);

    if (rates) {
      // Merge with existing rates
      cachedRates = { ...cachedRates, ...rates };
      lastUpdated = new Date();
    }

    return successResponse({
      baseCurrency: "USD",
      rates: cachedRates,
      lastUpdated: lastUpdated.toISOString(),
    });
  },
);
