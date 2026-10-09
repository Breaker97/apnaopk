import { connectDB } from "@/lib/db";
import { Product } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { USER_ROLES } from "@/config/app.config";
import { getSettings } from "@/models/settings.model";
import { assertProductPreorderAllowed } from "@/lib/orders/preorder-gating";
import {
  assertProductFeaturesAllowed,
  resolveProductFeatures,
} from "@/lib/products/product-features";
import { storeCanCollectDeferredBalance } from "@/lib/payments/deferred-balance";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  applyStockBaseline,
  ProductUpdateWithBaselineSchema,
} from "@/lib/products/stock-baseline";
import { carryPreorderCounters } from "@/lib/products/preorder-counters";
import { isValidObjectId, validatePartialBody } from "@/lib/api/validate";
import { auditDelete, createAuditContext } from "@/lib/audit";
import { removeProductFromAllCollections } from "@/lib/catalog/collections";
import { syncProductCategory } from "@/lib/catalog/categories";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { assertVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import {
  assignMissingProductBarcodes,
  extractClearedProductFields,
  sanitizeOptionsForMongoose,
  sanitizePreorderSettings,
  sanitizeProductLocationInventory,
  sanitizeVariantsForMongoose,
} from "@/lib/products/sanitize";
import { isProductFormatChange } from "@/lib/catalog/product-shipping";
import { assignProductLookupCodes } from "@/lib/products/barcode-normalization";
import {
  assertOwnDigitalAssetKeys,
  deleteProductDigitalFiles,
} from "@/lib/products/digital-assets";
import {
  assertProductBarcodesAreUnique,
  buildBarcodeValidationPayload,
} from "@/lib/products/barcode-validation";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { markProductsForCatalogSync } from "@/lib/meta-catalog/sync-marks";
import { runPreorderDateSyncJobs } from "@/lib/orders/preorder-terms-sync";
import { afterResponse } from "@/lib/after-response";
import { withApi } from "@/lib/api/handler";
import {
  releaseProductBarcodeRegistry,
  reserveProductBarcodeRegistry,
  syncProductBarcodeRegistry,
} from "@/lib/products/barcode-registry";
import { cleanupDeletedProductReferences } from "@/lib/products/product-cleanup";
import {
  runProductAfterSave,
  type ProductSaveSide,
} from "@/lib/products/product-after-save";
import {
  allowedLocationIds,
  vendorLocationScope,
} from "@/lib/inventory/inventory-location-scope";
import { slugify } from "@/lib/strings";
import { uniqueProductSlug } from "@/lib/products/product-slug";

/**
 * GET /api/vendor/products/[id]
 * Get a single product by ID (vendor must own it)
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    if (
      session.user.role !== USER_ROLES.VENDOR &&
      session.user.role !== USER_ROLES.ADMIN
    ) {
      throw new AuthorizationError();
    }
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_PRODUCTS,
      "You do not have permission to view products",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:products:read",
      "lenient",
      session.user.role
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });
    if (!vendor) throw new AuthorizationError("Vendor profile not found");

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Product");
    const product = await Product.findOne({ _id: id, vendorId: vendor._id })
      .populate("category", "name slug")
      .populate("brand", "name slug logo")
      .lean();

    if (!product) {
      return notFoundResponse("Product");
    }

    return successResponse(product);
  },
);

/**
 * PUT /api/vendor/products/[id]
 * Update a product (vendor must own it)
 */
export const PUT = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    if (
      session.user.role !== USER_ROLES.VENDOR &&
      session.user.role !== USER_ROLES.ADMIN
    ) {
      throw new AuthorizationError();
    }
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.EDIT_PRODUCTS,
      "You do not have permission to edit products",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:products:update",
      "moderate",
      session.user.role
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });
    if (!vendor) throw new AuthorizationError("Vendor profile not found");

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Product");

    const { stockBaseline, ...body } = await validatePartialBody(
      request,
      ProductUpdateWithBaselineSchema,
    );

    // Not the vendor's to set: `featured` is the platform's to grant, and a
    // `vendorId` in the body would hand the product to another store.
    delete (body as Record<string, unknown>).featured;
    delete (body as Record<string, unknown>).vendorId;

    // Digital files must come from this vendor's own private-storage scope.
    assertOwnDigitalAssetKeys(
      (body as { digitalAssets?: { storageKey: string }[] }).digitalAssets,
      String(vendor._id),
    );

    const existing = await Product.findOne({ _id: id, vendorId: vendor._id })
      .select("slug price preorder priceOnRequest collectionIds category status sku barcode barcodeFormat barcodeSource variants shipping.isPhysicalProduct shipping.countryOfOrigin digitalAssets")
      .lean();
    if (!existing) {
      return notFoundResponse("Product");
    }

    // `shipping.countryOfOrigin` is deliberately unrestricted — see the
    // create route: where a product was made is not where the store sells.

    if (isProductFormatChange(existing.shipping, body.shipping)) {
      throw new ValidationError({
        shipping: [
          "A product cannot be switched between physical and digital after it is created. Create a new product instead.",
        ],
      });
    }

    const updateSet: Record<string, unknown> = { ...(body as unknown as Record<string, unknown>) };

    // Sanitize embedded arrays for safe Mongoose write — same helper used
    // by admin POST/PUT and vendor POST.
    // Stock may only be recorded at one of this vendor's own locations.
    const ownLocationIds =
      "variants" in updateSet || "locationInventory" in updateSet
        ? await allowedLocationIds(vendorLocationScope(String(vendor._id)))
        : undefined;
    if ("variants" in updateSet) {
      updateSet.variants = sanitizeVariantsForMongoose(
        updateSet.variants,
        ownLocationIds,
      );
    }
    if ("options" in updateSet) {
      updateSet.options = sanitizeOptionsForMongoose(updateSet.options);
    }
    if ("locationInventory" in updateSet) {
      const cleaned = sanitizeProductLocationInventory(
        updateSet.locationInventory,
        ownLocationIds,
      );
      if (cleaned === undefined) delete updateSet.locationInventory;
      else updateSet.locationInventory = cleaned;
    }
    if ("preorder" in updateSet) {
      const cleaned = sanitizePreorderSettings(updateSet.preorder);
      if (cleaned === undefined) delete updateSet.preorder;
      else updateSet.preorder = cleaned;
    }

    // Settings → Products: only what this save switches ON is judged, so a
    // quote or pre-order already running can still be edited or switched off.
    assertProductFeaturesAllowed({
      features: resolveProductFeatures(settings),
      product: {
        priceOnRequest: updateSet.priceOnRequest as boolean | undefined,
        preorder: updateSet.preorder as never,
        variants: updateSet.variants as never,
      },
      stored: existing as never,
    });

    // Only what this request is actually changing is judged. An untouched
    // pre-order on a product being renamed is left alone: a tightened limit
    // must not turn every unrelated edit into a rejection.
    assertProductPreorderAllowed({
      product: {
        price:
          (updateSet.price as number | undefined) ??
          (existing as { price?: number }).price,
        preorder: updateSet.preorder as never,
        variants: updateSet.variants as never,
      },
      stored: existing as unknown as {
        preorder?: never;
        variants?: never;
      },
      policy: settings.preorder,
      vendor,
      storeCanCollectBalance: storeCanCollectDeferredBalance(settings.payment),
    });

    const hasVariantPayload =
      Array.isArray(updateSet.variants) && updateSet.variants.length > 0;
    const hasBarcodePayload = Object.prototype.hasOwnProperty.call(
      updateSet,
      "barcode",
    );
    if (hasVariantPayload || hasBarcodePayload) {
      assignMissingProductBarcodes(updateSet);
    }
    assignProductLookupCodes(
      updateSet as Record<string, unknown> & {
        variants?: Record<string, unknown>[];
      },
    );

    // Split out the fields the form cleared with an explicit null. Runs AFTER
    // the barcode helpers on purpose: a format sent back to "auto" arrives as
    // null and assignMissingProductBarcodes re-detects it from the barcode, so
    // it ends up in $set rather than $unset (and never in both, which Mongo
    // rejects as a conflicting path).
    const clearedFields = extractClearedProductFields(updateSet);

    // Normalize category payload when frontend sends populated object shape.
    if (Object.prototype.hasOwnProperty.call(updateSet, "category")) {
      const categoryValue = updateSet.category;
      if (
        categoryValue &&
        typeof categoryValue === "object" &&
        !Array.isArray(categoryValue)
      ) {
        const categoryObj = categoryValue as { _id?: unknown; id?: unknown };
        const candidate = categoryObj._id ?? categoryObj.id;
        if (candidate) {
          updateSet.category = String(candidate);
        } else {
          throw new ValidationError("Invalid category value");
        }
      } else if (
        typeof categoryValue === "string" &&
        categoryValue.trim() === "[object Object]"
      ) {
        throw new ValidationError("Invalid category value");
      }
    }

    const nextTitle =
      typeof body.title === "string" && body.title.trim().length
        ? body.title.trim()
        : typeof body.name === "string" && body.name.trim().length
          ? body.name.trim()
          : undefined;
    if (nextTitle) {
      updateSet.title = nextTitle;
      updateSet.name = nextTitle;
    }

    const nextBarcodePayload = buildBarcodeValidationPayload(
      existing as unknown as Record<string, unknown> & {
        variants?: Record<string, unknown>[];
      },
      updateSet as Record<string, unknown> & {
        variants?: Record<string, unknown>[];
      },
    );
    await assertProductBarcodesAreUnique(
      Product,
      nextBarcodePayload,
      { excludeProductId: id },
    );

    const rawHandle =
      typeof body?.seo?.handle === "string" && body.seo.handle.trim()
        ? body.seo.handle.trim()
        : undefined;

    if (rawHandle) {
      const nextSlug = slugify(rawHandle);
      if (nextSlug && nextSlug !== existing.slug) {
        // Global slug uniqueness — storefront resolves by slug alone.
        updateSet.slug = await uniqueProductSlug(nextSlug, id);
      }

      // A handle with no Latin letters slugifies to nothing: the product keeps
      // the URL it has instead of storing an empty handle.
      updateSet.handle = updateSet.slug || nextSlug || existing.slug;
      updateSet.seo = { ...(body.seo || {}), handle: updateSet.handle };
    }

    let product;
    // Whether the save that went through moved a release date.
    let datesMoved = false;
    try {
      await reserveProductBarcodeRegistry(id, nextBarcodePayload);
      // The stock this form loaded is merged with stock that moved while it
      // was open, and the write is pinned to the copy merged against: a sale
      // or transfer landing in between makes it miss and merge again.
      const productFilter = { _id: id, vendorId: vendor._id };
      const submittedStock = {
        stock: updateSet.stock as number | undefined,
        locationInventory: updateSet.locationInventory as
          | Array<{ locationId: string; quantity: number }>
          | undefined,
        variants: updateSet.variants as
          | Array<{ _id?: unknown; name?: string; stock?: number; locationInventory?: Array<{ locationId: string; quantity: number }> }>
          | undefined,
      };
      for (let attempt = 0; attempt < 3; attempt++) {
        const stockPin = await applyStockBaseline({
          filter: productFilter,
          updateSet,
          submitted: submittedStock,
          baseline: stockBaseline,
          writableLocationIds: ownLocationIds,
        });
        // Reservation counters come from the database, never the form — see
        // `carryPreorderCounters`. Pinned to the earlier of the two reads, so
        // anything that moved after it makes the write miss and read again.
        const counterPin = await carryPreorderCounters({
          filter: productFilter,
          updateSet,
        });
        const pin = stockPin ?? counterPin;
        datesMoved = Boolean(counterPin?.termsUpdate);
        product = await Product.findOneAndUpdate(
          { ...productFilter, ...(pin ? { updatedAt: pin.updatedAt } : {}) },
          {
            // A moved release date bumps the terms revision and records the
            // propagation job in this same write — see `carryPreorderCounters`.
            $set: { ...updateSet, ...(counterPin?.termsUpdate?.$set || {}) },
            ...(counterPin?.termsUpdate ? { $inc: counterPin.termsUpdate.$inc } : {}),
            ...(Object.keys(clearedFields).length > 0
              ? { $unset: clearedFields }
              : {}),
          },
          { returnDocument: "after", runValidators: true }
        )
          .populate("category", "name slug")
          .lean();
        if (product || !pin) break;
        if (attempt === 2) {
          throw new ConflictError(
            "Stock on this product is changing right now. Save again in a moment.",
          );
        }
      }
    } catch (error) {
      await syncProductBarcodeRegistry(
        id,
        existing as unknown as Record<string, unknown>,
      );
      throw error;
    }

    if (!product) {
      await syncProductBarcodeRegistry(
        id,
        existing as unknown as Record<string, unknown>,
      );
      return notFoundResponse("Product");
    }
    await syncProductBarcodeRegistry(
      id,
      product as unknown as Record<string, unknown>,
    );

    // Aggregates, files, collections, category counts, boosted days, the
    // Activity Log, the storefront cache and the pre-order waitlists.
    const { boostReleases } = await runProductAfterSave({
      productId: id,
      before: existing as unknown as ProductSaveSide,
      after: product as unknown as ProductSaveSide,
      savedStatus: updateSet.status,
      audit: createAuditContext(request, session),
      defer: afterResponse,
    });
    // A moved date reaches the orders waiting on the old one through the
    // durable job this save recorded; this only wakes the worker sooner. If
    // it never runs, the scheduled job does the same work.
    if (datesMoved) {
      afterResponse(() =>
        runPreorderDateSyncJobs({ budgetMs: 20_000, maxJobs: 1 }).catch((err) =>
          console.error("Failed to start a pre-order date propagation:", err),
        ),
      );
    }

    return successResponse({
      ...(product as unknown as Record<string, unknown>),
      ...(boostReleases.length > 0 ? { boostReleases } : {}),
    });
  },
);

/**
 * DELETE /api/vendor/products/[id]
 * Delete a product (vendor must own it)
 */
export const DELETE = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    if (
      session.user.role !== USER_ROLES.VENDOR &&
      session.user.role !== USER_ROLES.ADMIN
    ) {
      throw new AuthorizationError();
    }
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.DELETE_PRODUCTS,
      "You do not have permission to delete products",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:products:delete",
      "moderate",
      session.user.role
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });
    if (!vendor) throw new AuthorizationError("Vendor profile not found");

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Product");

    const before = await Product.findOne({ _id: id, vendorId: vendor._id }).lean();
    const product = await Product.findOneAndDelete({
      _id: id,
      vendorId: vendor._id,
    });

    if (!product) {
      return notFoundResponse("Product");
    }

    await releaseProductBarcodeRegistry(id);

    // Remove from all collections and update counts
    await removeProductFromAllCollections(id);

    // Update category product count
    if (before?.category) {
      await syncProductCategory(String(before.category), null);
    }

    // Remove orphaned references (reviews, wishlist/cart entries, coupon lists)
    await cleanupDeletedProductReferences(id);

    // Delete private digital files (best-effort, never blocks the delete).
    await deleteProductDigitalFiles(before?.digitalAssets);

    const auditContext = createAuditContext(request, session);
    await auditDelete(
      auditContext,
      "product",
      id,
      (before || product.toObject()) as unknown as Record<string, unknown>,
    );

    revalidateProductContent({ slugs: [before?.slug, product.slug] });
    // Its items leave Meta on the live sync's next round.
    await markProductsForCatalogSync([id]);

    return successResponse({ message: "Product deleted successfully" });
  },
);
