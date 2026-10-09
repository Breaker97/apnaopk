import type { SponsoredPlacementDepths } from "./boost-placement-depths";

/**
 * What Settings → Product Boosting shows beside its own fields
 * (GET /api/admin/boosts/overview). Pure types, so the settings screen (a
 * client component) and the route share one shape.
 */
export type BoostingOverview = {
  /** The store's default currency, which the ladder is priced in. */
  currency: string;
  /** The rungs on sale, in ladder order. Archived rungs are left out. */
  positions: Array<{
    position: number;
    label: string;
    pricePerDay: number;
    currency: string;
  }>;
  /**
   * How deep each page renders the ladder today. `home` is the home page's
   * sponsored section limit; `home` and `productPage` are 0 when the published
   * page has no sponsored section at all.
   */
  depths: SponsoredPlacementDepths;
  /** Paid bookings that would stop showing if boosting were switched off. */
  bookings: { running: number; upcoming: number };
};
