/**
 * The sponsored ladder, as the storefront sees it.
 *
 * Cache discipline: the CANDIDATE POOL is cached and deliberately
 * TIME-INDEPENDENT — it holds every still-open booking, with no `now` filter,
 * no look-ahead horizon and no day in the cache key. Which rung is live is
 * decided per request by `resolveLadderAt`, outside the cache. That is what
 * makes a scheduled booking start rendering at exactly 00:00 UTC with no cron
 * tick and no tag bust: the window was fixed at booking time and the pool is a
 * superset of the live ladder at any later instant.
 *
 * The render model is BoostCampaign — not a stamp on Product, and never
 * BoostSlotDay. Slot-days are the write-path booking ledger and stay off the
 * read path entirely.
 */

import { unstable_cache } from "next/cache";
import { BOOST_CAMPAIGN_STATUS, PRODUCT_STATUS } from "@/config/app.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import {
  resolvePlacementDepths,
  type SponsoredPlacementDepths,
} from "@/lib/boosts/boost-placement-depths";
import { connectDB } from "@/lib/db";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import { AVAILABLE_STOCK_QUERY } from "@/lib/products/stock-policy";
import {
  PRODUCT_CARD_SELECT,
  serializeProductCards,
  type StorefrontProductCard,
} from "@/lib/products/storefront-product-cards";
import { BoostCampaign, Product } from "@/models";

type StorefrontBoostingSettings = {
  /** Boosting requires multi-vendor mode; both flags folded into one. */
  enabled: boolean;
  placements: { home: boolean; listing: boolean; productPage: boolean };
  hideOutOfStock: boolean;
};

const BOOSTING_OFF: StorefrontBoostingSettings = {
  enabled: false,
  placements: { home: false, listing: false, productPage: false },
  hideOutOfStock: true,
};

/**
 * Boosting config for the three placements, cached and projected.
 *
 * Projected rather than loaded whole: the placements previously pulled the
 * entire settings singleton on every render, BEFORE the feature gate, so
 * installs with boosting off paid for it too. Tagged `settings`, so saving
 * busts it immediately.
 */
export const getStorefrontBoostingSettings = unstable_cache(
  async (): Promise<StorefrontBoostingSettings> => {
    const { Settings } = await import("@/models/settings.model");
    const doc = await Settings.findOne()
      .select("boosting multiVendorMode.enabled")
      .lean<{
        multiVendorMode?: { enabled?: boolean };
        boosting?: {
          enabled?: boolean;
          placements?: {
            home?: boolean;
            listing?: boolean;
            productPage?: boolean;
          };
          hideOutOfStock?: boolean;
        };
      } | null>();

    if (!doc?.multiVendorMode?.enabled || !doc.boosting?.enabled) {
      return BOOSTING_OFF;
    }
    const boosting = doc.boosting;
    return {
      enabled: true,
      placements: {
        home: boosting.placements?.home !== false,
        listing: boosting.placements?.listing !== false,
        productPage: boosting.placements?.productPage !== false,
      },
      hideOutOfStock: boosting.hideOutOfStock !== false,
    };
  },
  ["storefront-boosting-settings"],
  { revalidate: 60, tags: [CACHE_TAGS.settings] },
);

/**
 * The three placement depths. Lives here rather than in
 * lib/boost-placement-depths.ts because that module is imported by a client
 * component: `unstable_cache` plus the Settings model would drag mongoose into
 * the browser bundle.
 */
export const getSponsoredPlacementDepths = unstable_cache(
  async (): Promise<SponsoredPlacementDepths> => {
    const [{ Settings }, { StorePage, HOME_TEMPLATE_KEY }, { buildTemplateKey }] =
      await Promise.all([
        import("@/models/settings.model"),
        import("@/models/store-page.model"),
        import("@/lib/storefront/pages/handles"),
      ]);
    const productTemplateKey = buildTemplateKey("product");
    const [doc, templatePages] = await Promise.all([
      Settings.findOne()
        .select(
          "boosting.listingSlots boosting.productPageSlots homePage.sections.sponsoredProducts.limit",
        )
        .lean<{
          boosting?: { listingSlots?: number; productPageSlots?: number };
          homePage?: { sections?: { sponsoredProducts?: { limit?: number } } };
        } | null>(),
      StorePage.find({ key: { $in: [HOME_TEMPLATE_KEY, productTemplateKey] } })
        .select("key published.sections")
        .lean(),
    ]);
    const homePage = templatePages.find(
      (page) => page.key === HOME_TEMPLATE_KEY,
    );
    const productPage = templatePages.find(
      (page) => page.key === productTemplateKey,
    );

    // Depths must come from what the pages ACTUALLY render — vendors buy
    // positions marketed by these numbers. After each template's cutover
    // that is its published StorePage's sponsored section; the settings
    // values only stand in until a first publish exists.
    let homeLimit = doc?.homePage?.sections?.sponsoredProducts?.limit;
    let homeRailMissing = false;
    let productRailMissing = false;
    if (
      (homePage?.published && Array.isArray(homePage.published.sections)) ||
      (productPage?.published && Array.isArray(productPage.published.sections))
    ) {
      const { sanitizeSectionInstances } = await import(
        "@/lib/storefront/sections/instances"
      );
      if (homePage?.published && Array.isArray(homePage.published.sections)) {
        const rail = sanitizeSectionInstances(
          homePage.published.sections,
        ).find(
          (section) => section.type === "sponsored-rail" && section.visible,
        );
        if (rail) {
          homeLimit = Number(rail.settings.limit);
        } else {
          homeRailMissing = true;
        }
      }
      if (
        productPage?.published &&
        Array.isArray(productPage.published.sections)
      ) {
        const rail = sanitizeSectionInstances(
          productPage.published.sections,
        ).find(
          (section) =>
            section.type === "product-sponsored" && section.visible,
        );
        if (!rail) productRailMissing = true;
      }
    }

    const depths = resolvePlacementDepths({
      homeLimit,
      listingSlots: doc?.boosting?.listingSlots,
      productPageSlots: doc?.boosting?.productPageSlots,
    });
    // A published template with no (visible) sponsored section renders zero
    // sponsored slots on that surface — the ladder must say so instead of
    // selling invisible reach.
    if (homeRailMissing) depths.home = 0;
    if (productRailMissing) depths.productPage = 0;
    return depths;
  },
  ["sponsored-placement-depths"],
  { revalidate: 60, tags: [CACHE_TAGS.settings, CACHE_TAGS.storePages] },
);

/**
 * Whether a booked product may render at all. Exported so the delivery sampler
 * in lib/boosts.ts asks the SAME question the storefront asks — a credit for
 * "we could not show it" has to mean the same thing on both sides.
 */
export async function getSponsoredEligibilityFilter(options: {
  hideOutOfStock: boolean;
}) {
  const filter: Record<string, unknown> = {
    status: PRODUCT_STATUS.ACTIVE,
    ...(await getStorefrontProductConstraint()),
  };
  if (options.hideOutOfStock) filter.$and = [AVAILABLE_STOCK_QUERY];
  return filter;
}

type SponsoredProductCard = StorefrontProductCard & {
  sponsored: true;
  sponsoredCampaignId: string;
  sponsoredPosition: number;
};

/** One eligible product plus every still-open window it holds. */
export type SponsoredCandidate = StorefrontProductCard & {
  bookings: Array<{
    position: number;
    startsAt: string;
    endsAt: string;
    campaignId: string;
  }>;
};

type SponsoredLadderEntry = {
  position: number;
  card: SponsoredProductCard;
};

/**
 * Defensive cap, and it must never be able to drop a booking that is LIVE.
 *
 * The pool spans every still-open window, bounded by the ladder length times
 * (bookingHorizonDays + maxBookingDays). Two things make the cap safe: it sits
 * well above that, and the sort is `startsAt` ASCENDING — a booking that is
 * live now always has startsAt <= now and so sorts ahead of every future one,
 * which means truncation can only ever shed far-future bookings that re-enter
 * as nearer ones expire. Position order is applied later, in resolveLadderAt,
 * where it belongs.
 */
const LADDER_MAX_CANDIDATES = 2000;

export const getSponsoredLadderPool = unstable_cache(
  async (
    query: { hideOutOfStock?: boolean } = {},
  ): Promise<SponsoredCandidate[]> => {
    await connectDB();
    const filledAt = new Date();

    // `endsAt > filledAt` alone bounds the set to every still-open window, which
    // makes the cached payload a SUPERSET of the live ladder at any read instant
    // t >= filledAt. Served by the existing {status, endsAt} index, so the
    // render path adds none of its own.
    const bookings = await BoostCampaign.find({
      status: {
        $in: [BOOST_CAMPAIGN_STATUS.ACTIVE, BOOST_CAMPAIGN_STATUS.SCHEDULED],
      },
      endsAt: { $gt: filledAt },
    })
      .select("positionSnapshot.position productId startsAt endsAt")
      .sort({ startsAt: 1 })
      .limit(LADDER_MAX_CANDIDATES)
      .lean<
        Array<{
          _id: unknown;
          positionSnapshot?: { position?: number };
          productId: unknown;
          startsAt?: Date | null;
          endsAt?: Date | null;
        }>
      >();

    // Never truncate silently. A store that reaches the cap has outgrown the
    // assumed bound and needs the ceiling raised, not its deepest rungs dropped.
    if (bookings.length === LADDER_MAX_CANDIDATES) {
      console.warn(
        `Sponsored ladder pool hit LADDER_MAX_CANDIDATES (${LADDER_MAX_CANDIDATES}); far-future bookings are being excluded`,
      );
    }
    if (bookings.length === 0) return [];

    // Second query, SAME cache entry. Eligibility is applied here, so a product
    // that has gone out of stock / unpublished / vendor-suspended drops out of
    // the ladder and its rung falls to a regular filler.
    const products = await Product.find({
      _id: { $in: bookings.map((b) => b.productId) },
      ...(await getSponsoredEligibilityFilter({
        hideOutOfStock: query.hideOutOfStock !== false,
      })),
    })
      .select(PRODUCT_CARD_SELECT)
      .populate("vendorId", "storeName slug")
      .populate("category", "name slug")
      .lean();

    const serialized = serializeProductCards(products);

    const byProduct = new Map<string, SponsoredCandidate>();
    for (const card of serialized) {
      byProduct.set(String(card._id), { ...card, bookings: [] });
    }
    for (const booking of bookings) {
      const candidate = byProduct.get(String(booking.productId));
      if (!candidate) continue; // did not survive the eligibility filter
      if (!booking.startsAt || !booking.endsAt) continue;
      candidate.bookings.push({
        position: booking.positionSnapshot?.position ?? 0,
        startsAt: new Date(booking.startsAt).toISOString(),
        endsAt: new Date(booking.endsAt).toISOString(),
        campaignId: String(booking._id),
      });
    }
    return [...byProduct.values()].filter((c) => c.bookings.length > 0);
  },
  ["sponsored-ladder-pool"],
  { revalidate: 60, tags: [CACHE_TAGS.products, CACHE_TAGS.sponsoredProducts] },
);

/**
 * Which product holds which rung at `now`, ascending, at most one per rung.
 * Runs per request against the time-independent pool.
 */
export function resolveLadderAt(
  pool: SponsoredCandidate[],
  options: { now?: number; excludeProductId?: string } = {},
): SponsoredLadderEntry[] {
  const now = options.now ?? Date.now();
  const held = new Map<
    number,
    { entry: SponsoredLadderEntry; startsAt: number }
  >();

  for (const candidate of pool) {
    const id = String(candidate._id);
    if (options.excludeProductId && id === options.excludeProductId) continue;

    for (const booking of candidate.bookings) {
      const startsAt = Date.parse(booking.startsAt);
      const endsAt = Date.parse(booking.endsAt);
      if (!(startsAt <= now && endsAt > now)) continue;

      const { bookings: _drop, ...card } = candidate;
      const entry: SponsoredLadderEntry = {
        position: booking.position,
        card: {
          ...(card as StorefrontProductCard),
          sponsored: true as const,
          sponsoredCampaignId: booking.campaignId,
          sponsoredPosition: booking.position,
        },
      };

      const incumbent = held.get(booking.position);
      if (!incumbent) {
        held.set(booking.position, { entry, startsAt });
      } else {
        // Two products on one rung at one instant is a booking-layer bug —
        // {position, day} is what prevents it. Log UNCONDITIONALLY: pool order
        // is arbitrary, so logging in only one arrival order would silently
        // drop half of all double-sells.
        console.error(
          `Sponsored ladder conflict at position ${booking.position}: ${String(incumbent.entry.card._id)} vs ${id}`,
        );
        if (startsAt < incumbent.startsAt) {
          held.set(booking.position, { entry, startsAt });
        }
      }
      // One product may not hold two rungs at one instant.
      break;
    }
  }

  return [...held.values()]
    .map((h) => h.entry)
    .sort((a, b) => a.position - b.position);
}

/**
 * Strict-index composition: the product holding position N goes to visual slot
 * N, and every other slot takes the next unused organic card.
 *
 * Positions NEVER compact upward. If they did, a vendor buying the cheapest
 * rung would land on top whenever the rungs above were unsold — which, on any
 * store that is not sold out, is most days — and the ladder would collapse to a
 * single price. Do not "optimize" the gap away.
 */
export function buildSponsoredLane<T extends { _id: unknown }>(
  ladder: SponsoredLadderEntry[],
  fillers: T[],
  depth: number,
): Array<SponsoredProductCard | T> {
  if (depth <= 0) return [];
  const byPosition = new Map(
    ladder.filter((e) => e.position <= depth).map((e) => [e.position, e.card]),
  );
  // A sponsored product must never also appear as its own filler.
  const sponsoredIds = new Set(
    [...byPosition.values()].map((c) => String(c._id)),
  );
  const queue = fillers.filter((f) => !sponsoredIds.has(String(f._id)));

  const lane: Array<SponsoredProductCard | T> = [];
  let next = 0;
  for (let slot = 1; slot <= depth; slot += 1) {
    const sponsored = byPosition.get(slot);
    if (sponsored) {
      lane.push(sponsored);
      continue;
    }
    if (next < queue.length) lane.push(queue[next++]);
  }
  return lane;
}

/** True when the lane contains at least one paid card — the disclosure gate. */
export function laneHasSponsored(
  lane: Array<{ sponsored?: boolean }>,
): boolean {
  return lane.some((item) => item.sponsored === true);
}

/**
 * Splice the ladder into a listing page's own results.
 *
 * The listing is NOT a lane. The shopper's results already occupy every slot,
 * so there is nothing to fill — a rung either takes its slot or the organic
 * card already there keeps it. That difference is why this cannot go through
 * `buildSponsoredLane`: fed an empty filler queue, that function skips unsold
 * rungs entirely and returns a COMPACTED lane, whose indices are no longer
 * visual slots. Splicing by those indices promotes the rung below into a slot
 * nobody paid for — the single thing the whole ladder model exists to prevent.
 *
 * So the target is the rung's own number and nothing else: position N lands at
 * index N-1, clamped to the list. No running counter, because the organic cards
 * shifting right are exactly what makes room.
 *
 * A sponsored product already present in the results is MOVED to its slot
 * rather than badged where it happens to sit — it is what the vendor bought,
 * and it keeps the card from appearing twice.
 *
 * **Every ladder product comes out BEFORE any of them goes in.** Removing them
 * one at a time during placement re-runs the same promotion in a subtler form:
 * a boosted product that is also a high organic result sits ABOVE a rung placed
 * earlier, and taking it out drags that rung up a slot it did not buy. Removing
 * first makes each insert independent of the others — index N-1 in a list that
 * no later step shortens.
 *
 * Pure and exported so the arithmetic is testable; the grid is a server
 * component and its own splice loop was never covered.
 */
export function applyLadderToResults<
  T extends { _id: unknown; sponsored?: boolean; sponsoredCampaignId?: string },
>(
  products: T[],
  ladder: SponsoredLadderEntry[],
  depth: number,
): Array<T & { sponsoredInjected?: boolean }> {
  if (depth <= 0 || products.length === 0) return products;

  // Ascending, because each insert assumes every shallower rung already holds
  // its slot. `resolveLadderAt` sorts, but this is exported and pure — an
  // out-of-order caller would silently mis-place every rung.
  const rungs = ladder
    .filter((entry) => entry.position <= depth)
    .sort((a, b) => a.position - b.position);
  if (rungs.length === 0) return products;

  const organicById = new Map(products.map((p) => [String(p._id), p]));
  const claimed = new Set(rungs.map((entry) => String(entry.card._id)));
  const merged: Array<T & { sponsoredInjected?: boolean }> = products.filter(
    (p) => !claimed.has(String(p._id)),
  );

  for (const entry of rungs) {
    const organic = organicById.get(String(entry.card._id));
    const payload = organic
      ? {
          ...organic,
          sponsored: true,
          sponsoredCampaignId: entry.card.sponsoredCampaignId,
        }
      : ({
          ...(entry.card as unknown as T),
          sponsoredInjected: true,
        } as T & { sponsoredInjected: true });

    merged.splice(Math.min(entry.position - 1, merged.length), 0, payload);
  }

  return merged;
}
