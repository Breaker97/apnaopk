import * as z from "zod";
import { Money } from "./common";
import { OperationStatus, OPERATION_REASONS } from "./operations";
import { ProductDetail, ProductStatus } from "./products";
import { UploadPolicy } from "./uploads";

const Id = z.string().min(1).max(64);
const Price = z.number().finite().min(0);
const Quantity = z.number().int().min(0).max(100_000_000);
const FileSize = z.number().int().nonnegative().max(5120 * 1024 * 1024);
/** A standing oversell policy can make the current baseline negative. Writes remain subject to domain validation. */
const StockQuantity = z.number().int().min(-100_000_000).max(100_000_000);
const BarcodeFormat = z.enum(["ean13", "upca", "gtin14", "code128"]);
const BarcodeSource = z.enum(["manufacturer", "gs1", "internal"]);
const Unit = z.enum(["item", "g", "kg", "lb", "oz", "ml", "l"]);
const Attribute = z.object({ name: z.string().min(1).max(200), value: z.string().min(1).max(1000) });
const LocationInventory = z.array(z.object({ locationId: Id, quantity: StockQuantity })).max(500);
export const ProductInventoryPolicy = z.object({ tracked: z.boolean(), continueSellingWhenOutOfStock: z.boolean() });
/** Reserved quantities are read-only and are never accepted from an editor. */
export const ProductPreorderRequest = z.object({
  enabled: z.boolean(), releaseDate: z.string().optional(), message: z.string().max(500).optional(),
  limit: Quantity.optional(), preorderOnly: z.boolean().optional(), autoConvert: z.boolean().optional(),
  paymentMode: z.enum(["full", "deposit", "pay_later"]).optional(),
  depositType: z.enum(["percentage", "fixed"]).optional(), depositValue: Price.optional(),
  supplierEta: z.string().optional(), batchName: z.string().max(120).optional(),
});
export const ProductOptionValue = z.object({
  id: Id.optional(), value: z.string().min(1).max(200),
  colorCode: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), position: z.number().int().nonnegative().optional(),
});
export const ProductOption = z.object({
  id: Id.optional(), name: z.string().min(1).max(200), position: z.number().int().nonnegative().optional(),
  visual: z.string().max(50).optional(), values: z.array(ProductOptionValue).max(250),
});
export const ProductVariantWriteRequest = z.object({
  id: Id.optional(), name: z.string().min(1).max(200), sku: z.string().max(100).optional(),
  barcode: z.string().max(64).optional(), barcodeFormat: BarcodeFormat.optional(), barcodeSource: BarcodeSource.optional(),
  price: Price, comparePrice: Price.nullable().optional(), cost: Price.nullable().optional(),
  stock: StockQuantity.optional(), locationInventory: LocationInventory.optional(), inventory: ProductInventoryPolicy.optional(),
  attributes: z.array(Attribute).max(100).optional(), image: z.string().max(2000).optional(), mediaId: Id.optional(),
  optionValues: z.array(z.object({ optionId: Id.optional(), optionName: z.string().optional(), valueId: Id.optional(), value: z.string(), colorCode: z.string().optional() })).max(50),
  requiresShipping: z.boolean().optional(), finalSale: z.boolean().optional(),
  weight: Price.optional(), weightUnit: z.enum(["g", "kg", "lb", "oz"]).optional(), preorder: ProductPreorderRequest.optional(),
});
export const ProductMediaWriteRequest = z.object({
  id: Id, type: z.enum(["image", "video", "model", "external_video"]),
  /** New stored media names an authorized upload; existing media keeps its URL. External URLs are server-parsed. */
  uploadId: Id.optional(), url: z.string().max(2000).optional(), filename: z.string().max(255).optional(),
  alt: z.string().max(1000).optional(), position: z.number().int().nonnegative().optional(),
  mimeType: z.string().max(100).optional(), size: FileSize.optional(), width: Quantity.optional(), height: Quantity.optional(),
  thumbnailUrl: z.string().max(2000).optional(), fit: z.enum(["auto", "contain", "cover"]).optional(),
});
export const PRODUCT_EDITOR_FIELDS = [
  "name", "title", "description", "shortDescription", "price", "comparePrice", "cost", "unitPrice", "unitPriceUnit", "chargeTax", "priceOnRequest", "quoteButtonLabel",
  "sku", "barcode", "barcodeFormat", "barcodeSource", "stock", "inventory", "locationInventory", "images", "media", "digitalAssets", "digitalDelivery", "digitalPreview",
  "category", "brand", "productType", "collectionIds", "tags", "attributes", "options", "variants", "preorder", "seo", "publishing", "returns", "shipping", "status", "featured",
] as const;
export const ProductEditorFields = z.object({
  name: z.string().min(3).max(200), title: z.string().min(3).max(200).optional(),
  description: z.string().min(10).max(10_000), shortDescription: z.string().max(500).optional(),
  price: Price, comparePrice: Price.nullable().optional(), cost: Price.nullable().optional(),
  unitPrice: z.object({ totalAmount: Price, totalUnit: Unit, baseAmount: Price, baseUnit: Unit }).nullable().optional(),
  unitPriceUnit: Unit.nullable().optional(), chargeTax: z.boolean().optional(), priceOnRequest: z.boolean().optional(), quoteButtonLabel: z.string().max(60).nullable().optional(),
  sku: z.string().max(100).optional(), barcode: z.string().max(64).optional(), barcodeFormat: BarcodeFormat.nullable().optional(), barcodeSource: BarcodeSource.nullable().optional(),
  stock: StockQuantity.optional(), inventory: ProductInventoryPolicy.optional(), locationInventory: LocationInventory.optional(),
  images: z.array(z.string().max(2000)).max(250).optional(), media: z.array(ProductMediaWriteRequest).max(250).optional(),
  digitalAssets: z.array(z.object({ id: Id, uploadId: Id.optional(), filename: z.string().min(1).max(255), size: FileSize.optional(), mimeType: z.string().max(100).optional(), position: z.number().int().nonnegative().optional() })).max(20).optional(),
  digitalDelivery: z.object({ downloadLimit: z.number().int().min(0).max(1000).optional() }).optional(),
  digitalPreview: z.object({ uploadId: Id.optional(), url: z.string().max(2000).optional(), filename: z.string().max(255).optional(), size: FileSize.optional(), mimeType: z.string().max(100).optional() }).nullable().optional(),
  category: Id, brand: Id.nullable().optional(), productType: z.string().max(200).optional(), collectionIds: z.array(Id).max(500).optional(),
  tags: z.array(z.string().max(200)).max(500).optional(), attributes: z.array(Attribute).max(100).optional(),
  options: z.array(ProductOption).max(50).optional(), variants: z.array(ProductVariantWriteRequest).max(250).optional(), preorder: ProductPreorderRequest.optional(),
  seo: z.object({ pageTitle: z.string().max(200).optional(), metaDescription: z.string().max(1000).optional(), handle: z.string().max(200).optional() }).optional(),
  publishing: z.object({ onlineStore: z.boolean(), pointOfSale: z.boolean() }).optional(),
  returns: z.object({ finalSale: z.boolean(), windowDays: z.number().int().min(1).max(365).nullable().optional() }).optional(),
  shipping: z.object({ isPhysicalProduct: z.boolean(), weight: Price.optional(), weightUnit: z.enum(["g", "kg", "lb", "oz"]).optional(), length: Price.optional(), width: Price.optional(), height: Price.optional(), dimensionUnit: z.enum(["cm", "in"]).optional(), countryOfOrigin: z.string().max(2).optional(), hsCode: z.string().max(100).optional(), customsDescription: z.string().max(500).optional() }).optional(),
  status: ProductStatus.optional(), featured: z.boolean().optional(),
});
export type ProductEditorFields = z.infer<typeof ProductEditorFields>;
/** Keyed create, atomic initial inventory; draftId also owns pre-create uploads. */
export const ProductCreateRequest = z.object({ draftId: z.string().uuid(), values: ProductEditorFields });
export type ProductCreateRequest = z.infer<typeof ProductCreateRequest>;
export const ProductStockBaseline = z.object({
  stock: StockQuantity.optional(), locationInventory: z.record(z.string(), StockQuantity).optional(),
  variants: z.record(z.string(), z.object({ stock: StockQuantity.optional(), locationInventory: z.record(z.string(), StockQuantity).optional() })).optional(),
});
/** If-Match plus keyed effects; omitted fields remain untouched. */
export const ProductSaveRequest = z.object({ changes: ProductEditorFields.partial(), stockBaseline: ProductStockBaseline.optional() });
export type ProductSaveRequest = z.infer<typeof ProductSaveRequest>;
export const PRODUCT_EDITOR_ACTIONS = ["set_active", "set_draft", "set_unlisted", "delete"] as const;
export const ProductEditorActionRequest = z.object({ action: z.enum(PRODUCT_EDITOR_ACTIONS) });
export type ProductEditorActionRequest = z.infer<typeof ProductEditorActionRequest>;
export const ProductFormOptionsQuery = z.object({ productId: Id.optional() });
export type ProductFormOptionsQuery = z.infer<typeof ProductFormOptionsQuery>;
export const ProductFormOptions = z.object({
  currency: z.string(), formats: z.array(z.enum(["physical", "digital"])), descriptionFormat: z.literal("html"),
  features: z.object({ physical: z.boolean(), digital: z.boolean(), preorders: z.boolean(), priceOnRequest: z.boolean() }),
  writableFields: z.array(z.enum(PRODUCT_EDITOR_FIELDS)), actions: z.array(z.enum(PRODUCT_EDITOR_ACTIONS)),
  categories: z.array(z.object({ id: Id, name: z.string(), path: z.array(z.string()), isLeaf: z.boolean(), options: z.array(ProductOption).optional() })),
  brands: z.array(z.object({ id: Id, name: z.string() })), collections: z.array(z.object({ id: Id, title: z.string() })),
  locations: z.array(z.object({ id: Id, name: z.string(), isDefault: z.boolean() })),
  shipping: z.object({ enabled: z.boolean(), weightUnit: z.enum(["kg", "lb"]), usesWeightRates: z.boolean(), customsEnabled: z.boolean() }),
  preorder: z.object({ allowed: z.boolean(), deferredBalanceSupported: z.boolean(), maxLeadDays: z.number(), maxDepositPercent: z.number(), blockedBy: z.string().optional() }),
  limits: z.object({ media: z.number().int(), variants: z.number().int(), digitalAssets: z.number().int(), productsRemaining: z.number().int().optional() }),
  uploads: z.array(UploadPolicy),
});
export type ProductFormOptions = z.infer<typeof ProductFormOptions>;
export const ProductEditorDetail = z.object({
  id: Id, version: z.string(), values: ProductEditorFields, product: ProductDetail,
  writableFields: z.array(z.enum(PRODUCT_EDITOR_FIELDS)), actions: z.array(z.enum(PRODUCT_EDITOR_ACTIONS)),
  /** Server-derived displays only; editable numbers above are unrounded form values. */
  pricing: z.object({ price: Money.optional(), maxPrice: Money.optional(), margin: z.string().optional(), unitPrice: Money.optional() }).optional(),
  dependencies: z.array(z.object({ kind: z.string(), count: z.number().int(), message: z.string() })),
});
export type ProductEditorDetail = z.infer<typeof ProductEditorDetail>;
export const ProductEditorResult = z.object({ operation: OperationStatus, product: ProductEditorDetail.optional(), deleted: z.boolean().optional() });
export type ProductEditorResult = z.infer<typeof ProductEditorResult>;
export const ProductVariantGenerateRequest = z.object({ options: z.array(ProductOption).max(50), existing: z.array(ProductVariantWriteRequest).max(250).optional() });
export const ProductVariantGeneration = z.object({ variants: z.array(ProductVariantWriteRequest), warnings: z.array(z.string()) });
export type ProductInventoryPolicy = z.infer<typeof ProductInventoryPolicy>;
export type ProductPreorderRequest = z.infer<typeof ProductPreorderRequest>;
export type ProductOptionValue = z.infer<typeof ProductOptionValue>;
export type ProductOption = z.infer<typeof ProductOption>;
export type ProductVariantWriteRequest = z.infer<typeof ProductVariantWriteRequest>;
export type ProductMediaWriteRequest = z.infer<typeof ProductMediaWriteRequest>;
export type ProductStockBaseline = z.infer<typeof ProductStockBaseline>;
export type ProductVariantGenerateRequest = z.infer<typeof ProductVariantGenerateRequest>;
export type ProductVariantGeneration = z.infer<typeof ProductVariantGeneration>;
export const PRODUCT_EDITOR_REASONS = ["PRODUCT_CHANGED", "PRODUCT_FEATURE_DISABLED", "PRODUCT_LIMIT_REACHED", "PRODUCT_FORMAT_IMMUTABLE", "PRODUCT_FIELD_NOT_ALLOWED", "PRODUCT_HAS_DEPENDENCIES", "BARCODE_ALREADY_USED", "STOCK_CHANGED", ...OPERATION_REASONS] as const;
