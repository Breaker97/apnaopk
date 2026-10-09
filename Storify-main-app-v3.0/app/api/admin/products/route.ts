import { NextRequest } from "next/server";
import { connectDB, mongoose } from "@/lib/db";
import { Product } from "@/models";
import {
  createdResponse,
  successResponse,
} from "@/lib/api/response";
import {
  handleApiError,
  AuthenticationError,
  AuthorizationError,
} from "@/lib/api/errors";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { PRODUCT_STATUS, USER_ROLES } from "@/config/app.config";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { validateQuery, validateBody } from "@/lib/api/validate";
import { ProductListQuerySchema, CreateProductSchema } from "@/lib/validations";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { syncProductCollections } from "@/lib/catalog/collections";
import { syncProductCategory } from "@/lib/catalog/categories";
import { ensureDefaultVendorId } from "@/lib/vendors/multi-vendor";
import { getSettings, getSettingsLean } from "@/models/settings.model";
import {
  assertProductFeaturesAllowed,
  resolveProductFeatures,
} from "@/lib/products/product-features";
import {
  assignMissingProductBarcodes,
  extractClearedProductFields,
  sanitizeOptionsForMongoose,
  sanitizePreorderSettings,
  sanitizeProductLocationInventory,
  sanitizeVariantsForMongoose,
} from "@/lib/products/sanitize";
import {
  assertProductBarcodesAreUnique,
} from "@/lib/products/barcode-validation";
import { assignProductLookupCodes } from "@/lib/products/barcode-normalization";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { fetchAdminProductList } from "@/lib/catalog/product-list";
import {
  hasStaffScope,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { markProductsForCatalogSync } from "@/lib/meta-catalog/sync-marks";
import {
  releaseProductBarcodeRegistry,
  reserveProductBarcodeRegistry,
  syncProductBarcodeRegistry,
} from "@/lib/products/barcode-registry";
import {
  adminProductCreateVendorId,
  allowedLocationIds,
  productStockScope,
  storeProfileUnavailable,
} from "@/lib/inventory/inventory-location-scope";
import { productSlugBase, uniqueProductSlug } from "@/lib/products/product-slug";
import { createAuditContext } from "@/lib/audit";
import { auditCatalogCreate, PRODUCT_AUDIT } from "@/lib/catalog/catalog-audit";

/**
 * GET /api/admin/products
 * Get all products for admin
 */
export async function GET(request: NextRequest) {
  try {
    // Check admin auth
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_PRODUCTS],
    );

    // Rate limiting
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:products:list",
      "lenient",
      session.user.role
    );

    // Validate query params (search is auto-sanitized for regex safety)
    const { page, limit, search, status, vendor, source, sortOrder, onSale, boostable } =
      validateQuery(request, ProductListQuerySchema);

    await connectDB();
    const settings = await getSettings();
    const isMultiVendor = Boolean(settings.multiVendorMode?.enabled);

    const list = await fetchAdminProductList(
      { page, limit, search, status, vendor, source, sortOrder, onSale, boostable },
      { staffScope: access.staffScope, isMultiVendor },
    );

    return successResponse({
      data: list.items,
      pagination: {
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
        hasNext: list.page < list.totalPages,
        hasPrev: list.page > 1,
      },
      filters: { vendors: list.vendorOptions },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/admin/products
 * Create a new product (admin can assign to any vendor)
 * In single-vendor mode, auto-assigns to default vendor
 */
export async function POST(request: NextRequest) {
  try {
    // Check admin auth
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();
    let staffScope: StaffAccessScope | null | undefined;
    if (session.user.role !== USER_ROLES.ADMIN) {
      const access = await assertAdminOrStaffPermissions(
        session as unknown as { user: { id: string; role: string } },
        [
          STAFF_PERMISSIONS.CREATE_PRODUCTS,
          STAFF_PERMISSIONS.MANAGE_PRODUCTS,
        ],
      );
      staffScope = access.staffScope;
      if (hasStaffScope(access.staffScope) && !access.staffScope?.vendorIds.length) {
        throw new AuthorizationError(
          "Staff must be assigned to a vendor before creating products",
        );
      }
    }

    // Rate limiting for product creation
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:products:create",
      "moderate",
      session.user.role
    );

    await connectDB();
    const body = await validateBody(request, CreateProductSchema);
    const productData = body;
    // `shipping.countryOfOrigin` is deliberately not checked against the
    // store's country availability: it is customs data about where the goods
    // were manufactured, not a country the store sells or ships to.

    // Admin products belong to the default store vendor. Scoped staff create
    // under their first assigned vendor; unrestricted legacy staff fall back
    // to the default vendor for backward compatibility.
    let vendorId = adminProductCreateVendorId(staffScope);
    if (!vendorId) {
      const house = await ensureDefaultVendorId({
        preferredOwnerId: session.user.id,
      });
      if (!house.vendorId) throw storeProfileUnavailable(house.problem);
      vendorId = house.vendorId;
    }

    const title =
      typeof productData.title === "string" && productData.title.trim().length
        ? productData.title.trim()
        : String(productData.name || "").trim();

    // Unique across every vendor: the storefront resolves a product by slug
    // alone, so two vendors sharing one would leave a product unreachable.
    const productId = new mongoose.Types.ObjectId();
    const slug = await uniqueProductSlug(
      productSlugBase({
        handle: productData.seo?.handle,
        title,
        sku: productData.sku,
        productId,
      }),
    );

    // Sanitize collections for Mongoose: strip client UUIDs, coerce
    // optionValue strings → objects, drop empty fields. Same helper used by
    // PUT to keep create + update paths consistent.
    // Stock may only be recorded at the new product's owner's locations; the
    // field is a bare id, so nothing else stops a payload naming someone
    // else's warehouse.
    const ownLocationIds = await allowedLocationIds(
      productStockScope(String(vendorId), staffScope?.locationIds),
    );
    const cleanedVariants = sanitizeVariantsForMongoose(
      productData.variants,
      ownLocationIds,
    );
    const cleanedOptions = sanitizeOptionsForMongoose(productData.options);
    const cleanedLocationInventory = sanitizeProductLocationInventory(
      (productData as unknown as Record<string, unknown>).locationInventory,
      ownLocationIds,
    );
    const cleanedPreorder = sanitizePreorderSettings(
      (productData as unknown as Record<string, unknown>).preorder,
    );

    // Settings → Products: a format, pre-order or quote the store has
    // switched off cannot be started here.
    assertProductFeaturesAllowed({
      features: resolveProductFeatures(await getSettingsLean()),
      product: {
        shipping: productData.shipping,
        priceOnRequest: productData.priceOnRequest,
        preorder: cleanedPreorder as never,
        variants: cleanedVariants as never,
      },
    });

    const normalizedProductData = {
      ...productData,
      name: title,
      title,
      slug,
      handle: slug,
      seo: { ...(productData.seo || {}), handle: slug },
      status: productData.status || PRODUCT_STATUS.DRAFT,
      variants: cleanedVariants,
      options: cleanedOptions,
      ...(cleanedPreorder !== undefined ? { preorder: cleanedPreorder } : {}),
      ...(cleanedLocationInventory !== undefined
        ? { locationInventory: cleanedLocationInventory }
        : {}),
    };
    // An untouched optional money field arrives as null; on create there is
    // nothing to clear, so just don't write it.
    extractClearedProductFields(
      normalizedProductData as unknown as Record<string, unknown>,
    );
    assignMissingProductBarcodes(
      normalizedProductData as unknown as Record<string, unknown>,
    );
    assignProductLookupCodes(
      normalizedProductData as unknown as Record<string, unknown> & {
        variants?: Record<string, unknown>[];
      },
    );
    await assertProductBarcodesAreUnique(
      Product,
      normalizedProductData as unknown as Record<string, unknown> & {
        variants?: Record<string, unknown>[];
      },
    );

    const product = new Product({
      ...normalizedProductData,
      _id: productId,
      vendorId,
      productSource: "admin",
    });
    await product.validate();
    try {
      await reserveProductBarcodeRegistry(
        String(product._id),
        product.toObject() as unknown as Record<string, unknown>,
      );
      await product.save();
      await syncProductBarcodeRegistry(
        String(product._id),
        product.toObject() as unknown as Record<string, unknown>,
      );
    } catch (error) {
      await releaseProductBarcodeRegistry(String(product._id));
      throw error;
    }

    // Sync collection memberships
    const newCollectionIds = (product.collectionIds || []).map(String);
    if (newCollectionIds.length > 0) {
      await syncProductCollections(product._id.toString(), [], newCollectionIds);
    }

    // Update category product count
    if (product.category) {
      await syncProductCategory(null, String(product.category));
    }

    // The product's identity and price, not the document: a created product
    // carries its variants, images and stock, none of which a log row wants.
    await auditCatalogCreate(
      createAuditContext(request, session),
      PRODUCT_AUDIT,
      product,
    );

    revalidateProductContent({ slugs: [product.slug] });
    await markProductsForCatalogSync([product._id]);

    return createdResponse(product);
  } catch (error) {
    return handleApiError(error);
  }
}
