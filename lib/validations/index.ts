import { z } from "zod";
import {
  BOOST_MAX_POSITIONS,
  USER_ACCOUNT_STATUS,
  PRODUCT_STATUS,
  ORDER_STATUS,
  PAYMENT_STATUS,
} from "@/config/app.config";
import { RETURN_STATUS } from "@/lib/returns/returns";
import { REFUND_DESTINATION_METHODS } from "@/lib/returns/refund-settlement";
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "@/lib/finance/expense-categories";
import { LEDGER_ACCOUNTS, type LedgerAccount } from "@/lib/finance/accounts";
import { ALL_VENDOR_PACKS } from "@/config/permissions.config";
import { hasUnsafeAddressText } from "@/lib/customers/address-text";
import { parseExternalVideoUrl } from "@/lib/products/external-video";
import {
  DEFAULT_AUTOPLAY_SECONDS,
  MAX_AUTOPLAY_SECONDS,
  MIN_AUTOPLAY_SECONDS,
} from "@/lib/sliders/types";

import { AdminListQuerySchema } from "./list-query";

// Split out so browser code can import just what it needs (see the files).
export * from "./auth";
export * from "./list-query";

/**
 * Zod Validation Schemas
 * Central validation schemas for API requests
 */

// ============================================
// Common Schemas
// ============================================

/**
 * URL of an uploaded media file (product image, avatar, logo, …).
 *
 * Storage providers return two URL shapes: R2/S3 give absolute http(s) URLs,
 * while the local storage provider returns root-relative paths like
 * "/uploads/2026/07/x.jpg" so files are served same-site. A bare
 * z.string().url() rejects the relative form, which broke every media save on
 * local-storage installs — so accept both. "//host/path" (protocol-relative)
 * is still rejected.
 */
export const MediaUrlSchema = z.string().refine(
  (value) => {
    // Root-relative ("/uploads/…") but not protocol-relative ("//host/…").
    if (value.startsWith("/")) return !value.startsWith("//");
    // Absolute URLs must be http(s) — z.string().url() alone would also let
    // javascript:/data: schemes through.
    if (!/^https?:\/\//i.test(value)) return false;
    return z.string().url().safeParse(value).success;
  },
  { message: "Must be an http(s) URL or a root-relative path" },
);

const addressTextSchema = (
  maxLength: number,
  minimum?: { value: number; message: string },
) => {
  const schema = z.string().trim();
  const bounded = minimum
    ? schema.min(minimum.value, minimum.message)
    : schema;

  return bounded
    .max(maxLength)
    .refine((value) => !hasUnsafeAddressText(value), {
      message: "Address text cannot contain markup or control characters",
    });
};

export const AddressSchema = z.object({
  firstName: addressTextSchema(100).optional(),
  lastName: addressTextSchema(100).optional(),
  street: addressTextSchema(200, { value: 1, message: "Street is required" }),
  city: addressTextSchema(100, { value: 1, message: "City is required" }),
  state: addressTextSchema(100).optional(),
  apartment: addressTextSchema(100).optional(),
  postalCode: addressTextSchema(20, {
    value: 1,
    message: "Postal code is required",
  }),
  country: addressTextSchema(100, {
    value: 1,
    message: "Country is required",
  }),
  phone: addressTextSchema(50).optional(),
  isDefault: z.boolean().optional(),
  label: z.enum(["home", "work", "other"]).optional(),
});

// Auth schemas (RegisterSchema, LoginSchema) live in ./auth: the login and
// register forms import that file directly so the storefront bundle does not
// carry this whole module. Re-exported below for server-side callers.

// ============================================
// User Schemas
// ============================================

export const UpdateUserProfileSchema = z.object({
  name: z.string().min(2).optional(),
  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .transform((value) => value.toLowerCase())
    .optional(),
  image: MediaUrlSchema.optional(),
  phone: z.union([z.string(), z.null()]).optional(),
  birthday: z.union([z.string(), z.null()]).optional(),
  gender: z.union([z.enum(["male", "female", "other"]), z.null()]).optional(),
});

// ============================================
// Vendor Schemas
// ============================================

// ============================================
// Category Schemas
// ============================================

// ============================================
// Product Schemas
// ============================================

const ProductAttributeSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
});

const VariantOptionValueSchema = z.object({
  optionId: z.string().optional(),
  optionName: z.string().optional(),
  valueId: z.string().optional(),
  value: z.string(),
  colorCode: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
});

const ProductVariantSchema = z.object({
  _id: z.string().optional(),
  name: z.string().min(1),
  sku: z.string().optional().default(""),
  barcode: z.string().optional(),
  barcodeFormat: z.enum(["ean13", "upca", "gtin14", "code128"]).optional(),
  barcodeSource: z.enum(["manufacturer", "gs1", "internal"]).optional(),
  price: z.number().min(0),
  comparePrice: z.number().min(0).optional(),
  cost: z.number().min(0).optional(),
  taxable: z.boolean().optional(),
  stock: z.number().min(0),
  attributes: z.array(ProductAttributeSchema).default([]),
  image: MediaUrlSchema.optional(),
  optionValues: z
    .array(z.union([z.string(), VariantOptionValueSchema]))
    .default([]),
  inventory: z
    .object({
      tracked: z.boolean().default(true),
      quantity: z.number().min(0).default(0),
      continueSellingWhenOutOfStock: z.boolean().default(false),
    })
    .optional(),
  locationInventory: z
    .array(
      z.object({
        locationId: z.string(),
        quantity: z.number().min(0).default(0),
      }),
    )
    .optional(),
  requiresShipping: z.boolean().optional(),
  weight: z.number().min(0).optional(),
  weightUnit: z.enum(["g", "kg", "lb", "oz"]).optional(),
  mediaId: z.string().optional(),
  preorder: z
    .object({
      enabled: z.boolean().default(false),
      releaseDate: z.coerce.date().optional(),
      message: z.string().max(500).optional(),
      limit: z.number().min(0).default(0),
      reservedQuantity: z.number().min(0).default(0),
      preorderOnly: z.boolean().default(false),
      autoConvert: z.boolean().default(true),
      paymentMode: z.enum(["full", "deposit", "pay_later"]).default("full"),
      depositType: z.enum(["percentage", "fixed"]).default("percentage"),
      depositValue: z.number().min(0).default(0),
      supplierEta: z.coerce.date().optional(),
      batchName: z.string().max(120).optional(),
    })
    .optional(),
});

export const CreateProductSchema = z.object({
  vendorId: z.string().optional(),
  name: z.string().min(3, "Name must be at least 3 characters").max(200),
  title: z.string().min(3).max(200).optional(),
  description: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(10000),
  shortDescription: z.string().max(500).optional(),
  price: z.number().min(0, "Price must be positive"),
  // `null` means "clear this field". JSON.stringify drops `undefined`, so an
  // emptied input would otherwise never reach the update's $set and the old
  // value would survive — see CLEARABLE_PRODUCT_FIELDS in lib/products/sanitize.
  comparePrice: z.number().min(0).nullable().optional(),
  cost: z.number().min(0).nullable().optional(),
  unitPrice: z
    .object({
      totalAmount: z.number().min(0),
      totalUnit: z.enum(["item", "g", "kg", "lb", "oz", "ml", "l"]),
      baseAmount: z.number().min(0),
      baseUnit: z.enum(["item", "g", "kg", "lb", "oz", "ml", "l"]),
    })
    .nullable()
    .optional(),
  unitPriceUnit: z
    .enum(["item", "g", "kg", "lb", "oz", "ml", "l"])
    .nullable()
    .optional(),
  chargeTax: z.boolean().optional(),
  // "Price on request": the product is quoted, not priced. See
  // lib/products/quote-pricing.ts for what the flag actually switches off.
  priceOnRequest: z.boolean().optional(),
  quoteButtonLabel: z.string().trim().max(60).nullable().optional(),
  sku: z.string().optional().default(""),
  barcode: z.string().optional(),
  // Nullable for the same reason as the money fields above: "auto" /
  // "unspecified" in the form mean "no stored value", sent as an explicit null.
  barcodeFormat: z
    .enum(["ean13", "upca", "gtin14", "code128"])
    .nullable()
    .optional(),
  barcodeSource: z
    .enum(["manufacturer", "gs1", "internal"])
    .nullable()
    .optional(),
  stock: z.number().min(0).default(0),
  // Product-level stock policy. Note this is NOT the form's `inventory` group
  // (sku/barcode/quantity live at the top level); only the two switches are
  // persisted here, and lib/products/stock-policy.ts is what reads them.
  inventory: z
    .object({
      tracked: z.boolean().default(true),
      continueSellingWhenOutOfStock: z.boolean().default(false),
    })
    .optional(),
  locationInventory: z
    .array(
      z.object({
        locationId: z.string(),
        quantity: z.number().min(0).default(0),
      }),
    )
    .optional(),
  images: z.array(MediaUrlSchema).default([]),
  media: z
    .array(
      z
        .object({
          _id: z.string().min(1),
          type: z
            .enum(["image", "video", "model", "external_video"])
            .default("image"),
          url: MediaUrlSchema,
          filename: z.string().max(255).optional(),
          alt: z.string().optional(),
          position: z.number().optional(),
          mimeType: z.string().optional(),
          size: z.number().nonnegative().optional(),
          width: z.number().nonnegative().optional(),
          height: z.number().nonnegative().optional(),
          thumbnailUrl: MediaUrlSchema.optional(),
          provider: z.enum(["youtube", "vimeo"]).optional(),
          embedId: z.string().max(64).optional(),
        })
        // external_video items must carry exactly what re-parsing their URL
        // yields — the storefront builds iframe src from provider/embedId, so
        // a client can't smuggle in a foreign embed target.
        .transform((media) => {
          if (media.type !== "external_video") {
            // Embed fields only make sense on external videos.
            if (media.provider || media.embedId) {
              return { ...media, provider: undefined, embedId: undefined };
            }
            return media;
          }
          const parsed = parseExternalVideoUrl(media.url);
          if (!parsed) {
            // Unparseable URL: drop any client-supplied provider/embedId so
            // the refine below rejects the item instead of trusting them.
            return { ...media, provider: undefined, embedId: undefined };
          }
          return {
            ...media,
            url: parsed.url,
            provider: parsed.provider,
            embedId: parsed.embedId,
          };
        })
        .refine(
          (media) =>
            media.type !== "external_video" ||
            (media.provider && media.embedId),
          { message: "Not a valid YouTube or Vimeo URL" },
        ),
    )
    // Same cap the media uploader enforces client-side.
    .max(10, "A product can have at most 10 media files")
    .optional(),
  // Digital deliverables. storageKey comes from the digital-assets upload
  // endpoint; vendor routes additionally verify the key sits in the caller's
  // own scope (assertOwnDigitalAssetKeys) so one vendor can't attach another
  // vendor's file.
  digitalAssets: z
    .array(
      z.object({
        _id: z.string().min(1),
        filename: z.string().min(1).max(255),
        storageKey: z.string().min(1).max(600),
        size: z.number().min(0).optional(),
        mimeType: z.string().max(255).optional(),
        position: z.number().optional(),
      }),
    )
    .max(20)
    .optional(),
  digitalDelivery: z
    .object({
      downloadLimit: z.number().int().min(0).max(1000).optional(),
    })
    .optional(),
  // Public sample file for the product page; null clears it.
  digitalPreview: z
    .object({
      url: MediaUrlSchema,
      filename: z.string().max(255).optional(),
      size: z.number().min(0).optional(),
      mimeType: z.string().max(255).optional(),
    })
    .nullable()
    .optional(),
  category: z.string().min(1, "Category is required"),
  // Normalize empty string to null so an unset brand never triggers an
  // ObjectId CastError on create/update.
  brand: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().nullable().optional(),
  ),
  productType: z.string().optional(),
  collectionIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  attributes: z.array(ProductAttributeSchema).default([]),
  options: z
    .array(
      z.object({
        _id: z.string().optional(),
        name: z.string().min(1),
        position: z.number().optional(),
        // Presentation hint; validity is enforced downstream by
        // sanitizeOptionsForMongoose + the Mongoose enum, so keep this lenient
        // to avoid 400s on unexpected/legacy values.
        visual: z.string().optional(),
        values: z
          .array(
            z.union([
              z.string(),
              z.object({
                _id: z.string().optional(),
                value: z.string().min(1),
                colorCode: z
                  .string()
                  .regex(/^#[0-9a-f]{6}$/i)
                  .optional(),
                position: z.number().optional(),
              }),
            ]),
          )
          .default([]),
      }),
    )
    .default([]),
  variants: z.array(ProductVariantSchema).default([]),
  preorder: z
    .object({
      enabled: z.boolean().default(false),
      releaseDate: z.coerce.date().optional(),
      message: z.string().max(500).optional(),
      limit: z.number().min(0).default(0),
      reservedQuantity: z.number().min(0).default(0),
      preorderOnly: z.boolean().default(false),
      autoConvert: z.boolean().default(true),
      paymentMode: z.enum(["full", "deposit", "pay_later"]).default("full"),
      depositType: z.enum(["percentage", "fixed"]).default("percentage"),
      depositValue: z.number().min(0).default(0),
      supplierEta: z.coerce.date().optional(),
      batchName: z.string().max(120).optional(),
    })
    .optional(),
  seo: z
    .object({
      pageTitle: z.string().optional(),
      metaDescription: z.string().optional(),
      handle: z.string().optional(),
    })
    .optional(),
  publishing: z
    .object({
      onlineStore: z.boolean().default(true),
      pointOfSale: z.boolean().default(false),
    })
    .optional(),
  shipping: z
    .object({
      isPhysicalProduct: z.boolean().default(true),
      weight: z.number().min(0).optional(),
      weightUnit: z.enum(["g", "kg", "lb", "oz"]).default("kg"),
      // Parcel size for carrier rating. Normalized on save: a box missing an
      // axis is dropped rather than stored half-filled.
      length: z.number().min(0).optional(),
      width: z.number().min(0).optional(),
      height: z.number().min(0).optional(),
      dimensionUnit: z.enum(["cm", "in"]).optional(),
      countryOfOrigin: z.string().optional(),
      hsCode: z.string().optional(),
      customsDescription: z.string().max(500).optional(),
    })
    .optional(),
  status: z
    .enum([
      PRODUCT_STATUS.ACTIVE,
      PRODUCT_STATUS.DRAFT,
      PRODUCT_STATUS.UNLISTED,
    ])
    .default(PRODUCT_STATUS.DRAFT),
  featured: z.boolean().default(false),
});

export const UpdateProductSchema = CreateProductSchema.partial();

// ============================================
// Cart Schemas
// ============================================

// ============================================
// Order Schemas
// ============================================

/**
 * A Mongo ObjectId as it arrives over the wire. Hex-validated, not just
 * length-checked: a 24-character non-hex string passes `.length(24)` and then
 * throws inside Mongoose's cast, surfacing as a 500 that leaks the model name.
 *
 * Declared here rather than lower down because the schemas below evaluate at
 * module load and would otherwise hit it in the temporal dead zone.
 */
export const ObjectIdSchema = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid ID format");

export const AdminCreateOrderSchema = z.object({
  customerId: ObjectIdSchema,
  items: z
    .array(
      z.object({
        productId: ObjectIdSchema,
        variantId: ObjectIdSchema.optional(),
        quantity: z.coerce.number().int().min(1).max(999),
      }),
    )
    .min(1, "Add at least one product"),
  shippingAddress: AddressSchema,
  billingAddress: AddressSchema.optional(),
  paymentMethod: z.string().min(1).max(50).default("manual"),
  paymentStatus: z
    .enum([PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PAID])
    .default(PAYMENT_STATUS.PENDING),
  shippingCost: z.coerce.number().min(0).max(100000).default(0),
  discount: z.coerce.number().min(0).max(100000).default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export const UpdateOrderStatusSchema = z.object({
  status: z.enum([
    ORDER_STATUS.PREORDERED,
    ORDER_STATUS.PENDING,
    ORDER_STATUS.PROCESSING,
    ORDER_STATUS.SHIPPED,
    ORDER_STATUS.DELIVERED,
    ORDER_STATUS.CANCELLED,
  ]),
  trackingNumber: z.string().optional(),
});

export const AdminUpdateOrderSchema = z
  .object({
    status: z
      .enum([
        ORDER_STATUS.PREORDERED,
        ORDER_STATUS.PENDING,
        ORDER_STATUS.PROCESSING,
        ORDER_STATUS.SHIPPED,
        ORDER_STATUS.DELIVERED,
        ORDER_STATUS.CANCELLED,
      ])
      .optional(),
    paymentStatus: z
      .enum([
        PAYMENT_STATUS.PENDING,
        PAYMENT_STATUS.PAID,
        PAYMENT_STATUS.PARTIALLY_PAID,
        PAYMENT_STATUS.REFUNDED,
        PAYMENT_STATUS.PARTIALLY_REFUNDED,
      ])
      .optional(),
    notes: z.string().max(1000).optional(),
    trackingNumber: z.string().max(100).optional(),
    carrier: z.string().max(100).optional(),
    cancelReason: z.string().max(500).optional(),
    refundAmount: z.number().min(0).optional(),
    refundReason: z.string().max(500).optional(),
    manualRefund: z.boolean().optional(),
    /**
     * What the refund is FOR, when the admin says so.
     *
     * A refund raised here has no return behind it, so without this the split
     * can only be averaged across the whole sale — correct in total, but the
     * vendor statement then shows figures that tie back to nothing. Naming the
     * lines makes the split a fact. Omitted, it averages exactly as before.
     */
    refundItems: z
      .array(
        z.object({
          orderItemIndex: z.coerce.number().int().min(0),
          quantity: z.coerce.number().int().min(0).max(9999),
        }),
      )
      .optional(),
    /** Delivery this refund covers. Independent of the lines above. */
    refundShipping: z.coerce.number().min(0).optional(),
    /**
     * When set to true on a refund, restore the order's items to inventory
     * (typically used for full refunds where the customer is returning
     * physical goods). Per-sub-order claim makes this safe against
     * double-restore even if vendor partial-cancels happened earlier.
     */
    restoreInventoryOnRefund: z.boolean().optional(),
    /**
     * Move the status somewhere the workflow forbids — a rollback, or a jump.
     * Admin-only and reason-mandatory, both enforced in the route: the
     * workflow is what keeps automation honest, so the door out of it has to
     * be one a person opens deliberately and leaves a name on.
     */
    override: z.boolean().optional(),
    overrideReason: z.string().trim().min(3).max(500).optional(),
  })
  .refine(
    (val) =>
      val.status !== undefined ||
      val.paymentStatus !== undefined ||
      val.notes !== undefined ||
      val.trackingNumber !== undefined ||
      val.carrier !== undefined ||
      val.cancelReason !== undefined ||
      val.refundAmount !== undefined ||
      val.refundReason !== undefined,
    { message: "No updates provided" },
  );

// ============================================
// Return Request Schemas
// ============================================

export const CreateReturnRequestSchema = z.object({
  orderId: ObjectIdSchema,
  reason: z
    .string()
    .trim()
    .min(1, "Select a return reason")
    .max(100, "Return reason must be 100 characters or less")
    .refine((reason) => reason !== "other" && reason !== "changed_mind", {
      message: "Enter a valid return reason",
    }),
  customerNote: z.string().max(1000).optional(),
  items: z
    .array(
      z.object({
        orderItemIndex: z.coerce.number().int().min(0),
        quantity: z.coerce.number().int().min(1).max(999),
      }),
    )
    .min(1, "Select at least one item to return"),
  /**
   * Where to send a refund no gateway can carry — cash on delivery and the
   * other out-of-band methods. Optional here because whether it is REQUIRED
   * depends on the order, which this schema cannot see; the route decides,
   * using `validateRefundDestination` so one set of rules answers everywhere.
   */
  refundDestination: z
    .object({
      method: z.enum(
        REFUND_DESTINATION_METHODS as unknown as [string, ...string[]],
      ),
      accountName: z.string().trim().max(120).optional(),
      accountNumber: z.string().trim().max(64).optional(),
      provider: z.string().trim().max(120).optional(),
      note: z.string().trim().max(500).optional(),
    })
    .optional(),
});

// ============================================
// Review Schemas
// ============================================

// ============================================
// Query Parameter Schemas (for API security)
// ============================================

/**
 * Optional ObjectId schema
 */
const OptionalObjectIdSchema = ObjectIdSchema.optional();

export const AdminReturnListQuerySchema = AdminListQuerySchema.extend({
  status: z
    .enum(["all", ...Object.values(RETURN_STATUS)] as [string, ...string[]])
    .optional(),
  orderId: z.string().optional(),
});

export const AdminUpdateReturnRequestSchema = z
  .object({
    status: z.enum(Object.values(RETURN_STATUS) as [string, ...string[]]).optional(),
    adminNote: z.string().max(2000).optional(),
    rejectionReason: z.string().max(1000).optional(),
    carrier: z.string().max(100).optional(),
    trackingNumber: z.string().max(100).optional(),
    receivedItems: z
      .array(
        z.object({
          orderItemIndex: z.coerce.number().int().min(0),
          quantityReceived: z.coerce.number().int().min(0).max(999),
          condition: z
            .enum(["new", "opened", "damaged", "missing_parts", "unusable"])
            .optional(),
          restockable: z.boolean().optional(),
        }),
      )
      .optional(),
    refundAmount: z.coerce.number().min(0).optional(),
    refundReason: z.string().max(500).optional(),
    manualRefund: z.boolean().optional(),
    restoreInventoryOnRefund: z.boolean().optional(),
    /**
     * That a refund no gateway could carry has now actually been paid.
     *
     * Sent either alongside the refund itself, or on its own later — the
     * common case, where the money leaves the bank the day after the return
     * was approved. This is the only thing that moves a return off
     * `manual_required`.
     */
    settlement: z
      .object({
        method: z
          .string()
          .trim()
          .min(1, "Say how the refund was paid")
          .max(40),
        reference: z.string().trim().max(200).optional(),
      })
      .optional(),
    /**
     * What the merchant found when they opened the parcel, which is what
     * decides the delivery refund and the two fees — not the dropdown the
     * shopper picked from before anyone had seen the goods.
     */
    faultOverride: z
      .object({
        merchantAtFault: z.boolean(),
        note: z.string().trim().max(500).optional(),
      })
      .optional(),
  })
  .refine((val) => Object.values(val).some((v) => v !== undefined), {
    message: "No updates provided",
  });

/**
 * Staff comment on an order. `body` is trimmed before the min check so a
 * whitespace-only comment is rejected rather than stored blank.
 */
export const OrderCommentSchema = z.object({
  body: z.string().trim().min(1, "Comment cannot be empty").max(2000),
});

/**
 * Order list query params with filters
 */
export const OrderListQuerySchema = AdminListQuerySchema.extend({
  paymentStatus: z
    .enum([
      "all",
      PAYMENT_STATUS.PENDING,
      PAYMENT_STATUS.PAID,
      PAYMENT_STATUS.PARTIALLY_PAID,
      PAYMENT_STATUS.REFUNDED,
      PAYMENT_STATUS.PARTIALLY_REFUNDED,
    ])
    .optional(),
  channel: z.enum(["all", "online", "pos"]).optional(),
  view: z.enum(["all", "unfulfilled", "unpaid", "open", "archived"]).optional(),
});

/**
 * Admin review list query params
 */
export const AdminReviewListQuerySchema = AdminListQuerySchema.extend({
  status: z.enum(["all", "published", "on_hold"]).optional(),
  rating: z
    .union([z.literal("all"), z.coerce.number().int().min(1).max(5)])
    .optional(),
  productId: OptionalObjectIdSchema,
  hasReply: z.enum(["all", "yes", "no"]).optional(),
  view: z.enum(["all", "published", "on_hold", "with_reply", "no_reply"]).optional(),
});

/**
 * Admin review update body
 */
export const AdminUpdateReviewSchema = z
  .object({
    isApproved: z.boolean().optional(),
    rating: z.number().int().min(1).max(5).optional(),
    title: z.string().max(100).optional(),
    comment: z.string().min(1).max(1000).optional(),
    reply: z
      .union([
        z.string().min(1, "Reply cannot be empty").max(1000),
        z.null(),
      ])
      .optional(),
  })
  .refine(
    (val) => Object.values(val).some((v) => v !== undefined),
    { message: "No updates provided" }
  );

// ============================================
// Coupon Schemas
// ============================================

const CouponBaseSchema = z.object({
  code: z
    .string()
    .min(3, "Code must be at least 3 characters")
    .max(20, "Code must be at most 20 characters")
    .transform((val) => val.toUpperCase()),
  label: z.string().max(80).optional(),
  description: z.string().max(200).optional(),
  type: z.enum(["percentage", "fixed", "free_shipping"]),
  value: z.number().min(0, "Value must be positive").optional(),
  minOrderAmount: z.number().min(0).optional(),
  maxDiscount: z.number().min(0).optional(),
  usageLimit: z.number().min(1).optional(),
  perUserLimit: z.number().min(1).optional(),
  userLimit: z.number().min(1).optional(),
  applicableProducts: z.array(z.string()).optional(),
  applicableCategories: z.array(z.string()).optional(),
  excludedProducts: z.array(z.string()).optional(),
  excludedCategories: z.array(z.string()).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date(),
  status: z.enum(["active", "inactive", "expired"]).default("active"),
});

export const CreateCouponSchema = CouponBaseSchema.superRefine((data, ctx) => {
  if (data.type !== "free_shipping" && (!data.value || data.value <= 0)) {
    ctx.addIssue({
      code: "custom",
      path: ["value"],
      message: "Value must be greater than 0",
    });
  }
});

export const UpdateCouponSchema = CouponBaseSchema.partial().superRefine(
  (data, ctx) => {
    if (data.value !== undefined && data.type !== "free_shipping" && data.value <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Value must be greater than 0",
      });
    }
  },
);

// ============================================
// Vendor Plan Schemas
// ============================================

const VendorPlanBaseSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(80, "Name must be at most 80 characters"),
  description: z.string().max(500).optional().or(z.literal("")),
  price: z.number().min(0, "Price cannot be negative").optional(),
  billingInterval: z.enum(["monthly", "yearly", "none"]).optional(),
  commissionRate: z
    .number()
    .min(0, "Commission cannot be negative")
    .max(100, "Commission cannot exceed 100%"),
  trialDays: z.number().int().min(0).max(365).optional(),
  features: z.array(z.string().max(120)).max(20).optional(),
  limits: z
    .object({
      products: z.number().int().min(0).nullable().optional(),
      staff: z.number().int().min(0).nullable().optional(),
    })
    .optional(),
  capabilities: z
    .object({
      /** The packs the plan sells. An empty array is a plan that sells nothing. */
      packs: z.array(z.enum(ALL_VENDOR_PACKS)).max(64).optional(),
      /** @deprecated superseded by `packs`; still accepted for older clients. */
      aiAuthoring: z.boolean().optional(),
    })
    .optional(),
  isDefault: z.boolean().optional(),
  status: z.enum(["active", "archived"]).optional(),
  sortOrder: z.number().int().optional(),
  stripeProductId: z.string().max(120).optional().or(z.literal("")),
  stripePriceId: z.string().max(120).optional().or(z.literal("")),
});

export const CreateVendorPlanSchema = VendorPlanBaseSchema.superRefine(
  (data, ctx) => {
    const interval = data.billingInterval ?? "none";
    if (interval !== "none" && Number(data.price ?? 0) <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["price"],
        message: "Paid vendor plans require a price greater than 0",
      });
    }
    // A trial defers a charge, so it only exists on a plan that has one. The
    // 7-day setup window a paid plan already grants is NOT this: that is
    // restricted dashboard access before payment, while trial days are full
    // selling access with no payment method taken at all.
    if (interval === "none" && Number(data.trialDays ?? 0) > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["trialDays"],
        message: "A free plan has nothing to trial; set trial days to 0",
      });
    }
  },
);
export const UpdateVendorPlanSchema = VendorPlanBaseSchema.partial();

const BoostPositionBaseSchema = z.object({
  position: z
    .number()
    .int()
    .min(1, "Position must be at least 1")
    .max(BOOST_MAX_POSITIONS, `Position cannot exceed ${BOOST_MAX_POSITIONS}`),
  label: z
    .string()
    .min(2, "Label must be at least 2 characters")
    .max(80, "Label must be at most 80 characters"),
  description: z.string().max(500).optional().or(z.literal("")),
  // Currency-blind floor only. The route re-checks against
  // currencyMinimumPrice(currency) after quantizeToCurrency, because what
  // counts as a chargeable amount depends on the currency.
  pricePerDay: z.number().positive("Price per day must be greater than zero"),
  status: z.enum(["active", "archived"]).optional(),
});

const ExpenseBaseSchema = z.object({
  // Accepts a date-only string from the form as well as a full instant.
  date: z.coerce.date(),
  book: z.enum(["own", "marketplace"]).optional(),
  category: z.enum(
    EXPENSE_CATEGORIES as [ExpenseCategory, ...ExpenseCategory[]],
  ),
  // Currency-blind floor; the route quantizes and re-checks against the
  // currency's own minimum, exactly as the boost ladder does.
  amount: z.number().positive("Amount must be greater than zero"),
  description: z.string().min(2, "Describe what this was for").max(300),
  payee: z.string().max(200).optional().or(z.literal("")),
  paidFrom: z.enum(["bank", "cash", "gateway", "unpaid"]).optional(),
  receiptUrl: z.string().max(1000).optional().or(z.literal("")),
  vendorId: ObjectIdSchema.optional().or(z.literal("")),
  recurring: z
    .object({
      enabled: z.boolean(),
      interval: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
    })
    .optional(),
  note: z.string().max(1000).optional().or(z.literal("")),
});

/**
 * A hand-entered journal line: two accounts, one amount, and why.
 *
 * `reason` is required and has a floor, unlike an expense's optional note. An
 * adjustment is the one entry with no source document standing behind it, so
 * the sentence someone types here is the entire explanation anybody auditing it
 * will ever have.
 */
export const CreateAdjustmentSchema = z.object({
  date: z.coerce.date(),
  book: z.enum(["own", "marketplace"]).optional(),
  debit: z.enum(LEDGER_ACCOUNTS as [LedgerAccount, ...LedgerAccount[]]),
  credit: z.enum(LEDGER_ACCOUNTS as [LedgerAccount, ...LedgerAccount[]]),
  amount: z.number().positive("Amount must be greater than zero"),
  /**
   * The currency of the balance being corrected, not the store's current one.
   *
   * Optional so a single-currency store never has to think about it; the route
   * falls back to the store default. Where it matters is the store that has
   * traded in two: a UGX balance corrected in USD is not corrected at all.
   */
  currency: z.string().length(3).optional(),
  reason: z.string().min(4, "Say what this corrects").max(500),
  vendorId: ObjectIdSchema.optional().or(z.literal("")),
});

export const CreateExpenseSchema = ExpenseBaseSchema;
/** Everything is editable — an expense is typed by a human and humans mistype. */
export const UpdateExpenseSchema = ExpenseBaseSchema.partial();

export const CreateBoostPositionSchema = BoostPositionBaseSchema;
/** `position` is immutable after create — renumbering reprices a delivered good. */
export const UpdateBoostPositionSchema = BoostPositionBaseSchema.omit({
  position: true,
}).partial();

export const ValidateCouponSchema = z.object({
  code: z.string().min(3).max(20),
  subtotal: z.coerce.number().min(0),
  shippingCost: z.coerce.number().min(0).optional(),
  cartItems: z
    .array(
      z.object({
        productId: ObjectIdSchema,
        price: z.coerce.number().min(0),
        quantity: z.coerce.number().min(1).max(100),
        categoryId: OptionalObjectIdSchema,
      }),
    )
    .min(1),
});

// ============================================
// Settings Update Schema
// ============================================

// ============================================
// Enhanced Cart Schemas
// ============================================

export const CartAddItemSchema = z.object({
  productId: ObjectIdSchema,
  variantId: OptionalObjectIdSchema,
  quantity: z.coerce
    .number()
    .min(1, "Quantity must be at least 1")
    .max(100)
    .default(1),
  price: z.coerce.number().min(0),
  name: z.string().min(1).max(200),
  image: MediaUrlSchema.optional().or(z.literal("")),
});

export const CartUpdateItemSchema = z.object({
  productId: ObjectIdSchema,
  variantId: OptionalObjectIdSchema,
  quantity: z.coerce.number().min(0).max(100),
});

export const CartAddByIdSchema = z.object({
  productId: ObjectIdSchema,
  variantId: OptionalObjectIdSchema,
  quantity: z.coerce.number().min(1).max(100).default(1),
});

// ============================================
// Checkout Schema
// ============================================

export const CheckoutAddressSchema = z.object({
  fullName: addressTextSchema(100, { value: 2, message: "Name is required" }),
  firstName: addressTextSchema(100).optional(),
  lastName: addressTextSchema(100).optional(),
  street: addressTextSchema(200, {
    value: 5,
    message: "Street address is required",
  }),
  apartment: addressTextSchema(100).optional(),
  city: addressTextSchema(100, { value: 2, message: "City is required" }),
  state: addressTextSchema(100).optional().default(""),
  postalCode: addressTextSchema(20, {
    value: 3,
    message: "Postal code is required",
  }),
  country: addressTextSchema(100, {
    value: 2,
    message: "Country is required",
  }),
  phone: addressTextSchema(50).optional(),
});

export const CheckoutSchema = z.object({
  // Optional at the schema level: digital-only carts send billing only. The
  // checkout route enforces presence once item shippability is known.
  shippingAddress: CheckoutAddressSchema.optional(),
  billingAddress: CheckoutAddressSchema.optional(),
  paymentMethod: z.enum([
    "card",
    "cod",
    "paypal",
    "razorpay",
    "paystack",
    "pesapal",
    "iotec",
    "orange_money",
    "mtn_momo",
  ]),
  email: z.string().email().optional(),
  couponCode: z.string().min(3).max(20).optional(),
  locale: z.string().length(2).optional(),
  notes: z.string().max(500).optional(),
  preorderAcknowledged: z.boolean().optional(),
  // ioTec Pay: which collection channel to use (defaults to mobile money).
  iotecChannel: z.enum(["mobile_money", "card"]).optional(),
  // ioTec Pay: mobile-money number to charge (may differ from billing phone).
  iotecPhone: z.string().max(30).optional(),
  // MTN MoMo: mobile-money number to prompt (may differ from billing phone).
  mtnMomoPhone: z.string().max(30).optional(),
  // Customer-selected shipping rate option id (single-shipment carts).
  selectedShippingOptionId: z.string().max(100).optional(),
  // Per-vendor shipping rate selections, keyed by vendor id (multi-vendor).
  vendorShippingSelections: z.record(z.string(), z.string().max(100)).optional(),
  fulfillmentMethod: z.enum(["delivery", "pickup"]).default("delivery"),
  // The branch is the whole of what a client may choose. There is no hold to
  // quote back — slot booking is gone, a branch has opening hours and nothing
  // to reserve — and the server re-derives everything else (address, name)
  // from its own data.
  pickupLocationId: z.string().trim().max(100).optional(),
});

// ============================================
// Admin User Management Schemas
// ============================================

export const AdminUpdateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(["customer", "vendor", "admin", "staff", "seller"]).optional(),
  phone: z.string().optional(),
  emailVerified: z.boolean().optional(),
  status: z
    .enum([
      USER_ACCOUNT_STATUS.ACTIVE,
      USER_ACCOUNT_STATUS.INACTIVE,
      USER_ACCOUNT_STATUS.BANNED,
    ])
    .optional(),
  banned: z.boolean().optional(), // Backward compatibility
});

// ============================================
// Inventory Location Schema
// ============================================

/**
 * Body of the admin/staff/vendor location endpoints. Loose on purpose: the
 * pickup, dispatch, counter and geo fields are read by the typed normalizers
 * in `lib/locations/location-api.ts`, which already coerce and bound them.
 * This schema only pins the four fields the routes read directly, so a
 * non-string `address` or `name` is a 400 instead of a `.trim()` crash.
 * Presence rules ("name is required") stay in the route.
 */
export const InventoryLocationBodySchema = z.looseObject({
  name: z.string().max(200).optional(),
  address: z.string().max(500).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// ============================================
// Collection Schemas
// ============================================

const CollectionConditionSchema = z.object({
  field: z.enum([
    "title",
    "productType",
    "vendor",
    "tag",
    "price",
    "comparePrice",
    "weight",
    "stock",
    "createdAt",
    "category",
  ]),
  operator: z.enum([
    "equals",
    "not_equals",
    "greater_than",
    "less_than",
    "starts_with",
    "ends_with",
    "contains",
    "not_contains",
    "is_set",
    "is_not_set",
  ]),
  value: z.union([z.string(), z.number(), z.coerce.date()]),
});

const CollectionImageSchema = z.object({
  url: MediaUrlSchema,
  alt: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export const CreateCollectionSchema = z.object({
  title: z.string().min(1, "Title is required").max(255),
  description: z.string().max(5000).optional(),
  descriptionHtml: z.string().max(10000).optional(),
  image: CollectionImageSchema.optional(),
  collectionType: z.enum(["manual", "automated"]),
  products: z.array(ObjectIdSchema).default([]),
  conditions: z.array(CollectionConditionSchema).default([]),
  conditionMatch: z.enum(["all", "any"]).default("all"),
  sortOrder: z
    .enum([
      "manual",
      "best-selling",
      "title-asc",
      "title-desc",
      "price-asc",
      "price-desc",
      "created-asc",
      "created-desc",
    ])
    .default("manual"),
  position: z.number().min(0).default(0),
  status: z.enum(["active", "draft"]).default("draft"),
  publishing: z
    .object({
      onlineStore: z.boolean().default(true),
      pointOfSale: z.boolean().default(false),
    })
    .optional(),
  seo: z
    .object({
      pageTitle: z.string().max(70).optional(),
      metaDescription: z.string().max(320).optional(),
      handle: z.string().optional(),
    })
    .optional(),
});

export const UpdateCollectionSchema = CreateCollectionSchema.partial();

export const CollectionListQuerySchema = AdminListQuerySchema.extend({
  type: z.enum(["manual", "automated"]).optional(),
  channel: z.enum(["onlineStore", "pointOfSale"]).optional(),
});

// ============================================
// Customer Profile Schemas
// ============================================

const EmailNotificationsSchema = z.object({
  orderUpdates: z.boolean().optional(),
  promotions: z.boolean().optional(),
  newsletter: z.boolean().optional(),
  priceDrops: z.boolean().optional(),
  backInStock: z.boolean().optional(),
});

export const UpdateCustomerProfileSchema = z.object({
  preferredPaymentMethod: z.string().max(50).optional(),
  preferredCurrency: z.string().max(3).optional(),
  preferredLanguage: z.string().max(5).optional(),
  preferredCategories: z.array(ObjectIdSchema).max(20).optional(),
  sizePreferences: z.record(z.string(), z.string().max(20)).optional(),
  marketingOptIn: z.boolean().optional(),
  emailNotifications: EmailNotificationsSchema.optional(),
});

export const AdminUpdateCustomerProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().max(255).optional(),
  phone: z.string().max(30).optional(),
  image: z.string().max(2000).optional(),
  status: z
    .enum([
      USER_ACCOUNT_STATUS.ACTIVE,
      USER_ACCOUNT_STATUS.INACTIVE,
      USER_ACCOUNT_STATUS.BANNED,
    ])
    .optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  notes: z.string().max(2000).optional(),
  // No `loyaltyTier`: the tier is derived from the points, never submitted.
  loyaltyPoints: z.number().min(0).optional(),
  acquisitionSource: z.string().max(50).optional(),
  shippingAddress: AddressSchema.optional(),
  marketingOptIn: z.boolean().optional(),
  emailNotifications: EmailNotificationsSchema.optional(),
});

export const AdminCreateCustomerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(255),
  phone: z.string().max(30).optional(),
  status: z
    .enum([
      USER_ACCOUNT_STATUS.ACTIVE,
      USER_ACCOUNT_STATUS.INACTIVE,
      USER_ACCOUNT_STATUS.BANNED,
    ])
    .optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  notes: z.string().max(2000).optional(),
  // No `loyaltyTier`: the tier is derived from the points, never submitted.
  loyaltyPoints: z.number().min(0).optional(),
  acquisitionSource: z.string().max(50).optional(),
  shippingAddress: AddressSchema.optional(),
});

// ============================================
// Order Tracking (guest lookup by order number + email/phone)
// ============================================

/**
 * Body of the guest order-tracking endpoints. Every field is optional at the
 * schema level: the routes decide which combination is required and answer
 * with their own message, so the shape check here never changes that text.
 */
export const TrackOrderBodySchema = z.object({
  orderNumber: z.string().max(100).optional(),
  orderId: z.string().max(100).optional(),
  identifier: z.string().max(320).optional(),
});

// ============================================
// Blog Schemas
// ============================================

const BlogSeoSchema = z
  .object({
    pageTitle: z.string().max(70).optional(),
    metaDescription: z.string().max(320).optional(),
    ogImage: z.string().optional(),
    canonicalUrl: z.string().optional(),
    noIndex: z.boolean().optional(),
  })
  .optional();

export const CreateBlogCategorySchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().optional(),
  description: z.string().max(500).optional(),
  image: z.string().optional(),
  order: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});
export const UpdateBlogCategorySchema = CreateBlogCategorySchema.partial();

export const CreateBlogPostSchema = z.object({
  title: z.string().min(2).max(200),
  slug: z.string().optional(),
  excerpt: z.string().max(500).optional(),
  content: z.string().min(1, "Content is required"),
  featuredImage: z
    .object({
      url: z.string().optional(),
      alt: z.string().optional(),
    })
    .optional(),
  categoryIds: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  status: z
    .enum(["draft", "scheduled", "published", "archived"])
    .default("draft"),
  visibility: z.enum(["public", "private", "password"]).default("public"),
  password: z.string().optional(),
  publishedAt: z.string().optional(),
  scheduledFor: z.string().optional(),
  allowComments: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  seo: BlogSeoSchema,
});
export const UpdateBlogPostSchema = CreateBlogPostSchema.partial();

export const CreateBlogCommentSchema = z.object({
  postId: z.string().min(1),
  parentId: z.string().optional().nullable(),
  authorName: z.string().min(2).max(120),
  authorEmail: z.string().email(),
  authorWebsite: z.string().optional(),
  content: z.string().min(2).max(5000),
});
export const UpdateBlogCommentSchema = z.object({
  status: z.enum(["pending", "approved", "spam", "trash"]).optional(),
  content: z.string().min(2).max(5000).optional(),
});

// ============================================
// Menu Schemas
// ============================================

const MenuItemBaseSchema = z.object({
  label: z.string().min(1).max(120),
  url: z.string().default("#"),
  type: z
    .enum([
      "custom",
      "page",
      "product",
      "category",
      "collection",
      "brand",
      "blog",
      "blog-post",
      "external",
    ])
    .default("custom"),
  target: z.enum(["_self", "_blank"]).default("_self"),
  icon: z.string().optional(),
  image: z.string().optional(),
  description: z.string().max(280).optional(),
  badge: z.string().max(30).optional(),
  badgeColor: z.string().optional(),
  isFeatured: z.boolean().optional(),
  // Mega menu top level: where this category's promo renders. "side" is a tall
  // banner beside two link columns, "bottom" a card strip under four.
  promoMode: z.enum(["none", "side", "bottom"]).optional(),
  // "bottom" mode renders a fixed pair of cards, so the strip is two image
  // fields on the category rather than children flagged as promos.
  promoImages: z.array(z.string()).max(2).optional(),
  isMegaColumn: z.boolean().optional(),
  columnTitle: z.string().max(120).optional(),
});

type MenuItemInput = z.infer<typeof MenuItemBaseSchema> & {
  children?: MenuItemInput[];
};

const MenuItemSchema: z.ZodType<MenuItemInput> = MenuItemBaseSchema.extend({
  children: z.lazy(() => z.array(MenuItemSchema)).optional().default([]),
});

export const CreateMenuSchema = z.object({
  name: z.string().min(2).max(100),
  handle: z.string().optional(),
  location: z
    .enum(["header", "header-mega", "footer", "mobile", "sidebar", "custom"])
    .default("custom"),
  description: z.string().max(500).optional(),
  items: z.array(MenuItemSchema).default([]),
  isActive: z.boolean().default(true),
});
export const UpdateMenuSchema = CreateMenuSchema.partial();

// Reusable sliders. Slides are validated loosely here — the real contract is
// enforced by `normalizeSlides` (lib/sliders/types.ts), which every write
// passes through before persisting, the same read/write-normalize posture as
// store-page sections.
export const CreateSliderSchema = z.object({
  name: z.string().min(1).max(100),
  handle: z.string().optional(),
  isActive: z.boolean().default(true),
  transition: z.enum(["slide", "fade"]).default("slide"),
  autoplaySeconds: z
    .number()
    .min(MIN_AUTOPLAY_SECONDS)
    .max(MAX_AUTOPLAY_SECONDS)
    .default(DEFAULT_AUTOPLAY_SECONDS),
  slides: z.array(z.record(z.string(), z.unknown())).max(30).default([]),
});
export const UpdateSliderSchema = CreateSliderSchema.partial();

