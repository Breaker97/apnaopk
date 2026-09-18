import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Product } from "@/models";
import { InventoryLocation } from "@/models/inventory-location.model";
import {
  locationOwnerFilter,
  vendorLocationScope,
} from "@/lib/inventory/inventory-location-scope";
import type { BarcodeFormat, BarcodeSource } from "@/lib/barcode/standards";
import type { InventoryListResult } from "@/lib/inventory/inventory-list";
import { parsePageLimit } from "@/lib/api/list-query";
import { escapeRegExp } from "@/lib/strings";
import { attachIncomingStock } from "@/lib/inventory/transfer-incoming";

/**
 * Vendor inventory list query.
 *
 * Shared by `GET /api/vendor/inventory` and the vendor inventory page's
 * server component so the endpoint and the rendered page always read a query
 * string the same way.
 *
 * Deliberately separate from the admin query in `lib/inventory-list.ts`: a
 * vendor's catalogue is small enough to expand and page in memory, where the
 * admin's spans every vendor and has to page inside the aggregation.
 * Callers resolve and authorise the vendor first and pass its id in.
 */

interface InventoryItem {
  productId: string;
  productName: string;
  productImage: string | null;
  variantId: string | null;
  variantName: string | null;
  sku: string;
  barcode: string;
  barcodeFormat?: BarcodeFormat;
  barcodeSource?: BarcodeSource;
  price: number;
  unavailable: number;
  committed: number;
  available: number;
  onHand: number;
  locationInventory: Array<{
    locationId: string;
    locationName: string;
    quantity: number;
  }>;
}

type RawLocationInventoryEntry = {
  locationId?: string | { toString: () => string };
  quantity?: number;
};

function mapLocationInventory(
  entries: RawLocationInventoryEntry[] | undefined,
  locationMap: Map<string, string>,
) {
  return (entries || []).map((loc) => {
    const locationId = String(loc.locationId || "");
    return {
      locationId,
      locationName: locationMap.get(locationId) || "Unknown",
      quantity: loc.quantity || 0,
    };
  });
}

function matchesStockLevel(stockLevel: string, available: number) {
  if (stockLevel === "in") return available > 0;
  if (stockLevel === "low") return available > 0 && available <= 10;
  if (stockLevel === "out") return available <= 0;
  return true;
}

function matchesBarcodeStatus(barcodeStatus: string, barcode: string) {
  const hasBarcode = barcode.trim().length > 0;
  if (barcodeStatus === "withBarcode") return hasBarcode;
  if (barcodeStatus === "withoutBarcode") return !hasBarcode;
  return true;
}

export async function fetchVendorInventoryList(
  searchParams: URLSearchParams,
  vendorId: Types.ObjectId | string,
): Promise<InventoryListResult> {
  const { page, limit } = parsePageLimit(searchParams, {
    defaultLimit: 50,
    maxLimit: 100,
  });
  const search = searchParams.get("search")?.trim() || "";
  const locationId = searchParams.get("location") || "";
  const stockLevel = searchParams.get("stockLevel") || "all";
  const barcodeStatus = searchParams.get("barcodeStatus") || "all";
  const sortBy = searchParams.get("sortBy") || "";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

  await connectDB();

  const query: Record<string, unknown> = { vendorId };

  if (search) {
    const escapedSearch = escapeRegExp(search);
    query.$or = [
      { name: { $regex: escapedSearch, $options: "i" } },
      { sku: { $regex: escapedSearch, $options: "i" } },
      { barcode: { $regex: escapedSearch, $options: "i" } },
      { "variants.sku": { $regex: escapedSearch, $options: "i" } },
      { "variants.barcode": { $regex: escapedSearch, $options: "i" } },
      { "variants.name": { $regex: escapedSearch, $options: "i" } },
    ];
  }

  // This vendor's own places only. The unscoped version handed every merchant
  // the names of every other merchant's warehouses.
  const locations = await InventoryLocation.find(
    locationOwnerFilter(vendorLocationScope(String(vendorId)), {
      isActive: true,
    }),
  )
    .sort({ isDefault: -1, name: 1 })
    .lean();

  const locationMap = new Map(
    locations.map((loc) => [String(loc._id), loc.name]),
  );

  const products = await Product.find(query)
    .select("name title images media variants sku barcode barcodeFormat barcodeSource price stock locationInventory")
    .sort({ name: 1 })
    .lean();

  const inventoryItems: InventoryItem[] = [];

  for (const product of products) {
    const productImage = product.media?.[0]?.url || product.images?.[0] || null;
    const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;

    if (hasVariants) {
      for (const variant of product.variants!) {
        const variantLocationInventory = mapLocationInventory(
          variant.locationInventory,
          locationMap,
        );

        const onHand = variant.stock || 0;
        const committed = 0;
        const unavailable = 0;
        const available = Math.max(0, onHand - committed - unavailable);
        const barcode = variant.barcode || product.barcode || "";

        if (!matchesStockLevel(stockLevel, available)) continue;
        if (!matchesBarcodeStatus(barcodeStatus, barcode)) continue;

        if (locationId) {
          const hasLocation = variantLocationInventory.some(
            (loc: { locationId: string }) => loc.locationId === locationId,
          );
          if (!hasLocation) continue;
        }

        let variantName = variant.name || "";
        if (!variantName && Array.isArray(variant.optionValues)) {
          variantName = variant.optionValues
            .map((ov: { value: string }) => ov.value)
            .join(" / ");
        }

        inventoryItems.push({
          productId: String(product._id),
          productName: product.title || product.name,
          productImage,
          variantId: String(variant._id),
          variantName,
          sku: variant.sku || product.sku || "",
          barcode,
          barcodeFormat: variant.barcodeFormat || product.barcodeFormat,
          barcodeSource: variant.barcodeSource || product.barcodeSource,
          price: variant.price ?? product.price ?? 0,
          unavailable,
          committed,
          available,
          onHand,
          locationInventory: variantLocationInventory,
        });
      }
    } else {
      const productLocationInventory = mapLocationInventory(
        product.locationInventory,
        locationMap,
      );
      const onHand = product.stock || 0;
      const committed = 0;
      const unavailable = 0;
      const available = Math.max(0, onHand - committed - unavailable);
      const barcode = product.barcode || "";

      if (!matchesStockLevel(stockLevel, available)) continue;
      if (!matchesBarcodeStatus(barcodeStatus, barcode)) continue;

      if (locationId) {
        const hasLocation = productLocationInventory.some(
          (loc: { locationId: string }) => loc.locationId === locationId,
        );
        if (!hasLocation) continue;
      }

      inventoryItems.push({
        productId: String(product._id),
        productName: product.title || product.name,
        productImage,
        variantId: null,
        variantName: null,
        sku: product.sku || "",
        barcode,
        barcodeFormat: product.barcodeFormat,
        barcodeSource: product.barcodeSource,
        price: product.price || 0,
        unavailable,
        committed,
        available,
        onHand,
        locationInventory: productLocationInventory,
      });
    }
  }

  const sortSelectors: Record<string, (item: InventoryItem) => string | number> = {
    productName: (item) => item.productName || "",
    sku: (item) => item.sku || "",
    barcode: (item) => item.barcode || "",
    available: (item) => item.available || 0,
    onHand: (item) => item.onHand || 0,
    committed: (item) => item.committed || 0,
    unavailable: (item) => item.unavailable || 0,
  };
  const getSortValue = sortSelectors[sortBy];

  if (getSortValue) {
    inventoryItems.sort((a, b) => {
      const aValue = getSortValue(a);
      const bValue = getSortValue(b);

      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortOrder === "asc" ? aValue - bValue : bValue - aValue;
      }

      const compare = String(aValue).localeCompare(String(bValue), undefined, {
        sensitivity: "base",
        numeric: true,
      });
      return sortOrder === "asc" ? compare : -compare;
    });
  }

  const skip = (page - 1) * limit;
  const total = inventoryItems.length;
  const paginatedItems = await attachIncomingStock(
    inventoryItems.slice(skip, skip + limit),
    locationId || undefined,
  );
  const totalPages = Math.ceil(total / limit);

  return {
    items: paginatedItems,
    locations: locations.map((loc) => ({
      _id: String(loc._id),
      name: loc.name,
      isDefault: loc.isDefault,
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, totalPages),
  };
}
