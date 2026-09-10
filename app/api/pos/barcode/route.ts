import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Product } from "@/models";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { canAccessPOS } from "@/lib/access/rbac";
import { PRODUCT_STATUS, USER_ROLES } from "@/config/app.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { withApi } from "@/lib/api/handler";
import { cleanScannedCode, normalizeLookupCode } from "@/lib/catalog/barcodes";
import {
  getPOSMatchStock,
  resolvePOSBarcodeMatch,
  type POSBarcodeMatch,
  type POSLookupProduct,
} from "@/lib/pos/barcode-lookup";
import { applyPOSLocationStock } from "@/lib/pos/product-stock";
import { resolvePOSLocationId } from "@/lib/pos/resolve-location";

type POSBarcodeProduct = POSLookupProduct & {
  price?: number;
  comparePrice?: number;
  images?: string[];
  media?: unknown[];
  category?: unknown;
  vendorId?: unknown;
  productSource?: string;
  options?: unknown[];
  locationInventory?: Array<{ locationId?: string; quantity?: number }>;
};

function barcodeError(
  code: string,
  message: string,
  status: number,
  data?: Record<string, unknown>,
) {
  return NextResponse.json(
    {
      success: false,
      code,
      message,
      ...(data ? { data } : {}),
    },
    { status },
  );
}

function serializeMatch(match: POSBarcodeMatch<POSBarcodeProduct>) {
  return {
    field: match.field,
    scope: match.scope,
    product: match.product,
    variant: match.variant,
  };
}

/**
 * GET /api/pos/barcode?code=...
 * Exact normalized lookup for POS scanner input.
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    if (!(await canAccessPOS(session.user))) throw new AuthorizationError();

    await connectDB();

    const { searchParams } = new URL(request.url);
    const rawCode = searchParams.get("code") || "";
    const code = cleanScannedCode(rawCode);
    const normalizedCode = normalizeLookupCode(code);
    // Re-resolved rather than trusted, exactly as GET /api/pos/products does:
    // an unowned id would otherwise decide whether a scan reports OUT_OF_STOCK.
    const locationId = await resolvePOSLocationId(
      session.user,
      searchParams.get("locationId") || "",
    );

    if (!normalizedCode) {
      throw new ValidationError("Scan code is required");
    }

    const query: Record<string, unknown> = {
      status: PRODUCT_STATUS.ACTIVE,
    };

    if (session.user.role === USER_ROLES.VENDOR) {
      const vendor = await requireApprovedVendorByUserId(session.user.id);
      query.vendorId = vendor._id;
    } else {
      query["publishing.pointOfSale"] = true;
    }

    // Two-step lookup: the normalized fields are indexed, the raw fields are
    // not. A single $or containing the raw branches forced a collection scan
    // on EVERY scan; querying normalized-first keeps the hot path fully
    // indexed, and the raw fallback (for legacy docs whose normalized fields
    // were never backfilled) only runs when the indexed query found nothing.
    const selectFields =
      "name price comparePrice images media sku skuNormalized barcode barcodeNormalized stock locationInventory variants category vendorId productSource options";

    let rawProducts = await Product.find({
      ...query,
      $or: [
        { barcodeNormalized: normalizedCode },
        { skuNormalized: normalizedCode },
        { "variants.barcodeNormalized": normalizedCode },
        { "variants.skuNormalized": normalizedCode },
      ],
    })
      .select(selectFields)
      .limit(25)
      .lean<POSBarcodeProduct[]>();

    if (rawProducts.length === 0) {
      const rawCandidates = [code, code.toUpperCase(), rawCode].filter(Boolean);
      rawProducts = await Product.find({
        ...query,
        $or: [
          { barcode: { $in: rawCandidates } },
          { sku: { $in: rawCandidates } },
          { "variants.barcode": { $in: rawCandidates } },
          { "variants.sku": { $in: rawCandidates } },
        ],
      })
        .select(selectFields)
        .limit(25)
        .lean<POSBarcodeProduct[]>();
    }

    const products = rawProducts.map((product) =>
      applyPOSLocationStock(product, locationId),
    );
    const result = resolvePOSBarcodeMatch(products, code);

    if (result.status === "none") {
      return barcodeError(
        "NO_MATCH",
        "No product found for the scanned code.",
        404,
        { code, normalizedCode },
      );
    }

    if (result.status === "multiple") {
      return barcodeError(
        "MULTIPLE_MATCHES",
        "Multiple products match this code. Please fix duplicate SKU or barcode values.",
        409,
        {
          code,
          normalizedCode,
          matches: result.matches.map(serializeMatch),
        },
      );
    }

    if (
      !result.match.variant &&
      Array.isArray(result.match.product.variants) &&
      result.match.product.variants.length > 0
    ) {
      return barcodeError(
        "VARIANT_REQUIRED",
        "This product has variants. Scan a variant barcode or SKU.",
        409,
        { code, normalizedCode, match: serializeMatch(result.match) },
      );
    }

    if (getPOSMatchStock(result.match) <= 0) {
      return barcodeError(
        "OUT_OF_STOCK",
        "The scanned item is out of stock at this location.",
        409,
        { code, normalizedCode, match: serializeMatch(result.match) },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        status: "matched",
        code,
        normalizedCode,
        match: serializeMatch(result.match),
      },
    });
  },
);
