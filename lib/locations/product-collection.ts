import "server-only";

/**
 * "Can I collect this one, near me?" — answered on the product page.
 *
 * The grid answers a coarser question: the card badge says this seller keeps a
 * counter in range. On the page for a single item that is no longer good
 * enough, because the shopper is about to decide, and the difference between
 * "this shop is near you" and "your size is on that shop's shelf" is the whole
 * point of collecting rather than waiting for a courier.
 *
 * Resolved server-side, on its own small query, rather than by handing the
 * browser the per-branch counts to work it out. Those counts are a merchant's
 * operational data — how much of what sits in which shop — and publishing them
 * on every product page would let a competitor read the lot with a page fetch.
 */

import { InventoryLocation } from "@/models/inventory-location.model";
import { Product } from "@/models";
import { connectDB } from "@/lib/db";
import {
  branchStocksLine,
  type BranchInventoryRow,
  type BranchStockLine,
} from "@/lib/inventory/pickup-branch-stock";
import {
  distanceKm,
  isUsableLatLng,
  latLngFromGeoPoint,
  normalizeRadiusKm,
  type LatLng,
} from "@/lib/locations/vendor-geo";
import {
  VENDOR_ADDRESS_DISPLAY,
  resolveVendorStoreVisibility,
} from "@/lib/vendors/vendor-address";
import { Vendor } from "@/models";

type ProductCollectionOffer = {
  /** The branch a shopper would walk into. */
  branchName: string;
  /** The neighbourhood. The exact address stays back until there is an order. */
  pickupArea?: string;
  /**
   * Straight-line km. Absent when the vendor publishes no address — the same
   * rule the product cards follow: hiding an address hides *where the seller
   * is*, not *that collection exists*.
   */
  distanceKm?: number;
  /**
   * Which variants this branch can actually hand over, as ids. `null` for a
   * product with no variants, where the product's own counts are the answer.
   *
   * Carried so the buy box can withdraw the offer when the shopper switches to
   * a colour that branch does not have, instead of showing one claim for a
   * page that sells several different things.
   */
  variantIds: string[] | null;
};

/**
 * How many of a vendor's nearest branches to consider.
 *
 * Ordered by `$near`, so the ones dropped are always the furthest. A merchant
 * with more than ten collection points inside one shopper's radius is not a
 * case worth paying for on every product view.
 */
const BRANCH_SCAN_LIMIT = 10;

type ProductStockShape = {
  shipping?: { isPhysicalProduct?: boolean } | null;
  inventory?: {
    tracked?: boolean;
    continueSellingWhenOutOfStock?: boolean;
  } | null;
  locationInventory?: BranchInventoryRow[] | null;
  variants?: Array<{
    _id?: unknown;
    locationInventory?: BranchInventoryRow[] | null;
  }>;
};

/** One unit of whatever is being looked at, for the branch-stock rule. */
function stockLine(
  product: ProductStockShape,
  rows: BranchInventoryRow[] | null | undefined,
): BranchStockLine {
  return {
    productId: "",
    // One unit: the page is asking "could I collect this at all", not "could I
    // collect the eleven the shopper has not typed into the quantity box yet".
    quantity: 1,
    policy: { shipping: product.shipping, inventory: product.inventory },
    locationInventory: rows,
  };
}

export async function resolveProductCollectionOffer(input: {
  productId: string;
  vendorId?: string | null;
  /** Raw location values as the listing pages carry them. */
  lat?: string;
  lng?: string;
  radius?: string;
}): Promise<ProductCollectionOffer | null> {
  const vendorId = input.vendorId ? String(input.vendorId) : "";
  if (!vendorId || !input.productId) return null;

  const lat = Number(input.lat);
  const lng = Number(input.lng);
  // A city name is an area, not a point, so there is nothing to measure from
  // and no nearest branch to name. The picker makes the same distinction.
  if (!isUsableLatLng(lat, lng)) return null;
  const center: LatLng = { lat, lng };
  const radiusKm = normalizeRadiusKm(input.radius);

  await connectDB();

  const [product, branches, vendor] = await Promise.all([
    // Projected deliberately: this is the only place per-branch counts are
    // read for the storefront, and they must not travel any further than this
    // function's own arithmetic.
    Product.findById(input.productId)
      .select(
        "shipping.isPhysicalProduct inventory locationInventory variants._id variants.locationInventory",
      )
      .lean<ProductStockShape | null>(),
    InventoryLocation.find({
      vendorId,
      pickupEnabled: true,
      isActive: { $ne: false },
      // Matches `pickupLocationsForVendor`: a branch with nowhere to send
      // anyone is dropped at checkout, so offering it here would promise a
      // collection the checkout then refuses.
      address: { $nin: [null, ""] },
      geo: {
        $near: {
          $geometry: { type: "Point", coordinates: [center.lng, center.lat] },
          ...(radiusKm ? { $maxDistance: radiusKm * 1000 } : {}),
        },
      },
    })
      .limit(BRANCH_SCAN_LIMIT)
      .select("_id name pickupArea geo")
      .lean<
        Array<{
          _id: unknown;
          name?: string;
          pickupArea?: string;
          geo?: unknown;
        }>
      >(),
    Vendor.findById(vendorId)
      .select("storeVisibility.addressDisplay")
      .lean<{ storeVisibility?: unknown } | null>(),
  ]);

  if (!product || branches.length === 0) return null;

  // Hiding an address hides *where the seller is*, not *that collection
  // exists* — the same split the product cards make. So a hidden-address
  // vendor still gets the offer, just without a number attached.
  const publishesAddress =
    resolveVendorStoreVisibility(vendor?.storeVisibility).addressDisplay !==
    VENDOR_ADDRESS_DISPLAY.HIDDEN;
  // Nothing downloadable is ever collected, whatever the seller's counter says.
  if (product.shipping?.isPhysicalProduct === false) return null;

  const variants = Array.isArray(product.variants) ? product.variants : [];
  const hasVariants = variants.length > 0;

  // `branches` is already nearest-first, so the first that can supply anything
  // is the one worth naming.
  for (const branch of branches) {
    const branchId = String(branch._id);

    const variantIds = hasVariants
      ? variants
          .filter((variant) =>
            branchStocksLine(stockLine(product, variant.locationInventory), branchId),
          )
          .map((variant) => String(variant._id))
      : null;

    const supplies = hasVariants
      ? (variantIds?.length ?? 0) > 0
      : branchStocksLine(stockLine(product, product.locationInventory), branchId);
    if (!supplies) continue;

    const point = latLngFromGeoPoint(branch.geo);

    return {
      branchName: (branch.name || "").trim(),
      pickupArea: branch.pickupArea?.trim() || undefined,
      distanceKm:
        point && publishesAddress ? distanceKm(center, point) : undefined,
      variantIds,
    };
  }

  return null;
}
