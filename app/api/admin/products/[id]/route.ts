import { Product } from "@/models";
import { connectDB } from "@/lib/db";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { UpdateProductSchema } from "@/lib/validations";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { validatePartialBody, isValidObjectId } from "@/lib/api/validate";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { auditDelete, auditUpdate, createAuditContext } from "@/lib/audit";
import { syncProductCollections, removeProductFromAllCollections, updateAllCollectionProductCounts } from "@/lib/catalog/collections";
import { syncProductCategory } from "@/lib/catalog/categories";
import { syncProductAggregates } from "@/models/product.model";
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
import { ValidationError } from "@/lib/api/errors";
import { assignProductLookupCodes } from "@/lib/products/barcode-normalization";
import {
  assertProductBarcodesAreUnique,
  buildBarcodeValidationPayload,
} from "@/lib/products/barcode-validation";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { withApi } from "@/lib/api/handler";
import {
  releaseProductBarcodeRegistry,
  reserveProductBarcodeRegistry,
  syncProductBarcodeRegistry,
} from "@/lib/products/barcode-registry";
import { cleanupDeletedProductReferences } from "@/lib/products/product-cleanup";
import { releaseBoostInventoryIfProductWentDark } from "@/lib/boosts/boosts";
import {
  deleteProductDigitalFiles,
  deleteRemovedProductDigitalFiles,
} from "@/lib/products/digital-assets";
import { getSettings } from "@/models/settings.model";
import {
  areCountryValuesEquivalent,
  isCountryAllowed,
} from "@/lib/intl/country-availability";
import {
  allowedLocationIds,
  resolveLocationScope,
} from "@/lib/inventory/inventory-location-scope";

function toHandle(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

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

    const body = await validatePartialBody(request, UpdateProductSchema);

    const existing = await Product.findOne(
      mergeScopeFilter({ _id: id }, buildStaffProductScopeFilter(access.staffScope)),
    ).select("vendorId slug collectionIds category status sku barcode barcodeFormat barcodeSource variants shipping.isPhysicalProduct shipping.countryOfOrigin digitalAssets").lean();
    if (!existing) {
      return notFoundResponse("Product");
    }

    const submittedCountryOfOrigin = body.shipping?.countryOfOrigin?.trim();
    if (
      submittedCountryOfOrigin &&
      !areCountryValuesEquivalent(
        submittedCountryOfOrigin,
        existing.shipping?.countryOfOrigin,
      )
    ) {
      const settings = await getSettings();
      if (
        !isCountryAllowed(
          submittedCountryOfOrigin,
          settings.general?.countryAvailability,
        )
      ) {
        throw new ValidationError({
          "shipping.countryOfOrigin": ["Selected country is not available"],
        });
      }
    }

    if (isProductFormatChange(existing.shipping, body.shipping)) {
      throw new ValidationError({
        shipping: [
          "A product cannot be switched between physical and digital after it is created. Create a new product instead.",
        ],
      });
    }

    const oldCollectionIds = (existing.collectionIds || []).map(String);
    const oldCategoryId = existing.category ? String(existing.category) : null;

    const updateSet: Record<string, unknown> = { ...(body as unknown as Record<string, unknown>) };

    // Apply the same sanitization the create route does so update writes
    // can never produce CastErrors on embedded subdocs. Critically this:
    // - strips client UUID _id from variants (Mongoose expects ObjectId)
    // - coerces variant.optionValues entries to objects (string → object)
    // - drops empty-string fields that should be unset
    // - normalizes locationInventory shape
    // Stock may only be recorded at a location this store owns; the field is a
    // bare id, so nothing else stops a payload naming someone else's warehouse.
    const ownLocationIds =
      "variants" in updateSet || "locationInventory" in updateSet
        ? await allowedLocationIds(
            await resolveLocationScope(session.user, "write"),
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
      const nextSlug = toHandle(rawHandle);
      if (nextSlug && nextSlug !== existing.slug) {
        // Global slug uniqueness — storefront resolves by slug alone.
        const conflict = await Product.exists({
          slug: nextSlug,
          _id: { $ne: id },
        });
        if (conflict) {
          updateSet.slug = `${nextSlug}-${Date.now()}`;
        } else {
          updateSet.slug = nextSlug;
        }
      }

      updateSet.handle = updateSet.slug || toHandle(rawHandle);
      updateSet.seo = { ...(body.seo || {}), handle: updateSet.handle };
    }

    let product;
    try {
      await reserveProductBarcodeRegistry(id, nextBarcodePayload);
      product = await Product.findOneAndUpdate(
        mergeScopeFilter({ _id: id }, buildStaffProductScopeFilter(access.staffScope)),
        {
          $set: updateSet,
          ...(Object.keys(clearedFields).length > 0
            ? { $unset: clearedFields }
            : {}),
        },
        { new: true, runValidators: true }
      )
        .populate("vendorId", "storeName slug")
        .populate("category", "name slug")
        .lean();
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

    // Recompute the derived fields $set can't maintain (price/compare-at
    // ranges, variant stock roll-up, stock policy). Unconditional: a
    // single-variant product has ranges too, and they drive the price the
    // storefront prints.
    await syncProductAggregates(id);

    // Remove the private files this update detached. Best-effort: an orphaned
    // object must never fail the merchant's save.
    await deleteRemovedProductDigitalFiles(
      existing.digitalAssets,
      product.digitalAssets,
    );

    // Sync collection memberships
    const newCollectionIds = (product.collectionIds || []).map(String);
    await syncProductCollections(id, oldCollectionIds, newCollectionIds);

    // Sync category product counts
    // Note: product.category is populated, so we need to get the _id from the object
    const populatedCategory = product.category as { _id?: unknown } | string | null;
    const newCategoryId = populatedCategory
      ? typeof populatedCategory === "object" && populatedCategory._id
        ? String(populatedCategory._id)
        : String(populatedCategory)
      : null;
    await syncProductCategory(oldCategoryId, newCategoryId);

    // Recount automated collections when product status changes (affects which products match)
    const oldStatus = (existing as Record<string, unknown>).status;
    if (updateSet.status && updateSet.status !== oldStatus) {
      updateAllCollectionProductCounts().catch((err) =>
        console.error("Failed to update collection counts:", err)
      );
    }

    // A booked position whose product just went dark burns a GLOBAL rung
    // nobody else can buy for the rest of the booking, so the future days go
    // back on the calendar now rather than at expiry. Awaited: the response
    // carries what was released, and the caller has just been warned about it.
    const boostReleases = await releaseBoostInventoryIfProductWentDark(
      id,
      existing as unknown as { status?: string; publishing?: { onlineStore?: boolean } | null },
      product as unknown as { status?: string; publishing?: { onlineStore?: boolean } | null },
    );

    const auditContext = createAuditContext(request, session);
    await auditUpdate(
      auditContext,
      "product",
      id,
      existing as unknown as Record<string, unknown>,
      product as unknown as Record<string, unknown>,
    );

    revalidateProductContent({
      slugs: [existing.slug, product.slug],
    });

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

    return successResponse({ message: "Product deleted successfully" });
  },
);
