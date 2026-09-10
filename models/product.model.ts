import { mongoose } from "@/lib/db";
import { PRODUCT_STATUS } from "@/config/app.config";
import { generateBarcode, generateSku } from "@/lib/products/codes";
import {
  assignProductLookupCodes,
  findDuplicateBarcodeCodes,
} from "@/lib/products/barcode-normalization";
import type {
  IProduct,
  ProductAttribute,
  ProductMedia,
  ProductOption,
  ProductVariant,
} from "@/types";
import { normalizeProductShippingData } from "@/lib/catalog/product-shipping";

const { Schema, models, model } = mongoose;

function hasBarcode(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function rememberBarcode(used: Set<string>, value: unknown) {
  if (hasBarcode(value)) used.add(value.trim());
}

const ProductAttributeSchema = new Schema<ProductAttribute>(
  {
    name: { type: String, required: true },
    value: { type: String, required: true },
  },
  { _id: false }
);

const ProductMediaSchema = new Schema<ProductMedia>(
  {
    _id: { type: String, required: true },
    type: {
      type: String,
      enum: ["image", "video", "model", "external_video"],
      default: "image",
      required: true,
    },
    url: { type: String, required: true },
    filename: { type: String, trim: true },
    alt: { type: String },
    position: { type: Number, default: 0 },
    mimeType: { type: String },
    size: { type: Number },
    width: { type: Number },
    height: { type: Number },
    thumbnailUrl: { type: String },
    // external_video only (Shopify's ExternalVideo): parsed once on save so
    // the storefront builds iframe URLs from a known-safe template instead of
    // re-parsing arbitrary stored URLs.
    provider: { type: String, enum: ["youtube", "vimeo"] },
    embedId: { type: String, trim: true },
  },
  { _id: false }
);

const ProductDigitalAssetSchema = new Schema(
  {
    _id: { type: String, required: true },
    filename: { type: String, required: true, trim: true },
    storageKey: { type: String, required: true },
    size: { type: Number, default: 0 },
    mimeType: { type: String },
    position: { type: Number, default: 0 },
  },
  { _id: false }
);

// Option Value Schema (for individual option values like "Small", "Red")
const OptionValueSchema = new Schema(
  {
    _id: { type: String, required: true },
    value: { type: String, required: true, trim: true },
    colorCode: { type: String, trim: true },
    position: { type: Number, default: 0 },
  },
  { _id: false }
);

// Updated ProductOptionSchema with id, position, and structured values
const ProductOptionSchema = new Schema<ProductOption>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    // How this option renders on the storefront. Absent = fall back to the
    // name-based rule (a "Color" option shows swatches, others show pills).
    visual: {
      type: String,
      enum: ["rectangle", "dropdown", "circle", "color", "color_label", "radio"],
    },
    values: { type: [OptionValueSchema], default: [] },
    position: { type: Number, default: 0 },
  },
  { _id: false }
);

const ProductInventorySchema = new Schema(
  {
    tracked: { type: Boolean, default: true },
    quantity: { type: Number, default: 0, min: 0 },
    continueSellingWhenOutOfStock: { type: Boolean, default: false },
  },
  { _id: false }
);

// Product-level stock policy — the two switches on the Inventory card.
// Deliberately has no `quantity`: product stock lives in `stock` /
// `locationInventory` and nothing else may shadow it (the variant-level
// `inventory.quantity` above already drifts between sales, and one such field
// is enough). Read it through lib/products/stock-policy.ts, never directly.
const ProductStockPolicySchema = new Schema(
  {
    tracked: { type: Boolean, default: true },
    continueSellingWhenOutOfStock: { type: Boolean, default: false },
  },
  { _id: false },
);

const PreorderSettingsSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    releaseDate: { type: Date },
    message: { type: String, trim: true, maxlength: 500 },
    limit: { type: Number, min: 0, default: 0 },
    reservedQuantity: { type: Number, min: 0, default: 0 },
    preorderOnly: { type: Boolean, default: false },
    autoConvert: { type: Boolean, default: true },
    paymentMode: {
      type: String,
      enum: ["full", "deposit", "pay_later"],
      default: "full",
    },
    depositType: {
      type: String,
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    depositValue: { type: Number, min: 0, default: 0 },
    supplierEta: { type: Date },
    batchName: { type: String, trim: true, maxlength: 120 },
  },
  { _id: false },
);

// Variant Option Value Schema (tracks which option/value combination a variant has)
const VariantOptionValueSchema = new Schema(
  {
    optionId: { type: String, required: true },
    optionName: { type: String },
    valueId: { type: String, required: true },
    value: { type: String, required: true },
    colorCode: { type: String, trim: true },
  },
  { _id: false }
);

const ProductVariantSchema = new Schema<ProductVariant>({
  name: { type: String, required: true },
  sku: { type: String, trim: true, uppercase: true },
  skuNormalized: { type: String, trim: true, uppercase: true },
  barcode: { type: String, trim: true },
  barcodeNormalized: { type: String, trim: true, uppercase: true },
  barcodeFormat: {
    type: String,
    enum: ["ean13", "upca", "gtin14", "code128"],
  },
  barcodeSource: {
    type: String,
    enum: ["manufacturer", "gs1", "internal"],
  },
  price: { type: Number, required: true, min: 0 },
  comparePrice: { type: Number, min: 0 },
  cost: { type: Number, min: 0 },
  taxable: { type: Boolean, default: true },
  stock: { type: Number, required: true, min: 0, default: 0 },
  attributes: { type: [ProductAttributeSchema], default: [] },
  image: { type: String },
  // Updated: structured option values instead of string array
  optionValues: { type: [VariantOptionValueSchema], default: [] },
  inventory: { type: ProductInventorySchema, default: undefined },
  locationInventory: {
    type: [
      new Schema(
        {
          locationId: { type: String, required: true },
          // No min:0 — online sales deliberately draw from the fullest
          // location and may push a single location slightly negative
          // (aggregate stock stays >= 0). A min here would make the next
          // full-document save() (any product edit) fail validation on data
          // the guarded updateOne paths legitimately wrote.
          quantity: { type: Number, required: true, default: 0 },
        },
        { _id: false },
      ),
    ],
    default: [],
  },
  preorder: { type: PreorderSettingsSchema, default: undefined },
  // Undefined inherits the product-level physical-product setting.
  requiresShipping: { type: Boolean },
  weight: { type: Number, min: 0 },
  weightUnit: { type: String, enum: ["g", "kg", "lb", "oz"] },
  // Parcel size, for carrier rating. A variant only overrides the product's
  // box when all three axes are given — a half-filled variant would otherwise
  // produce a nonsense envelope.
  length: { type: Number, min: 0 },
  width: { type: Number, min: 0 },
  height: { type: Number, min: 0 },
  dimensionUnit: { type: String, enum: ["cm", "in"] },
  mediaId: { type: String },
});

const ProductSchema = new Schema<IProduct>(
  {
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    productSource: {
      type: String,
      enum: ["admin", "vendor"],
      required: true,
      default: "admin",
    },
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      maxlength: [200, "Product name cannot exceed 200 characters"],
    },
    title: {
      type: String,
      trim: true,
      maxlength: [200, "Product title cannot exceed 200 characters"],
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    handle: {
      type: String,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Product description is required"],
      maxlength: [10000, "Description cannot exceed 10000 characters"],
    },
    shortDescription: {
      type: String,
      maxlength: [500, "Short description cannot exceed 500 characters"],
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
    },
    comparePrice: {
      type: Number,
      min: [0, "Compare price cannot be negative"],
    },
    priceRange: {
      type: new Schema(
        {
          min: { type: Number, min: 0 },
          max: { type: Number, min: 0 },
        },
        { _id: false }
      ),
      default: undefined,
    },
    compareAtPriceRange: {
      type: new Schema(
        {
          min: { type: Number, min: 0 },
          max: { type: Number, min: 0 },
        },
        { _id: false }
      ),
      default: undefined,
    },
    cost: {
      type: Number,
      min: [0, "Cost cannot be negative"],
    },
    unitPrice: {
      totalAmount: { type: Number, min: 0 },
      totalUnit: {
        type: String,
        enum: ["item", "g", "kg", "lb", "oz", "ml", "l"],
      },
      baseAmount: { type: Number, min: 0 },
      baseUnit: {
        type: String,
        enum: ["item", "g", "kg", "lb", "oz", "ml", "l"],
      },
    },
    unitPriceUnit: {
      type: String,
      enum: ["item", "g", "kg", "lb", "oz", "ml", "l"],
    },
    chargeTax: {
      type: Boolean,
      default: true,
    },
    /**
     * "Price on request" — the product is sold by quote, not off the shelf.
     * `price` stays on the document (0 for a product that never had one) so
     * every aggregation, index and sort keeps working; what changes is that
     * the storefront prints no money and the cart refuses the line. The rule
     * itself lives in lib/products/quote-pricing.ts — read it there.
     */
    priceOnRequest: {
      type: Boolean,
      default: false,
    },
    quoteButtonLabel: {
      type: String,
      trim: true,
      maxlength: [60, "Quote button label cannot exceed 60 characters"],
    },
    sku: {
      type: String,
      trim: true,
      uppercase: true,
    },
    skuNormalized: {
      type: String,
      trim: true,
      uppercase: true,
    },
    barcode: {
      type: String,
      trim: true,
    },
    barcodeNormalized: {
      type: String,
      trim: true,
      uppercase: true,
    },
    barcodeFormat: {
      type: String,
      enum: ["ean13", "upca", "gtin14", "code128"],
    },
    barcodeSource: {
      type: String,
      enum: ["manufacturer", "gs1", "internal"],
    },
    stock: {
      type: Number,
      required: true,
      min: [0, "Stock cannot be negative"],
      default: 0,
    },
    inventory: { type: ProductStockPolicySchema, default: undefined },
    locationInventory: {
      type: [
        new Schema(
          {
            locationId: { type: String, required: true },
            // No min:0 — see the variant-level locationInventory note:
            // online-sale drift may legitimately leave a location slightly
            // negative, and a min would brick later product edits.
            quantity: { type: Number, required: true, default: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    images: {
      type: [String],
      default: [],
    },
    media: {
      type: [ProductMediaSchema],
      default: [],
    },
    // Digital deliverables (Shopify Digital Downloads equivalent). Files live
    // in PRIVATE storage — storageKey must never appear in storefront
    // payloads (stripped in lib/products/storefront-product-detail.ts);
    // customers reach them only through the order-gated download route.
    digitalAssets: {
      type: [ProductDigitalAssetSchema],
      default: undefined,
    },
    digitalDelivery: {
      // 0 = unlimited downloads per order.
      downloadLimit: { type: Number, min: 0, default: 0 },
    },
    // Public preview/sample of the digital product (e.g. a sample-chapter
    // PDF) shown on the product page — Amazon "Look Inside" equivalent.
    // Lives in PUBLIC storage, unlike digitalAssets.
    digitalPreview: {
      type: new Schema(
        {
          url: { type: String, required: true },
          filename: { type: String, trim: true },
          size: { type: Number },
          mimeType: { type: String },
        },
        { _id: false },
      ),
      default: undefined,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category is required"],
    },
    brand: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      default: null,
    },
    productType: {
      type: String,
      trim: true,
    },
    collectionIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "Collection",
      },
    ],
    tags: {
      type: [String],
      default: [],
    },
    attributes: {
      type: [ProductAttributeSchema],
      default: [],
    },
    variants: {
      type: [ProductVariantSchema],
      default: [],
    },
    preorder: { type: PreorderSettingsSchema, default: undefined },
    options: {
      type: [ProductOptionSchema],
      default: [],
    },
    seo: {
      pageTitle: { type: String, trim: true },
      metaDescription: { type: String, trim: true, maxlength: 1000 },
      handle: { type: String, lowercase: true, trim: true },
    },
    publishing: {
      onlineStore: { type: Boolean, default: true },
      pointOfSale: { type: Boolean, default: false },
    },
    shipping: {
      isPhysicalProduct: { type: Boolean, default: true },
      weight: { type: Number, min: 0 },
      weightUnit: {
        type: String,
        enum: ["g", "kg", "lb", "oz"],
        default: "kg",
      },
      // Optional parcel size. Carriers price by volume as well as weight, so
      // a product with dimensions gets a tighter (cheaper) box than the
      // store's default. Absent is fine — the packer falls back.
      length: { type: Number, min: 0 },
      width: { type: Number, min: 0 },
      height: { type: Number, min: 0 },
      dimensionUnit: { type: String, enum: ["cm", "in"], default: "cm" },
      countryOfOrigin: { type: String, trim: true },
      hsCode: { type: String, trim: true },
      customsDescription: { type: String, trim: true, maxlength: 500 },
    },
    status: {
      type: String,
      enum: Object.values(PRODUCT_STATUS),
      default: PRODUCT_STATUS.DRAFT,
    },
    featured: {
      type: Boolean,
      default: false,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
ProductSchema.index({ slug: 1, vendorId: 1 }, { unique: true });
// Vendor product list filters { vendorId } and sorts { createdAt: -1 }; the
// compound serves both so a large vendor's catalog isn't sorted in memory. It
// supersedes the old single-field { vendorId: 1 } (dropped from live DBs via
// the migration script).
ProductSchema.index({ vendorId: 1, createdAt: -1 });
ProductSchema.index({ productSource: 1 });
ProductSchema.index({ category: 1 });
ProductSchema.index({ brand: 1 });
// { createdAt: -1 } is kept intentionally: the admin product list sorts by
// createdAt WITHOUT a status filter (status is optional), so the status-led
// compounds below cannot serve it.
ProductSchema.index({ createdAt: -1 });
ProductSchema.index({ collectionIds: 1 });
// Compound indexes matching storefront query shapes: every storefront listing
// filters on status and then sorts (createdAt / price / rating) or filters by
// category. These let MongoDB satisfy the filter + sort from a single index
// instead of an in-memory sort over the status-matched set.
//
// These supersede the former single-field { status }, { featured } and
// { price } indexes (each was only ever queried alongside status), which were
// removed here. A database created before that change still carries them:
// Mongoose only ever creates indexes, it never drops one it no longer
// declares. They cost write throughput, not correctness, so drop them by hand
// if the collection is large enough to care.
ProductSchema.index({ status: 1, createdAt: -1 });
ProductSchema.index({ status: 1, featured: 1, createdAt: -1 });
// No sponsorship index. Which product holds a rung today is answered by
// BoostCampaign (status + window), and the ladder pool joins products by _id —
// a denormalized stamp here would be a second copy of that fact for every
// release path to keep in step.
ProductSchema.index({ status: 1, price: 1 });
ProductSchema.index({ status: 1, rating: -1, reviewCount: -1 });
ProductSchema.index({ status: 1, category: 1, createdAt: -1 });
// Storefront brand / collection landing pages filter status + brand|collectionIds
// then sort by createdAt. Mirrors the { status, category, createdAt } shape above
// so those facets seek instead of scanning the whole active set.
ProductSchema.index({ status: 1, brand: 1, createdAt: -1 });
ProductSchema.index({ status: 1, collectionIds: 1, createdAt: -1 });
// A vendor storefront filters { status, vendorId } and then sorts. Neither
// existing index covers that pair: { vendorId, createdAt } ignores status, and
// the { status, ... } compounds ignore vendorId — so a store with a large
// catalogue matched on one of them and sorted the remainder in memory, which is
// exactly the blocking SORT that falls over as a catalogue grows.
//
// One index per sort the storefront actually offers. The key order must match
// `buildSort()` in lib/products/storefront-products.ts exactly, including its
// trailing tiebreakers: an index of { …, reviewCount, rating } cannot serve a
// three-key { reviewCount, rating, createdAt } sort, and MongoDB silently falls
// back to a blocking SORT rather than erroring. Verify with .explain() after
// changing either side.
ProductSchema.index({
  status: 1,
  vendorId: 1,
  reviewCount: -1,
  rating: -1,
  createdAt: -1,
}); // "popular" — the storefront's default sort
ProductSchema.index({ status: 1, vendorId: 1, createdAt: -1 }); // newest
ProductSchema.index({ status: 1, vendorId: 1, price: 1 }); // price, both directions
ProductSchema.index({ status: 1, vendorId: 1, rating: -1, reviewCount: -1 }); // best rating
ProductSchema.index({ "preorder.enabled": 1, "preorder.releaseDate": 1 });
ProductSchema.index({ "variants.preorder.enabled": 1, "variants.preorder.releaseDate": 1 });
// "Which products can be collected from these branches" — the collection
// facet's `$elemMatch`. Both levels, because a variant product keeps its counts
// one level down and the facet has to reach either.
ProductSchema.index({ "locationInventory.locationId": 1 });
ProductSchema.index({ "variants.locationInventory.locationId": 1 });
ProductSchema.index({ barcodeNormalized: 1 });
ProductSchema.index({ skuNormalized: 1 });
ProductSchema.index({ "variants.barcodeNormalized": 1 });
ProductSchema.index({ "variants.skuNormalized": 1 });
ProductSchema.index({
  name: "text",
  title: "text",
  description: "text",
  tags: "text",
});

// Virtual for vendor
ProductSchema.virtual("vendor", {
  ref: "Vendor",
  localField: "vendorId",
  foreignField: "_id",
  justOne: true,
});

// Virtual for category details
ProductSchema.virtual("categoryDetails", {
  ref: "Category",
  localField: "category",
  foreignField: "_id",
  justOne: true,
});

// Virtual for brand details
ProductSchema.virtual("brandDetails", {
  ref: "Brand",
  localField: "brand",
  foreignField: "_id",
  justOne: true,
});

// Virtual for reviews
ProductSchema.virtual("reviews", {
  ref: "Review",
  localField: "_id",
  foreignField: "productId",
});

// Virtual for discount percentage.
// For multi-variant products, returns the highest discount % across variants
// (matches Shopify's "Save up to X%" display).
ProductSchema.virtual("discountPercentage").get(function () {
  if (Array.isArray(this.variants) && this.variants.length > 0) {
    let best = 0;
    for (const v of this.variants as ProductVariant[]) {
      if (v.comparePrice && v.comparePrice > v.price) {
        const pct = Math.round(((v.comparePrice - v.price) / v.comparePrice) * 100);
        if (pct > best) best = pct;
      }
    }
    return best;
  }
  if (this.comparePrice && this.comparePrice > this.price) {
    return Math.round(
      ((this.comparePrice - this.price) / this.comparePrice) * 100
    );
  }
  return 0;
});

// Virtual: true when at least one variant (or the default) has compareAt > price.
ProductSchema.virtual("onSale").get(function () {
  if (Array.isArray(this.variants) && this.variants.length > 0) {
    return (this.variants as ProductVariant[]).some(
      (v) => typeof v.comparePrice === "number" && v.comparePrice > v.price
    );
  }
  return typeof this.comparePrice === "number" && this.comparePrice > this.price;
});

// Virtual for in stock status
ProductSchema.virtual("inStock").get(function () {
  if (Array.isArray(this.variants) && this.variants.length > 0) {
    return this.variants.some((v: ProductVariant) => (v.stock || 0) > 0);
  }
  return (this.stock || 0) > 0;
});

/**
 * Strip HTML tags from a string for plain text SEO meta description
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Truncate text to a maximum length, adding ellipsis if needed
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3).trim() + "...";
}

/**
 * Make sure the stock policy exists and agrees with the product format.
 *
 * A digital product can never track stock: the form hides its Inventory card,
 * so `stock` would sit at 0 and the storefront would refuse to sell it. Readers
 * treat digital as untracked anyway (see lib/products/stock-policy.ts) — this
 * writes the same conclusion down so admin screens and exports show it too.
 */
function normalizeProductStockPolicy(doc: IProduct) {
  if (!doc.inventory) {
    doc.inventory = { tracked: true, continueSellingWhenOutOfStock: false };
  }
  if (doc.shipping?.isPhysicalProduct === false) {
    doc.inventory.tracked = false;
  }
}

ProductSchema.pre("validate", function () {
  const doc = this as unknown as IProduct;

  if (doc.shipping) {
    doc.shipping = normalizeProductShippingData(doc.shipping);
  }

  normalizeProductStockPolicy(doc);

  // Sync name and title - they should always be the same
  const title = (doc.title || doc.name || "").trim();
  if (!doc.title && title) doc.title = title;
  if (!doc.name && title) doc.name = title;

  // Auto-generate SKU from title if not provided
  if (!doc.sku && title) {
    doc.sku = generateSku(title);
  }

  const hasVariants = Array.isArray(doc.variants) && doc.variants.length > 0;
  const usedBarcodes = new Set<string>();
  rememberBarcode(usedBarcodes, doc.barcode);
  if (hasVariants) {
    for (const variant of doc.variants) {
      rememberBarcode(usedBarcodes, variant.barcode);
    }
  } else if (!hasBarcode(doc.barcode)) {
    const barcode = generateBarcode(usedBarcodes);
    doc.barcode = barcode;
    doc.barcodeFormat = "ean13";
    doc.barcodeSource = "internal";
    usedBarcodes.add(barcode);
  }

  // Ensure SEO object exists
  if (!doc.seo) doc.seo = {};

  // Auto-populate SEO pageTitle from title if empty
  if (!doc.seo.pageTitle && title) {
    doc.seo.pageTitle = truncateText(title, 70);
  }

  // Auto-populate SEO metaDescription from shortDescription or description if empty
  if (!doc.seo.metaDescription) {
    const descSource = doc.shortDescription || doc.description || "";
    if (descSource) {
      const plainText = stripHtml(descSource);
      doc.seo.metaDescription = truncateText(plainText, 160);
    }
  }

  // Sync handle/slug across all fields - handle is the canonical source
  const handle = (doc.seo.handle || doc.handle || doc.slug || "").trim();
  if (!doc.seo.handle && handle) doc.seo.handle = handle;
  if (!doc.handle && handle) doc.handle = handle;
  if (!doc.slug && handle) doc.slug = handle;

  if (Array.isArray(doc.media) && doc.media.length > 0) {
    const mediaSorted = [...doc.media].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0)
    );
    doc.images = mediaSorted
      .filter((m) => (m.type || "image") === "image")
      .map((m) => m.url);
  } else if (Array.isArray(doc.images) && doc.images.length > 0) {
    const existingIds = new Set<string>();
    const nextMedia: ProductMedia[] = [];
    for (let i = 0; i < doc.images.length; i++) {
      const url = doc.images[i];
      if (!url) continue;
      const id = crypto.randomUUID();
      if (existingIds.has(id)) continue;
      existingIds.add(id);
      nextMedia.push({ _id: id, type: "image", url, position: i });
    }
    doc.media = nextMedia;
  }

  if (hasVariants) {
    for (const v of doc.variants) {
      // Ensure inventory object exists
      if (!v.inventory) {
        v.inventory = {
          tracked: true,
          quantity: 0,
          continueSellingWhenOutOfStock: false,
        };
      }

      // INVENTORY SYNC LOGIC:
      // Priority: locationInventory (sum) > stock > inventory.quantity
      // This ensures all inventory fields are consistent

      if (Array.isArray(v.locationInventory) && v.locationInventory.length > 0) {
        // If locationInventory exists, it's the source of truth
        const locationTotal = v.locationInventory.reduce(
          (sum, loc) => sum + (loc.quantity || 0),
          0
        );
        v.stock = locationTotal;
        v.inventory.quantity = locationTotal;
      } else if (typeof v.stock === "number") {
        // For online inventory, variant.stock is canonical and mirrors to inventory.quantity.
        v.stock = Math.max(0, v.stock);
        v.inventory.quantity = v.stock;
      } else if (typeof v.inventory.quantity === "number") {
        // Backward compatibility for older data that may only have inventory.quantity.
        v.stock = Math.max(0, v.inventory.quantity);
        v.inventory.quantity = v.stock;
      } else {
        // Default to 0
        v.stock = 0;
        v.inventory.quantity = 0;
      }

      // Auto-generate variant name from option values
      if (
        !v.name &&
        Array.isArray(v.optionValues) &&
        v.optionValues.length > 0
      ) {
        v.name = v.optionValues.map((ov) =>
          typeof ov === "string" ? ov : ov.value
        ).join(" / ");
      }

      // Auto-generate variant SKU from product SKU + option values
      if (!v.sku && doc.sku) {
        const optionSuffix = Array.isArray(v.optionValues) && v.optionValues.length > 0
          ? v.optionValues
              .map((ov) => (typeof ov === "string" ? ov : ov.value))
              .join("-")
              .toUpperCase()
              .replace(/[^A-Z0-9]+/g, "-")
              .replace(/(^-|-$)/g, "")
          : "";
        v.sku = optionSuffix ? `${doc.sku}-${optionSuffix}` : doc.sku;
      }

      if (!hasBarcode(v.barcode)) {
        const barcode = generateBarcode(usedBarcodes);
        v.barcode = barcode;
        usedBarcodes.add(barcode);
      }

      // Link variant image from mediaId
      if (
        v.mediaId &&
        Array.isArray(doc.media) &&
        doc.media.length > 0 &&
        !v.image
      ) {
        const match = doc.media.find((m) => m._id === v.mediaId);
        if (match) v.image = match.url;
      }
    }

    // Aggregate parent product stock from all variants
    doc.stock = doc.variants.reduce((sum, v) => sum + (v.stock || 0), 0);

    // Same invariant buildProductAggregateUpdate() applies on the update path:
    // once a product has variants its own location rows are read by nothing,
    // and keeping them lets a later variant deletion resurrect them as stock.
    if (
      Array.isArray(doc.locationInventory) &&
      doc.locationInventory.length > 0
    ) {
      doc.locationInventory = [];
    }

    // Shopify-style price aggregation:
    // - `price` mirrors min variant price (legacy "From $X" field)
    // - `priceRange` exposes both min and max for "$X – $Y" display
    // - `comparePrice` mirrors max variant compareAt (so % off shown is the highest possible)
    // - `compareAtPriceRange` exposes both min and max
    const variantPrices = doc.variants
      .map((v) => v.price)
      .filter((p): p is number => typeof p === "number" && Number.isFinite(p));
    if (variantPrices.length > 0) {
      const min = Math.min(...variantPrices);
      const max = Math.max(...variantPrices);
      doc.price = min;
      doc.priceRange = { min, max };
    }

    const variantCompares = doc.variants
      .map((v) => v.comparePrice)
      .filter((p): p is number => typeof p === "number" && Number.isFinite(p) && p > 0);
    if (variantCompares.length > 0) {
      const min = Math.min(...variantCompares);
      const max = Math.max(...variantCompares);
      doc.compareAtPriceRange = { min, max };
      doc.comparePrice = max;
    } else {
      doc.compareAtPriceRange = undefined;
      doc.comparePrice = undefined;
    }
  } else {
    // Single (default) variant pattern: range collapses to the product's own values.
    if (typeof doc.price === "number") {
      doc.priceRange = { min: doc.price, max: doc.price };
    }
    if (typeof doc.comparePrice === "number" && doc.comparePrice > 0) {
      doc.compareAtPriceRange = { min: doc.comparePrice, max: doc.comparePrice };
    } else {
      doc.compareAtPriceRange = undefined;
    }

    if (
      Array.isArray(doc.locationInventory) &&
      doc.locationInventory.length > 0
    ) {
      // Single-variant product: locationInventory is the source of truth for stock
      doc.stock = doc.locationInventory.reduce(
        (sum, loc) => sum + (loc.quantity || 0),
        0,
      );
    }
  }

  assignProductLookupCodes(
    doc as unknown as Record<string, unknown> & {
      variants?: Record<string, unknown>[];
    },
  );

  const duplicateBarcodes = findDuplicateBarcodeCodes(
    doc as unknown as Record<string, unknown> & {
      variants?: Record<string, unknown>[];
    },
  );
  if (duplicateBarcodes.length > 0) {
    this.invalidate(
      "barcode",
      `Duplicate barcode value: ${duplicateBarcodes.join(", ")}`,
    );
  }
});

export const Product =
  models.Product || model<IProduct>("Product", ProductSchema);

/**
 * Shape `syncProductAggregates` reads. Loosely typed because it is fed by a
 * projected `.lean()` document.
 */
type ProductAggregateSource = {
  price?: number | null;
  comparePrice?: number | null;
  variants?: {
    price?: number | null;
    comparePrice?: number | null;
    stock?: number | null;
    locationInventory?: { quantity?: number | null }[] | null;
  }[];
  locationInventory?: { quantity?: number | null }[] | null;
  shipping?: { isPhysicalProduct?: boolean } | null;
  inventory?: { tracked?: boolean } | null;
};

/**
 * The stock a location-inventory array accounts for, or `null` when it does not
 * account for any.
 *
 * `null` covers two cases that look different but must be treated the same. No
 * rows at all is the obvious one. The subtle one is rows that are all zero
 * while the item still has stock: the product editor seeds an explicit zero row
 * for *every* known location the moment one exists, so an untouched product
 * ends up with rows it never asked for. Reading those as "zero everywhere"
 * would delete real sellable stock the merchant can still see on the shelf —
 * and a genuinely sold-out item reaches zero through `stock` too, so this
 * cannot mask one.
 */
function locationTotal(
  rows: { quantity?: number | null }[] | null | undefined,
  currentStock?: number | null,
): number | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const sum = rows.reduce((total, row) => total + (row.quantity || 0), 0);
  if (sum === 0 && (currentStock || 0) > 0) return null;

  return sum;
}

function isMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Derive the update that brings a product's computed fields back in line with
 * its own data. Pure, so it can be reasoned about (and tested) without a DB —
 * `syncProductAggregates` is the thin read/write wrapper around it.
 */
export function buildProductAggregateUpdate(doc: ProductAggregateSource): {
  set: Record<string, unknown>;
  unset: Record<string, "">;
} {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  const variants = Array.isArray(doc.variants) ? doc.variants : [];

  if (variants.length > 0) {
    // Per-location quantities outrank a variant's own `stock`, exactly as the
    // save hook decides it. Missing that rule here is what let the two drift:
    // the product PUT goes through `findOneAndUpdate`, so the hook never runs,
    // and a variant kept a stale `stock` while its locations said otherwise —
    // then this sum inherited the stale figure. Rewriting each variant's stock
    // first makes both paths agree on the same source of truth.
    const variantStock = variants.map(
      (v) => locationTotal(v.locationInventory, v.stock) ?? v.stock ?? 0,
    );
    variants.forEach((_, index) => {
      set[`variants.${index}.stock`] = variantStock[index];
      set[`variants.${index}.inventory.quantity`] = variantStock[index];
    });
    set.stock = variantStock.reduce((sum, quantity) => sum + quantity, 0);

    // Stock lives one level down now, so the PRODUCT-level rows are read by
    // nothing — not this sum, not the register, not the inventory list. They
    // are what the product recorded before it had variants, and leaving them
    // is a delayed fault: delete the variants one day and the `else` branch
    // below reads them as `stock`, handing back units nobody has counted since.
    // Cleared here rather than only in a migration, or the next product that
    // gains a variant strands its counts all over again.
    if (
      Array.isArray(doc.locationInventory) &&
      doc.locationInventory.length > 0
    ) {
      set.locationInventory = [];
    }

    const prices = variants.map((v) => v.price).filter(isMoney);
    const compares = variants
      .map((v) => v.comparePrice)
      .filter((p): p is number => isMoney(p) && p > 0);

    if (prices.length > 0) {
      set.price = Math.min(...prices);
      set.priceRange = { min: Math.min(...prices), max: Math.max(...prices) };
    }

    if (compares.length > 0) {
      set.compareAtPriceRange = {
        min: Math.min(...compares),
        max: Math.max(...compares),
      };
      set.comparePrice = Math.max(...compares);
    } else {
      unset.compareAtPriceRange = "";
      unset.comparePrice = "";
    }
  } else {
    // Single (default) variant: the ranges collapse onto the product's own
    // values, exactly as the pre-validate hook does on create. This is also
    // what clears a range left behind by variants the merchant just deleted —
    // otherwise their old compare-at range keeps a discount badge alive on a
    // product that no longer has one.
    //
    // Per-location quantities are the source of truth for `stock` when the
    // product has them — the same precedence the create hook applies, so a
    // product no longer ends up with stock 10 and its only location holding 0
    // depending on which path wrote it. (The form seeds a legacy product's
    // single location from its existing stock, so this cannot zero a count.)
    const locations = Array.isArray(doc.locationInventory)
      ? doc.locationInventory
      : [];
    if (locations.length > 0) {
      set.stock = locations.reduce((sum, loc) => sum + (loc.quantity || 0), 0);
    }

    if (isMoney(doc.price)) {
      set.priceRange = { min: doc.price, max: doc.price };
    } else {
      unset.priceRange = "";
    }

    if (isMoney(doc.comparePrice) && doc.comparePrice > 0) {
      set.compareAtPriceRange = { min: doc.comparePrice, max: doc.comparePrice };
    } else {
      unset.compareAtPriceRange = "";
    }
  }

  // Same invariant normalizeProductStockPolicy() applies on create.
  if (doc.shipping?.isPhysicalProduct === false) {
    if (doc.inventory?.tracked !== false) set["inventory.tracked"] = false;
  } else if (!doc.inventory) {
    set.inventory = { tracked: true, continueSellingWhenOutOfStock: false };
  }

  return { set, unset };
}

/**
 * Recompute the fields the pre-validate hook derives, for a product that was
 * just written with findOneAndUpdate/$set.
 *
 * Query middleware does not run `pre("validate")` (and `runValidators` only
 * runs field validators), so *every* derived field the hook maintains is left
 * untouched by an update. `priceRange` / `compareAtPriceRange` are the
 * dangerous ones: lib/products/price-display.ts prefers a stored range over
 * `price`, so a range written once at create time would keep overriding every
 * later price edit on cards, OG tags and JSON-LD.
 *
 * Call this after every product update, not only when `variants` changed — a
 * single-variant product has ranges too.
 */
export async function syncProductAggregates(productId: string): Promise<void> {
  const doc = await Product.findById(productId)
    .select(
      "variants price comparePrice locationInventory shipping.isPhysicalProduct inventory",
    )
    .lean();
  if (!doc) return;

  const { set, unset } = buildProductAggregateUpdate(
    doc as unknown as ProductAggregateSource,
  );

  const update: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  if (Object.keys(update).length === 0) return;

  await Product.updateOne({ _id: productId }, update);
}
