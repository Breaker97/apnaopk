import { Product, Vendor } from "@/models";
import { connectDB } from "@/lib/db";
import { PRODUCT_STATUS } from "@/config/app.config";
import { listResult, type ListResult } from "@/lib/api/list-query";
import {
  buildStaffProductScopeFilter,
  mergeScopeFilter,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";

/**
 * Admin/staff product list query.
 *
 * Shared by `GET /api/admin/products` and the products page's server
 * component so the endpoint and the rendered page can never disagree about
 * what a given query string means.
 */

interface AdminProductListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  vendor?: string;
  source?: string;
  /** Deals only: a compare-at price above the price, on the product or a variant. */
  onSale?: boolean;
  sortOrder?: "asc" | "desc";
}

interface AdminProductListContext {
  staffScope?: StaffAccessScope | null;
  isMultiVendor: boolean;
}

interface VendorFilterOption {
  label: string;
  value: string;
}

interface AdminProductListResult extends ListResult<unknown> {
  /** Vendors present in the scoped result set, for the vendor filter. */
  vendorOptions: VendorFilterOption[];
}

/**
 * List views render neither long-form copy nor SEO metadata, and products
 * carry a lot of both. Excluding them keeps the payload small without
 * breaking a column or a filter.
 */
const LIST_EXCLUDE = "-description -shortDescription -seo -attributes";

async function buildProductListFilter(
  params: AdminProductListParams,
  { staffScope, isMultiVendor }: AdminProductListContext,
) {
  const { search, status, vendor, source, onSale } = params;
  const query: Record<string, unknown> = {};

  // The same test the storefront's deal shelves use, so a product the deals
  // picker offers is one the deals panel would also show unasked.
  if (onSale) {
    query.$and = [
      ...((query.$and as Record<string, unknown>[]) || []),
      {
        $expr: {
          $or: [
            { $gt: ["$comparePrice", "$price"] },
            {
              $anyElementTrue: {
                $map: {
                  input: { $ifNull: ["$variants", []] },
                  as: "variant",
                  in: { $gt: ["$$variant.comparePrice", "$$variant.price"] },
                },
              },
            },
          ],
        },
      },
    ];
  }

  // `search` arrives regex-escaped from SafeSearchSchema.
  if (search) {
    const matchingVendors = isMultiVendor
      ? await Vendor.find({ storeName: { $regex: search, $options: "i" } })
          .select("_id")
          .lean()
      : [];
    const matchingVendorIds = matchingVendors.map((item) => item._id);

    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { sku: { $regex: search, $options: "i" } },
      ...(matchingVendorIds.length
        ? [{ vendorId: { $in: matchingVendorIds } }]
        : []),
    ];
  }

  if (status && status !== "all") query.status = status;
  if (isMultiVendor && vendor && vendor !== "all") query.vendorId = vendor;

  if (isMultiVendor && source === "vendor") {
    query.productSource = "vendor";
  } else if (isMultiVendor && source === "admin") {
    query.$and = [
      ...((query.$and as Record<string, unknown>[]) || []),
      {
        $or: [
          { productSource: "admin" },
          { productSource: { $exists: false } },
        ],
      },
    ];
  }

  return mergeScopeFilter(query, buildStaffProductScopeFilter(staffScope));
}

interface AdminProductStats {
  totalProducts: number;
  activeProducts: number;
  draftProducts: number;
  outOfStockProducts: number;
  totalInventoryUnits: number;
}

/**
 * Counters for the products stats strip.
 *
 * One pass with conditional accumulators, replacing both of the shapes this
 * grew into: a five-branch `$facet` on the admin page (whose sub-pipelines
 * cannot use an index, so five collection scans) and five separate
 * `countDocuments` round-trips on the staff page.
 *
 * `inventoryCount` resolves variant stock the way the product list does — sum
 * the variants when there are any, otherwise the product's own `stock`.
 */
export async function fetchAdminProductStats(
  staffScope?: StaffAccessScope | null,
): Promise<AdminProductStats> {
  await connectDB();

  const scope = buildStaffProductScopeFilter(staffScope);
  const [result] = await Product.aggregate([
    ...(Object.keys(scope).length > 0 ? [{ $match: scope }] : []),
    {
      $project: {
        _id: 0,
        status: 1,
        inventoryCount: {
          $cond: [
            { $gt: [{ $size: { $ifNull: ["$variants", []] } }, 0] },
            {
              $sum: {
                $map: {
                  input: { $ifNull: ["$variants", []] },
                  as: "variant",
                  in: { $ifNull: ["$$variant.stock", 0] },
                },
              },
            },
            { $ifNull: ["$stock", 0] },
          ],
        },
      },
    },
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        activeProducts: {
          $sum: { $cond: [{ $eq: ["$status", PRODUCT_STATUS.ACTIVE] }, 1, 0] },
        },
        draftProducts: {
          $sum: { $cond: [{ $eq: ["$status", PRODUCT_STATUS.DRAFT] }, 1, 0] },
        },
        outOfStockProducts: {
          $sum: { $cond: [{ $lte: ["$inventoryCount", 0] }, 1, 0] },
        },
        totalInventoryUnits: { $sum: "$inventoryCount" },
      },
    },
  ]);

  return {
    totalProducts: result?.totalProducts ?? 0,
    activeProducts: result?.activeProducts ?? 0,
    draftProducts: result?.draftProducts ?? 0,
    outOfStockProducts: result?.outOfStockProducts ?? 0,
    totalInventoryUnits: result?.totalInventoryUnits ?? 0,
  };
}

export async function fetchAdminProductList(
  params: AdminProductListParams,
  context: AdminProductListContext,
): Promise<AdminProductListResult> {
  await connectDB();

  const { page, limit, sortOrder } = params;
  const query = await buildProductListFilter(params, context);
  const direction = sortOrder === "asc" ? 1 : -1;

  const [products, total, vendorIds] = await Promise.all([
    Product.find(query)
      .select(LIST_EXCLUDE)
      .populate("vendorId", "storeName slug")
      .populate("category", "name slug")
      .sort({ createdAt: direction })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Object.keys(query).length === 0
      ? Product.estimatedDocumentCount()
      : Product.countDocuments(query),
    context.isMultiVendor
      ? Product.distinct("vendorId", query)
      : Promise.resolve([]),
  ]);

  const vendors = context.isMultiVendor
    ? await Vendor.find({ _id: { $in: vendorIds } })
        .select("storeName slug")
        .sort({ storeName: 1 })
        .lean()
    : [];

  return {
    ...listResult(products as unknown[], page, limit, total),
    vendorOptions: vendors.map((item) => ({
      label: item.storeName,
      value: String(item._id),
    })),
  };
}
