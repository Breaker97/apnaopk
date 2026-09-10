import { connectDB } from "@/lib/db";
import { Product } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { USER_ROLES } from "@/config/app.config";
import { getSettings } from "@/models/settings.model";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { isValidObjectId, validatePartialBody } from "@/lib/api/validate";
import { UpdateProductSchema } from "@/lib/validations";
import { auditDelete, auditUpdate, createAuditContext } from "@/lib/audit";
import { syncProductCollections, removeProductFromAllCollections, updateAllCollectionProductCounts } from "@/lib/catalog/collections";
import { syncProductCategory } from "@/lib/catalog/categories";
import { syncProductAggregates } from "@/models/product.model";
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
  deleteRemovedProductDigitalFiles,
} from "@/lib/products/digital-assets";
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
  areCountryValuesEquivalent,
  isCountryAllowed,
} from "@/lib/intl/country-availability";
import {
  allowedLocationIds,
  vendorLocationScope,
} from "@/lib/inventory/inventory-location-scope";

function toHandle(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

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

    const body = await validatePartialBody(request, UpdateProductSchema);

    delete (body as Record<string, unknown>).featured;

    // Digital files must come from this vendor's own private-storage scope.
    assertOwnDigitalAssetKeys(
      (body as { digitalAssets?: { storageKey: string }[] }).digitalAssets,
      String(vendor._id),
    );

    const existing = await Product.findOne({ _id: id, vendorId: vendor._id })
      .select("slug collectionIds category status sku barcode barcodeFormat barcodeSource variants shipping.isPhysicalProduct shipping.countryOfOrigin digitalAssets")
      .lean();
    if (!existing) {
      return notFoundResponse("Product");
    }

    const submittedCountryOfOrigin = body.shipping?.countryOfOrigin?.trim();
    if (
      submittedCountryOfOrigin &&
      !areCountryValuesEquivalent(
        submittedCountryOfOrigin,
        existing.shipping?.countryOfOrigin,
      ) &&
      !isCountryAllowed(
        submittedCountryOfOrigin,
        settings.general?.countryAvailability,
      )
    ) {
      throw new ValidationError({
        "shipping.countryOfOrigin": ["Selected country is not available"],
      });
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
        { _id: id, vendorId: vendor._id },
        {
          $set: updateSet,
          ...(Object.keys(clearedFields).length > 0
            ? { $unset: clearedFields }
            : {}),
        },
        { new: true, runValidators: true }
      )
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
    // ranges, variant stock roll-up, stock policy) — see the admin route.
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
    const populatedCategory = product.category as { _id?: unknown } | string | null;
    const newCategoryId = populatedCategory
      ? typeof populatedCategory === "object" && populatedCategory._id
        ? String(populatedCategory._id)
        : String(populatedCategory)
      : null;
    await syncProductCategory(oldCategoryId, newCategoryId);

    // Recount automated collections when product status changes
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

    return successResponse({ message: "Product deleted successfully" });
  },
);
