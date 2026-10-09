import { Product } from "@/models";
import { connectDB } from "@/lib/db";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  applyStockBaseline,
  ProductUpdateWithBaselineSchema,
} from "@/lib/products/stock-baseline";
import { carryPreorderCounters } from "@/lib/products/preorder-counters";
import { validatePartialBody, isValidObjectId } from "@/lib/api/validate";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { auditDelete, createAuditContext } from "@/lib/audit";
import { removeProductFromAllCollections } from "@/lib/catalog/collections";
import { syncProductCategory } from "@/lib/catalog/categories";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import {
  buildStaffProductScopeFilter,
  hasStaffScope,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import { USER_ROLES } from "@/config/app.config";
import {
  assignMissingProductBarcodes,
  extractClearedProductFields,
  sanitizeOptionsForMongoose,
  sanitizePreorderSettings,
  sanitizeProductLocationInventory,
  sanitizeVariantsForMongoose,
} from "@/lib/products/sanitize";
import { isProductFormatChange } from "@/lib/catalog/product-shipping";
import {
  assertProductFeaturesAllowed,
  resolveProductFeatures,
} from "@/lib/products/product-features";
import { getSettingsLean } from "@/models/settings.model";
import { ConflictError, ValidationError } from "@/lib/api/errors";
import { assignProductLookupCodes } from "@/lib/products/barcode-normalization";
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
  deleteProductDigitalFiles,
} from "@/lib/products/digital-assets";
import {
  allowedLocationIds,
  productStockScope,
  resolveLocationScope,
} from "@/lib/inventory/inventory-location-scope";
import { slugify } from "@/lib/strings";
import { uniqueProductSlug } from "@/lib/products/product-slug";

/**
 * GET /api/admin/products/[id]
 * Get a single product by ID
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_PRODUCTS],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:products:read",
      "lenient",
      session.user.role
    );

    await connectDB();

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Product");

    const product = await Product.findOne(
      mergeScopeFilter({ _id: id }, buildStaffProductScopeFilter(access.staffScope)),
    )
      .populate("vendorId", "storeName slug")
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
 * PUT /api/admin/products/[id]
 * Update a product
 */
export const PUT = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [
        STAFF_PERMISSIONS.EDIT_PRODUCTS,
        STAFF_PERMISSIONS.MANAGE_PRODUCTS,
      ],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:products:update",
      "moderate",
      session.user.role
    );

    await connectDB();

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Product");

    const { stockBaseline, ...body } = await validatePartialBody(
      request,
      ProductUpdateWithBaselineSchema,
    );

    const existing = await Product.findOne(
      mergeScopeFilter({ _id: id }, buildStaffProductScopeFilter(access.staffScope)),
    ).select("vendorId slug collectionIds category status sku barcode barcodeFormat barcodeSource preorder priceOnRequest variants shipping.isPhysicalProduct shipping.countryOfOrigin digitalAssets").lean();
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

    // Apply the same sanitization the create route does so update writes
    // can never produce CastErrors on embedded subdocs. Critically this:
    // - strips client UUID _id from variants (Mongoose expects ObjectId)
    // - coerces variant.optionValues entries to objects (string → object)
    // - drops empty-string fields that should be unset
    // - normalizes locationInventory shape
    // Stock may only be recorded at the product owner's locations (and a
    // staff member's assigned ones) — the owner's, not the editor's: an admin
    // editing a vendor's product writes the vendor's shelves. The field is a
    // bare id, so nothing else stops a payload naming someone else's warehouse.
    const ownLocationIds =
      "variants" in updateSet || "locationInventory" in updateSet
        ? await allowedLocationIds(
            existing.vendorId
              ? productStockScope(
                  String(existing.vendorId),
                  access.staffScope?.locationIds,
                )
              : await resolveLocationScope(session.user, "write"),
          )
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

    // Settings → Products. Only what this save switches ON is judged, so a
    // pre-order or quote already running stays editable after the store
    // switches the feature off — and can be switched off itself.
    assertProductFeaturesAllowed({
      features: resolveProductFeatures(await getSettingsLean()),
      product: {
        priceOnRequest: updateSet.priceOnRequest as boolean | undefined,
        preorder: updateSet.preorder as never,
        variants: updateSet.variants as never,
      },
      stored: existing as never,
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

    if (
      session.user.role !== USER_ROLES.ADMIN &&
      hasStaffScope(access.staffScope) &&
      updateSet.vendorId !== undefined &&
      !access.staffScope?.vendorIds.includes(String(updateSet.vendorId))
    ) {
      return notFoundResponse("Product");
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
      const productFilter = mergeScopeFilter({ _id: id }, buildStaffProductScopeFilter(access.staffScope));
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
          .populate("vendorId", "storeName slug")
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
 * DELETE /api/admin/products/[id]
 * Delete a product
 */
export const DELETE = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [
        STAFF_PERMISSIONS.DELETE_PRODUCTS,
        STAFF_PERMISSIONS.MANAGE_PRODUCTS,
      ],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:products:delete",
      "strict",
      session.user.role
    );

    await connectDB();

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Product");

    const scopeQuery = mergeScopeFilter(
      { _id: id },
      buildStaffProductScopeFilter(access.staffScope),
    );
    const before = await Product.findOne(scopeQuery).lean();
    const product = await Product.findOneAndDelete(scopeQuery);

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
      (before || product.toObject?.() || product) as unknown as Record<string, unknown>,
    );

    revalidateProductContent({ slugs: [before?.slug, product.slug] });
    // Its items leave Meta on the live sync's next round.
    await markProductsForCatalogSync([id]);

    return successResponse({ message: "Product deleted successfully" });
  },
);
