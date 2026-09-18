import { connectDB } from "@/lib/db";
import { Product } from "@/models";
import { paginatedResponse, createdResponse } from "@/lib/api/response";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { assertVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { checkPlanLimit } from "@/lib/vendors/vendor-limits";
import { getSettings } from "@/models/settings.model";
import { assertProductPreorderAllowed } from "@/lib/orders/preorder-gating";
import { storeCanCollectDeferredBalance } from "@/lib/payments/deferred-balance";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { validateBody, validateQuery } from "@/lib/api/validate";
import { AdminListQuerySchema, CreateProductSchema } from "@/lib/validations";
import { auditCreate, createAuditContext } from "@/lib/audit";
import { syncProductCollections } from "@/lib/catalog/collections";
import {
  assertCategoryAcceptsProducts,
  syncProductCategory,
} from "@/lib/catalog/categories";
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
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { withApi } from "@/lib/api/handler";
import { assertOwnDigitalAssetKeys } from "@/lib/products/digital-assets";
import { fetchVendorProductList } from "@/lib/vendors/vendor-product-list";
import {
  releaseProductBarcodeRegistry,
  reserveProductBarcodeRegistry,
  syncProductBarcodeRegistry,
} from "@/lib/products/barcode-registry";
import { isCountryAllowed } from "@/lib/intl/country-availability";
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
 * GET /api/vendor/products
 * Get products for the current vendor
 * Requires: VIEW_PRODUCTS permission
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    // Check RBAC permission
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_PRODUCTS,
      "You do not have permission to view products",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:products:list",
      "lenient",
      session.user.role
    );

    const { page, limit, search, status, sortBy, sortOrder } = validateQuery(
      request,
      AdminListQuerySchema,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    // Get vendor for this user
    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });

    const list = await fetchVendorProductList(
      { page, limit, search, status, sortBy, sortOrder },
      vendor._id,
    );

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);

/**
 * POST /api/vendor/products
 * Create a new product for the current vendor
 * Requires: CREATE_PRODUCTS permission
 */
export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    // Check RBAC permission
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.CREATE_PRODUCTS,
      "You do not have permission to create products",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:products:create",
      "moderate",
      session.user.role
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    // Get vendor for this user
    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });
    if (!vendor) throw new AuthorizationError("Vendor profile not found");

    // Enforce the vendor plan's product cap (plans off / no plan / null limit =
    // unlimited). Pass the already-loaded vendor.planId and settings so this
    // adds no extra DB reads.
    const productLimit = await checkPlanLimit(vendor._id, "products", {
      planId: vendor.planId,
      settings,
    });
    if (!productLimit.allowed) {
      throw new ValidationError({
        plan: [
          `Your plan allows up to ${productLimit.limit} products (you have ${productLimit.current}). Upgrade your plan to add more.`,
        ],
      });
    }

    const body = await validateBody(request, CreateProductSchema);
    await assertCategoryAcceptsProducts(body.category);
    const countryOfOrigin = body.shipping?.countryOfOrigin?.trim();
    if (
      countryOfOrigin &&
      !isCountryAllowed(
        countryOfOrigin,
        settings.general?.countryAvailability,
      )
    ) {
      throw new ValidationError({
        "shipping.countryOfOrigin": ["Selected country is not available"],
      });
    }

    // Digital files must come from this vendor's own private-storage scope.
    assertOwnDigitalAssetKeys(body.digitalAssets, String(vendor._id));

    const title =
      typeof body.title === "string" && body.title.trim().length
        ? body.title.trim()
        : String(body.name || "").trim();

    const baseHandle =
      typeof body?.seo?.handle === "string" && body.seo.handle.trim()
        ? body.seo.handle.trim()
        : title;

    const slug = toHandle(baseHandle);

    // Sanitize embedded arrays — same helper used by admin POST/PUT.
    // Stock may only be recorded at one of this vendor's own locations.
    const ownLocationIds = await allowedLocationIds(
      vendorLocationScope(String(vendor._id)),
    );
    const cleanedVariants = sanitizeVariantsForMongoose(
      body.variants,
      ownLocationIds,
    );
    const cleanedOptions = sanitizeOptionsForMongoose(
      (body as unknown as Record<string, unknown>).options,
    );
    const cleanedLocationInventory = sanitizeProductLocationInventory(
      (body as unknown as Record<string, unknown>).locationInventory,
      ownLocationIds,
    );
    const cleanedPreorder = sanitizePreorderSettings(
      (body as unknown as Record<string, unknown>).preorder,
    );

    // A pre-order commits the PLATFORM to a refund it cannot decline, so the
    // limits are checked before the product exists rather than at sell time.
    assertProductPreorderAllowed({
      product: {
        price: (body as unknown as { price?: number }).price,
        preorder: cleanedPreorder as never,
        variants: cleanedVariants as never,
      },
      policy: settings.preorder,
      vendor,
      storeCanCollectBalance: storeCanCollectDeferredBalance(settings.payment),
    });

    // Global slug uniqueness — the storefront resolves products by slug alone,
    // so a slug shared across vendors makes one product unreachable.
    const existingProduct = await Product.findOne({ slug });
    const finalSlug = existingProduct ? `${slug}-${Date.now()}` : slug;
    const normalizedProductData = {
      ...(body as unknown as Record<string, unknown>),
      variants: cleanedVariants,
    };
    // An untouched optional money field arrives as null; on create there is
    // nothing to clear, so just don't write it.
    extractClearedProductFields(normalizedProductData);
    assignMissingProductBarcodes(normalizedProductData);
    assignProductLookupCodes(
      normalizedProductData as Record<string, unknown> & {
        variants?: Record<string, unknown>[];
      },
    );
    await assertProductBarcodesAreUnique(
      Product,
      normalizedProductData as Record<string, unknown> & {
        variants?: Record<string, unknown>[];
      },
    );

    const product = new Product({
      ...normalizedProductData,
      name: title,
      title,
      vendorId: vendor._id,
      productSource: "vendor",
      slug: finalSlug,
      handle: finalSlug,
      seo: { ...(body.seo || {}), handle: finalSlug },
      options: cleanedOptions,
      ...(cleanedPreorder !== undefined ? { preorder: cleanedPreorder } : {}),
      ...(cleanedLocationInventory !== undefined
        ? { locationInventory: cleanedLocationInventory }
        : {}),
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

    const auditContext = createAuditContext(request, session);
    await auditCreate(
      auditContext,
      "product",
      String(product._id),
      product.toObject() as unknown as Record<string, unknown>,
    );

    revalidateProductContent({ slugs: [product.slug] });

    return createdResponse(product);
  },
);
