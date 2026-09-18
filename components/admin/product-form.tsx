"use client";

import {
  Loader2,
  ArrowLeft,
  Eye,
  Trash2,
} from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildStockBaseline,
  type StockBaseline,
} from "@/lib/products/stock-baseline-client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  MediaUploader,
  type UploadedMedia,
} from "@/components/ui/media-uploader";
import { generateSku } from "@/lib/products/codes";
import {
  VariantsManager,
  type ProductOption as VariantOption,
  type ProductVariant as VariantData,
} from "@/components/admin/variants-manager";
import {
  generateAllCombinations,
  generateId,
  mergeVariants,
  withSyncedLocations,
} from "@/components/admin/variants-manager/helpers";
import { isOptionVisual } from "@/lib/products/option-visual";
import type { LocationInventory } from "@/types";
import { toast } from "@/components/ui/toast-notification";
import { useCurrency } from "@/providers/currency-provider";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { SearchEngineListingPreview } from "@/components/admin/search-engine-listing-preview";
import { AiGenerateMenu } from "@/components/ai-authoring/ai-generate-menu";
import { AiStudioMenu } from "@/components/ai-authoring/ai-studio-menu";
import { useAiStudio } from "@/components/ai-authoring/use-ai-studio";
import { findColorOption } from "@/lib/products/color-swatch";
import { useAiAuthoring } from "@/components/ai-authoring/use-ai-authoring";
import type {
  AIAuthoringMediaResponse,
  AIAuthoringRequest,
  AIAuthoringSeoDraft,
} from "@/lib/ai-authoring/types";
import { normalizeProductShippingData } from "@/lib/catalog/product-shipping";
import {
  formSchema,
  formatDateInputValue,
  type ProductFormData,
  type UnitPriceMeasureUnit,
  type Category,
  type Brand,
  type CollectionOption,
  type CollectionIdValue,
  type RawLocationInventory,
  type RawPreorderSettings,
  type ShippingFormContext,
} from "@/components/admin/product-form/schema";
import { PricingCard } from "@/components/admin/product-form/pricing-card";
import {
  PreorderCard,
  preorderLockMessage,
} from "@/components/admin/product-form/preorder-card";
import { ShippingCard } from "@/components/admin/product-form/shipping-card";
import { ProductFormatCard } from "@/components/admin/product-form/product-format-card";
import { InventoryCard } from "@/components/admin/product-form/inventory-card";
import { OrganizationCard } from "@/components/admin/product-form/organization-card";
import { DetailsCard } from "@/components/admin/product-form/details-card";
import {
  DigitalFilesCard,
  type DigitalAssetItem,
  type DigitalPreviewItem,
} from "@/components/admin/product-form/digital-files-card";
import { ProductFormSkeleton } from "@/components/admin/product-form/product-form-skeleton";
import { apiClient, describeApiError } from "@/lib/api/client";
import type {
  ProductFormOptions,
  VendorPreorderAccess,
} from "@/lib/products/form-options-types";

interface ProductFormProps {
  productId?: string;
  isVendor?: boolean;
  area?: "admin" | "staff";
}

type ProductFormMediaItem = {
  _id: string;
  url: string;
  filename?: string;
  type?: string;
  mimeType?: string;
  alt?: string;
  position: number;
  size?: number;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  provider?: "youtube" | "vimeo";
  embedId?: string;
  fit?: "auto" | "contain" | "cover";
};

// Character bounds for AI-generated copy. These mirror the server-side product
// schema (CreateProductSchema in lib/validations: shortDescription max 500,
// description min 10 / max 10000) so generated text never fails validation on
// save. The lower bounds are quality floors kept safely above the schema min.
const SUMMARY_MIN_CHARS = 50;
const SUMMARY_MAX_CHARS = 500;
const DESCRIPTION_MIN_CHARS = 50;
const DESCRIPTION_MAX_CHARS = 10000;
// Search-listing bounds. These mirror the server-side SEO clamp
// (SEO_TITLE_MAX / SEO_DESCRIPTION_MAX in lib/ai-authoring/content.ts) and the
// SearchEngineListingPreview editor defaults so a generated listing can never
// exceed what search engines display or what the form will accept.
const SEO_TITLE_MAX_CHARS = 70;
const SEO_DESCRIPTION_MAX_CHARS = 160;

export function ProductForm({
  productId,
  isVendor = false,
  area = "admin",
}: ProductFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams();
  const t = useTranslations();
  const locale = params.locale as string;
  const { currency } = useCurrency();
  const { confirm } = useConfirmation();
  /**
   * Was this product renderable in a sponsored slot when the form loaded?
   *
   * Compared against the submitted values so the booked-days warning fires only
   * on the edit that actually takes it dark — re-saving an already-unpublished
   * product has nothing left to release and must not warn again.
   */
  const wasBoostableRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isFetchingProduct, setIsFetchingProduct] = useState(!!productId);
  const [isFetchingOptions, setIsFetchingOptions] = useState(true);
  // Editing waits for the dropdown data too, so the category/brand/collection
  // controls are never briefly empty on a product that has them set. Creating a
  // product renders immediately — an empty picker there is the correct state.
  const isFetching = isFetchingProduct || (!!productId && isFetchingOptions);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [availableCollections, setAvailableCollections] = useState<
    CollectionOption[]
  >([]);
  const [mediaItems, setMediaItems] = useState<ProductFormMediaItem[]>([]);
  const mediaItemsRef = useRef<ProductFormMediaItem[]>([]);
  const [digitalAssets, setDigitalAssets] = useState<DigitalAssetItem[]>([]);
  const [digitalDownloadLimit, setDigitalDownloadLimit] = useState(0);
  const [digitalPreview, setDigitalPreview] =
    useState<DigitalPreviewItem | null>(null);
  const updateMediaItems = useCallback((
    next:
      | ProductFormMediaItem[]
      | ((current: ProductFormMediaItem[]) => ProductFormMediaItem[]),
  ) => {
    const resolved =
      typeof next === "function" ? next(mediaItemsRef.current) : next;
    mediaItemsRef.current = resolved;
    setMediaItems(resolved);
  }, []);
  const [productOptions, setProductOptions] = useState<VariantOption[]>([]);
  const [variants, setVariants] = useState<VariantData[]>([]);
  // Category variant auto-apply bookkeeping: the category we've already applied
  // options for, and the ids of the options we injected — so switching category
  // swaps its template out without disturbing the user's own options.
  const appliedCategoryRef = useRef<string | null>(null);
  // The stock numbers as loaded. Sent back on save so the server can tell what
  // this form changed from what sales and transfers moved while it was open.
  const stockBaselineRef = useRef<StockBaseline | null>(null);
  const injectedCategoryOptionIdsRef = useRef<Set<string>>(new Set());
  const [activeLocations, setActiveLocations] = useState<
    {
      _id: string;
      name: string;
      isDefault: boolean;
    }[]
  >([]);
  // Whether this account may create a location, not just stock existing ones.
  // Staff pinned to a fixed set cannot, and the API refuses their create.
  const [canManageLocations, setCanManageLocations] = useState(true);
  // Optimistic until the options land: a vendor who opens the editor before
  // the fetch resolves should see the modes they normally have, not a form
  // that briefly claims deposits are unavailable and then changes its mind.
  const [deferredBalanceSupported, setDeferredBalanceSupported] = useState(true);
  // Vendor editor only. Optimistic for the same reason as above; the server
  // still refuses a pre-order this vendor may not open.
  const [preorderAccess, setPreorderAccess] =
    useState<VendorPreorderAccess | null>(null);
  const [productLocationInventory, setProductLocationInventory] = useState<
    LocationInventory[]
  >([]);
  const [pricingAccordionValue, setPricingAccordionValue] = useState("");
  const [unitPricePopoverOpen, setUnitPricePopoverOpen] = useState(false);
  const [shippingContext, setShippingContext] = useState<ShippingFormContext>({
    enabled: false,
    weightUnit: "kg",
    usesWeightRates: false,
    customsEnabled: false,
  });

  const form = useForm<ProductFormData>({
    resolver: zodResolver(
      formSchema,
    ) as unknown as import("react-hook-form").Resolver<
      ProductFormData,
      unknown,
      ProductFormData
    >,
    defaultValues: {
      title: "",
      description: "",
      shortDescription: "",
      category: "",
      brand: "",
      status: isVendor ? "active" : "draft",
      featured: false,
      tags: [],
      attributes: [],
      productType: "",
      collectionIds: [],
      // POS availability is an explicit decision for everyone: a product only
      // reaches the register once someone confirms it is physically in the shop.
      publishing: { onlineStore: true, pointOfSale: false },
      pricing: {
        price: 0,
        comparePrice: undefined,
        unitPrice: undefined,
        unitPriceUnit: "none",
        cost: undefined,
        chargeTax: true,
        priceOnRequest: false,
        quoteButtonLabel: "",
      },
      inventory: {
        sku: "",
        barcode: "",
        barcodeFormat: "auto",
        barcodeSource: "unspecified",
        tracked: true,
        quantity: 0,
        continueSellingWhenOutOfStock: false,
      },
      preorder: {
        enabled: false,
        releaseDate: "",
        message: "",
        limit: 0,
        reservedQuantity: 0,
        preorderOnly: false,
        autoConvert: true,
        paymentMode: "full",
        depositType: "percentage",
        depositValue: 0,
        supplierEta: "",
        batchName: "",
      },
      shipping: {
        isPhysicalProduct: true,
        weight: undefined,
        weightUnit: "kg",
        countryOfOrigin: "",
        hsCode: "",
        customsDescription: "",
      },
      seo: { pageTitle: "", metaDescription: "", handle: "" },
    },
  });

  const basePath = isVendor
    ? `/${locale}/vendor/products`
    : `/${locale}/${area}/products`;
  const apiPath = isVendor ? "/api/vendor/products" : "/api/admin/products";
  const aiContentEndpoint = isVendor
    ? "/api/vendor/ai-authoring/content"
    : "/api/admin/ai-authoring/content";
  const aiMediaEndpoint = isVendor
    ? "/api/vendor/ai-authoring/media"
    : "/api/admin/ai-authoring/media";
  const aiAuthoring = useAiAuthoring({
    contentEndpoint: aiContentEndpoint,
    mediaEndpoint: aiMediaEndpoint,
  });


  // Every dropdown the editor needs — categories, brands, collections,
  // inventory locations and the shipping context — arrives in one projected
  // payload. These used to be five separate requests (plus a sixth for the
  // vendor shipping override), each re-authenticating and each returning whole
  // documents the form threw away.
  useEffect(() => {
    let active = true;
    const endpoint = isVendor
      ? "/api/vendor/products/form-options"
      : "/api/admin/products/form-options";

    async function fetchFormOptions() {
      try {
        const data = await apiClient.get<ProductFormOptions>(endpoint);
        if (!active || !data) return;

        setCategories(data.categories || []);
        setBrands(data.brands || []);
        setAvailableCollections(data.collections || []);
        setActiveLocations(data.locations || []);
        setCanManageLocations(data.canManageLocations !== false);
        setDeferredBalanceSupported(
          data.preorder?.deferredBalanceSupported !== false,
        );
        setPreorderAccess(data.preorder?.access ?? null);

        if (data.shipping) {
          setShippingContext(data.shipping);
          if (!productId && !form.formState.dirtyFields.shipping?.weightUnit) {
            form.setValue("shipping.weightUnit", data.shipping.weightUnit);
          }
        }
      } catch (error) {
        console.error("Failed to load product form options:", error);
      } finally {
        if (active) setIsFetchingOptions(false);
      }
    }

    fetchFormOptions();
    return () => {
      active = false;
    };
  }, [form, isVendor, productId]);

  // Keep productLocationInventory in sync with activeLocations.
  // When locations are added, missing entries are appended.
  // When locations become inactive, their entries stay (so the data isn't lost)
  // but they're filtered from display by the UI.
  //
  // Waits for the product's own entries to land first (`isFetchingProduct`),
  // otherwise it would append a zero for a location the product already stocks
  // and then be overwritten — or worse, survive and zero the real count.
  useEffect(() => {
    if (activeLocations.length === 0 || isFetchingProduct) return;
    const timer = window.setTimeout(() => {
      setProductLocationInventory((prev) => {
        const existing = new Set(prev.map((p) => String(p.locationId)));
        const missing = activeLocations.filter((l) => !existing.has(l._id));
        if (missing.length === 0) return prev;

        // A product created before these locations existed (or before locations
        // were used at all) holds its units in `stock` alone. The moment
        // `locationInventory` has a single row, Σ(rows) BECOMES `stock` — the
        // Product pre-validate hook recomputes it — so seeding a grid of zeros
        // does not leave the count untracked, it silently destroys every unit
        // the product had. That was reachable with two or more locations, which
        // is exactly what a merchant ends up with the day they add a collection
        // counter beside their warehouse.
        //
        // The whole balance lands on the default location: that is where the
        // goods are until the merchant moves them, and splitting it across
        // branches would invent a distribution nobody stated. Mirrors
        // withSyncedLocations() for variants.
        const untracked =
          prev.length === 0
            ? Math.max(0, Number(form.getValues("inventory.quantity")) || 0)
            : 0;
        const inheritingId = untracked
          ? (activeLocations.find((l) => l.isDefault) ?? activeLocations[0])._id
          : undefined;

        return [
          ...prev,
          ...missing.map((l) => ({
            locationId: l._id,
            locationName: l.name,
            quantity: l._id === inheritingId ? untracked : 0,
          })),
        ];
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeLocations, isFetchingProduct, form]);

  // A location created from inside the inventory card has to reach this list
  // too: `onSubmit` filters the per-location quantities down to `activeLocations`,
  // so a quantity entered against an unknown location would be dropped on save.
  const handleLocationCreated = useCallback(
    (location: { _id: string; name: string }) => {
      setActiveLocations((prev) =>
        prev.some((l) => l._id === location._id)
          ? prev
          : [...prev, { _id: location._id, name: location.name, isDefault: false }],
      );
    },
    [],
  );

  useEffect(() => {
    if (!productId) return;

    async function fetchProduct() {
      setIsFetchingProduct(true);
      try {
        // Same untyped contract the raw res.json() call had before.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await apiClient.get<any>(`${apiPath}/${productId}`);
        if (data) {
          const product = data;
          stockBaselineRef.current = buildStockBaseline(product);

          const loadedMedia = Array.isArray(product.media)
            ? product.media
                .map((m: unknown, idx: number) => {
                  const media = m as Record<string, unknown>;
                  return {
                    _id: String(media._id || crypto.randomUUID()),
                    url: String(media.url || ""),
                    filename: media.filename
                      ? String(media.filename)
                      : undefined,
                    type: media.type ? String(media.type) : "image",
                    mimeType: media.mimeType
                      ? String(media.mimeType)
                      : undefined,
                    alt: media.alt ? String(media.alt) : "",
                    position:
                      typeof media.position === "number" ? media.position : idx,
                    size:
                      typeof media.size === "number" ? media.size : undefined,
                    width:
                      typeof media.width === "number" ? media.width : undefined,
                    height:
                      typeof media.height === "number" ? media.height : undefined,
                    thumbnailUrl: media.thumbnailUrl
                      ? String(media.thumbnailUrl)
                      : undefined,
                    provider:
                      media.provider === "youtube" || media.provider === "vimeo"
                        ? media.provider
                        : undefined,
                    embedId: media.embedId ? String(media.embedId) : undefined,
                    fit:
                      media.fit === "contain" || media.fit === "cover"
                        ? media.fit
                        : undefined,
                  };
                })
                .filter((m: { url: string }) => m.url)
            : Array.isArray(product.images)
              ? product.images.map((url: string, idx: number) => ({
                  _id: crypto.randomUUID(),
                  url,
                  type: "image",
                  alt: "",
                  position: idx,
                }))
              : [];

          // Preserve original IDs from DB instead of regenerating UUIDs
          const loadedOptions: VariantOption[] = Array.isArray(product.options)
            ? product.options.map((o: unknown, optionIdx: number) => {
                const option = o as Record<string, unknown>;
                return {
                  id: String(option._id || crypto.randomUUID()),
                  name: String(option.name || ""),
                  visual: isOptionVisual(option.visual)
                    ? option.visual
                    : undefined,
                  position:
                    typeof option.position === "number"
                      ? option.position
                      : optionIdx,
                  values: Array.isArray(option.values)
                    ? option.values.map((val: unknown, valueIdx: number) => {
                        const v = val as Record<string, unknown>;
                        return {
                          id: String(v._id || crypto.randomUUID()),
                          value:
                            typeof v === "string" ? v : String(v.value || ""),
                          colorCode:
                            typeof v.colorCode === "string"
                              ? v.colorCode
                              : undefined,
                          position:
                            typeof v.position === "number"
                              ? v.position
                              : valueIdx,
                        };
                      })
                    : [],
                };
              })
            : [];

          // Build a lookup map for options by ID and name for flexible matching
          const optionByIdMap = new Map(loadedOptions.map((o) => [o.id, o]));
          const optionByNameMap = new Map(
            loadedOptions.map((o) => [o.name.toLowerCase(), o]),
          );

          const loadedVariants: VariantData[] = Array.isArray(product.variants)
            ? product.variants.map((v: unknown) => {
                const variant = v as Record<string, unknown>;

                // Properly deserialize structured optionValues (not string cast)
                const rawOptionValues = Array.isArray(variant.optionValues)
                  ? variant.optionValues
                  : [];

                const optionValues = rawOptionValues
                  .map((ov: unknown, idx: number) => {
                    const ovObj = ov as Record<string, unknown>;

                    // If it's a structured object with optionId/value
                    if (
                      ovObj &&
                      typeof ovObj === "object" &&
                      "value" in ovObj
                    ) {
                      // Try to find matching option by ID first, then by name, then by position
                      const matchedOption =
                        (ovObj.optionId
                          ? optionByIdMap.get(String(ovObj.optionId))
                          : undefined) ||
                        (ovObj.optionName
                          ? optionByNameMap.get(
                              String(ovObj.optionName).toLowerCase(),
                            )
                          : undefined) ||
                        loadedOptions[idx];

                      if (!matchedOption) return null;

                      // Find matching value in the option
                      const valueStr = String(ovObj.value || "");
                      const matchedValue = matchedOption.values.find(
                        (mv) => mv.value === valueStr,
                      );

                      return {
                        optionId: matchedOption.id,
                        optionName: matchedOption.name,
                        valueId:
                          matchedValue?.id ||
                          String(ovObj.valueId || crypto.randomUUID()),
                        value: valueStr,
                        colorCode:
                          matchedValue?.colorCode ||
                          (typeof ovObj.colorCode === "string"
                            ? ovObj.colorCode
                            : undefined),
                      };
                    }

                    // Legacy: plain string value — match by position
                    const valueStr = String(ov);
                    const option = loadedOptions[idx];
                    if (!option) return null;
                    const matchedValue = option.values.find(
                      (mv) => mv.value === valueStr,
                    );
                    return {
                      optionId: option.id,
                      optionName: option.name,
                      valueId: matchedValue?.id || crypto.randomUUID(),
                      value: valueStr,
                      colorCode: matchedValue?.colorCode,
                    };
                  })
                  .filter(Boolean) as VariantData["optionValues"];

                return {
                  id: String(variant._id || crypto.randomUUID()),
                  optionValues,
                  name: String(variant.name || variant.title || ""),
                  sku: String(variant.sku || ""),
                  barcode: String(variant.barcode || ""),
                  barcodeFormat: variant.barcodeFormat,
                  barcodeSource: variant.barcodeSource,
                  price: typeof variant.price === "number" ? variant.price : 0,
                  comparePrice:
                    typeof variant.comparePrice === "number"
                      ? variant.comparePrice
                      : undefined,
                  cost:
                    typeof variant.cost === "number"
                      ? variant.cost
                      : undefined,
                  stock: typeof variant.stock === "number" ? variant.stock : 0,
                  requiresShipping:
                    typeof variant.requiresShipping === "boolean"
                      ? variant.requiresShipping
                      : undefined,
                  weight:
                    typeof variant.weight === "number"
                      ? variant.weight
                      : undefined,
                  weightUnit:
                    variant.weightUnit === "g" ||
                    variant.weightUnit === "kg" ||
                    variant.weightUnit === "lb" ||
                    variant.weightUnit === "oz"
                      ? variant.weightUnit
                      : undefined,
                  mediaId: variant.mediaId
                    ? String(variant.mediaId)
                    : undefined,
                  locationInventory: Array.isArray(variant.locationInventory)
                    ? variant.locationInventory.map(
                        (li: RawLocationInventory) => ({
                          locationId: String(li.locationId),
                          quantity:
                            typeof li.quantity === "number" ? li.quantity : 0,
                        }),
                      )
                    : [],
                  preorder: (() => {
                    const preorder = variant.preorder as
                      | RawPreorderSettings
                      | undefined;
                    return {
                      enabled: Boolean(preorder?.enabled),
                      releaseDate: formatDateInputValue(preorder?.releaseDate),
                      message:
                        typeof preorder?.message === "string"
                          ? preorder.message
                          : "",
                      limit:
                        typeof preorder?.limit === "number"
                          ? preorder.limit
                          : 0,
                      reservedQuantity:
                        typeof preorder?.reservedQuantity === "number"
                          ? preorder.reservedQuantity
                          : 0,
                      preorderOnly: Boolean(preorder?.preorderOnly),
                      autoConvert:
                        typeof preorder?.autoConvert === "boolean"
                          ? preorder.autoConvert
                          : true,
                      paymentMode:
                        preorder?.paymentMode === "deposit" ||
                        preorder?.paymentMode === "pay_later"
                          ? preorder.paymentMode
                          : "full",
                      depositType:
                        preorder?.depositType === "fixed"
                          ? "fixed"
                          : "percentage",
                      depositValue:
                        typeof preorder?.depositValue === "number"
                          ? preorder.depositValue
                          : 0,
                      supplierEta: formatDateInputValue(preorder?.supplierEta),
                      batchName:
                        typeof preorder?.batchName === "string"
                          ? preorder.batchName
                          : "",
                    };
                  })(),
                };
              })
            : [];

          wasBoostableRef.current =
            product.status === "active" &&
            product.publishing?.onlineStore !== false;

          form.reset({
            title: product.title || product.name,
            description: product.description,
            shortDescription: product.shortDescription || "",
            category: product.category?._id || product.category,
            brand:
              (product.brand &&
                (typeof product.brand === "object"
                  ? product.brand._id
                  : product.brand)) ||
              "",
            status: product.status,
            featured: product.featured,
            tags: product.tags || [],
            attributes: Array.isArray(product.attributes)
              ? (product.attributes as Array<{ name?: unknown; value?: unknown }>)
                  .filter(
                    (a): a is { name: string; value: string } =>
                      !!a &&
                      typeof a.name === "string" &&
                      typeof a.value === "string",
                  )
                  .map((a) => ({ name: a.name, value: a.value }))
              : [],
            productType: product.productType || "",
            collectionIds: (Array.isArray(product.collectionIds)
              ? (product.collectionIds as CollectionIdValue[])
              : []
            )
              .map((id: CollectionIdValue) => {
                if (typeof id === "string") return id;
                return typeof id?._id === "string" ? id._id : "";
              })
              .filter((id: string) => id.length > 0),
            publishing: {
              onlineStore:
                typeof product.publishing?.onlineStore === "boolean"
                  ? product.publishing.onlineStore
                  : true,
              pointOfSale:
                typeof product.publishing?.pointOfSale === "boolean"
                  ? product.publishing.pointOfSale
                  : false,
            },
            pricing: {
              price: product.price,
              comparePrice: product.comparePrice,
              unitPrice:
                product.unitPrice &&
                typeof product.unitPrice === "object" &&
                typeof (product.unitPrice as Record<string, unknown>)
                  .totalAmount === "number" &&
                typeof (product.unitPrice as Record<string, unknown>)
                  .baseAmount === "number" &&
                ((product.unitPrice as Record<string, unknown>).totalUnit ===
                  "item" ||
                  (product.unitPrice as Record<string, unknown>).totalUnit ===
                    "g" ||
                  (product.unitPrice as Record<string, unknown>).totalUnit ===
                    "kg" ||
                  (product.unitPrice as Record<string, unknown>).totalUnit ===
                    "lb" ||
                  (product.unitPrice as Record<string, unknown>).totalUnit ===
                    "oz" ||
                  (product.unitPrice as Record<string, unknown>).totalUnit ===
                    "ml" ||
                  (product.unitPrice as Record<string, unknown>).totalUnit ===
                    "l") &&
                ((product.unitPrice as Record<string, unknown>).baseUnit ===
                  "item" ||
                  (product.unitPrice as Record<string, unknown>).baseUnit ===
                    "g" ||
                  (product.unitPrice as Record<string, unknown>).baseUnit ===
                    "kg" ||
                  (product.unitPrice as Record<string, unknown>).baseUnit ===
                    "lb" ||
                  (product.unitPrice as Record<string, unknown>).baseUnit ===
                    "oz" ||
                  (product.unitPrice as Record<string, unknown>).baseUnit ===
                    "ml" ||
                  (product.unitPrice as Record<string, unknown>).baseUnit ===
                    "l")
                  ? {
                      totalAmount: Number(
                        (product.unitPrice as Record<string, unknown>)
                          .totalAmount,
                      ),
                      totalUnit: (product.unitPrice as Record<string, unknown>)
                        .totalUnit as UnitPriceMeasureUnit,
                      baseAmount: Number(
                        (product.unitPrice as Record<string, unknown>)
                          .baseAmount,
                      ),
                      baseUnit: (product.unitPrice as Record<string, unknown>)
                        .baseUnit as UnitPriceMeasureUnit,
                    }
                  : undefined,
              unitPriceUnit:
                product.unitPriceUnit === "item" ||
                product.unitPriceUnit === "g" ||
                product.unitPriceUnit === "kg" ||
                product.unitPriceUnit === "lb" ||
                product.unitPriceUnit === "oz" ||
                product.unitPriceUnit === "ml" ||
                product.unitPriceUnit === "l"
                  ? product.unitPriceUnit
                  : "none",
              cost: product.cost,
              chargeTax:
                typeof product.chargeTax === "boolean"
                  ? product.chargeTax
                  : true,
              priceOnRequest: product.priceOnRequest === true,
              quoteButtonLabel: product.quoteButtonLabel || "",
            },
            inventory: {
              sku: product.sku,
              barcode: product.barcode || "",
              barcodeFormat: product.barcodeFormat || "auto",
              barcodeSource: product.barcodeSource || "unspecified",
              // Absent policy (product saved before it existed) means tracked.
              tracked: product.inventory?.tracked !== false,
              quantity: product.stock ?? 0,
              continueSellingWhenOutOfStock:
                product.inventory?.continueSellingWhenOutOfStock === true,
            },
            preorder: {
              enabled: Boolean(
                (product.preorder as RawPreorderSettings | undefined)?.enabled,
              ),
              releaseDate: formatDateInputValue(
                (product.preorder as RawPreorderSettings | undefined)
                  ?.releaseDate,
              ),
              message:
                typeof (product.preorder as RawPreorderSettings | undefined)
                  ?.message === "string"
                  ? String(
                      (product.preorder as RawPreorderSettings | undefined)
                        ?.message,
                    )
                  : "",
              limit:
                typeof (product.preorder as RawPreorderSettings | undefined)
                  ?.limit === "number"
                  ? Number(
                      (product.preorder as RawPreorderSettings | undefined)
                        ?.limit,
                    )
                  : 0,
              reservedQuantity:
                typeof (product.preorder as RawPreorderSettings | undefined)
                  ?.reservedQuantity === "number"
                  ? Number(
                      (product.preorder as RawPreorderSettings | undefined)
                        ?.reservedQuantity,
                    )
                  : 0,
              preorderOnly: Boolean(
                (product.preorder as RawPreorderSettings | undefined)
                  ?.preorderOnly,
              ),
              autoConvert:
                typeof (product.preorder as RawPreorderSettings | undefined)
                  ?.autoConvert === "boolean"
                  ? Boolean(
                      (product.preorder as RawPreorderSettings | undefined)
                        ?.autoConvert,
                    )
                  : true,
              paymentMode:
                (product.preorder as RawPreorderSettings | undefined)
                  ?.paymentMode === "deposit" ||
                (product.preorder as RawPreorderSettings | undefined)
                  ?.paymentMode === "pay_later"
                  ? ((product.preorder as RawPreorderSettings | undefined)
                      ?.paymentMode as "deposit" | "pay_later")
                  : "full",
              depositType:
                (product.preorder as RawPreorderSettings | undefined)
                  ?.depositType === "fixed"
                  ? "fixed"
                  : "percentage",
              depositValue:
                typeof (product.preorder as RawPreorderSettings | undefined)
                  ?.depositValue === "number"
                  ? Number(
                      (product.preorder as RawPreorderSettings | undefined)
                        ?.depositValue,
                    )
                  : 0,
              supplierEta: formatDateInputValue(
                (product.preorder as RawPreorderSettings | undefined)
                  ?.supplierEta,
              ),
              batchName:
                typeof (product.preorder as RawPreorderSettings | undefined)
                  ?.batchName === "string"
                  ? String(
                      (product.preorder as RawPreorderSettings | undefined)
                        ?.batchName,
                    )
                  : "",
            },
            shipping: {
              isPhysicalProduct:
                typeof product.shipping?.isPhysicalProduct === "boolean"
                  ? product.shipping.isPhysicalProduct
                  : true,
              weight:
                typeof product.shipping?.weight === "number"
                  ? product.shipping.weight
                  : undefined,
              weightUnit:
                product.shipping?.weightUnit === "g" ||
                product.shipping?.weightUnit === "kg" ||
                product.shipping?.weightUnit === "lb" ||
                product.shipping?.weightUnit === "oz"
                  ? product.shipping.weightUnit
                  : "kg",
              countryOfOrigin: product.shipping?.countryOfOrigin || "",
              hsCode: product.shipping?.hsCode || "",
              customsDescription: product.shipping?.customsDescription || "",
            },
            seo: {
              pageTitle: product.seo?.pageTitle || "",
              metaDescription: product.seo?.metaDescription || "",
              handle:
                product.seo?.handle || product.handle || product.slug || "",
            },
          });

          updateMediaItems(loadedMedia);
          setDigitalAssets(
            Array.isArray(product.digitalAssets)
              ? (product.digitalAssets as DigitalAssetItem[]).filter(
                  (asset) => asset?._id && asset?.storageKey,
                )
              : [],
          );
          setDigitalDownloadLimit(
            typeof product.digitalDelivery?.downloadLimit === "number"
              ? product.digitalDelivery.downloadLimit
              : 0,
          );
          setDigitalPreview(
            product.digitalPreview?.url
              ? (product.digitalPreview as DigitalPreviewItem)
              : null,
          );
          setProductOptions(loadedOptions);
          setVariants(loadedVariants);
          // The saved product already carries its own options; mark this
          // category as applied so the auto-apply effect doesn't inject the
          // category template on top of them.
          appliedCategoryRef.current = String(
            product.category?._id || product.category || "",
          );
          injectedCategoryOptionIdsRef.current = new Set();
          if (Array.isArray(product.locationInventory)) {
            setProductLocationInventory(
              product.locationInventory.map((li: RawLocationInventory) => ({
                locationId: String(li.locationId),
                quantity:
                  typeof li.quantity === "number" ? li.quantity : 0,
              })),
            );
          }
        }
      } catch (error) {
        console.error("Failed to fetch product:", error);
        toast.error("Failed to load product");
      } finally {
        setIsFetchingProduct(false);
      }
    }

    fetchProduct();
  }, [apiPath, form, productId, updateMediaItems]);


  const onSubmit = async (data: ProductFormData) => {
    // Taking a booked product off the storefront releases every future booked
    // day back onto the ladder IMMEDIATELY, and a competitor can buy them the
    // same second. That is not recoverable by re-publishing, so the vendor sees
    // the days and the credit before the save, not in a toast afterwards.
    const goesDark =
      productId &&
      wasBoostableRef.current &&
      (data.status !== "active" || data.publishing?.onlineStore === false);
    if (goesDark) {
      // `apiPath`, never a hardcoded /api/vendor: this form is shared, and an
      // admin calling the vendor endpoint fails its guard, gets swallowed by
      // the catch below, and unpublishes with no warning at all.
      const impact = await apiClient
        .get<{ days: string[]; credit: number | null; currency: string }>(
          `${apiPath}/${productId}/boost-impact`,
        )
        .catch(() => null);
      if (impact && impact.days.length > 0) {
        const ok = await confirm({
          title: t.has("admin.productForm.boostRelease.title")
            ? t("admin.productForm.boostRelease.title")
            : "This product has booked sponsored days",
          // Interpolation goes through t() itself — the ICU formatter throws on
          // a placeholder with no value — so the fallback gets the same
          // substitution by hand.
          //
          // A null credit means the product holds bookings in more than one
          // currency, which cannot be added into a single figure. The day count
          // is true either way, so that message drops the amount rather than
          // printing a number that means nothing in either currency.
          description:
            impact.credit === null
              ? t.has("admin.productForm.boostRelease.descriptionDaysOnly")
                ? t("admin.productForm.boostRelease.descriptionDaysOnly", {
                    days: impact.days.length,
                  })
                : `Taking it off the storefront releases ${impact.days.length} booked day(s) back to the marketplace calendar straight away. They can be resold immediately, and re-publishing will not get them back. The days are credited back to you at each booking's own daily rate.`
              : t.has("admin.productForm.boostRelease.description")
                ? t("admin.productForm.boostRelease.description", {
                    days: impact.days.length,
                    credit: impact.credit,
                    currency: impact.currency,
                  })
                : `Taking it off the storefront releases ${impact.days.length} booked day(s) back to the marketplace calendar straight away. They can be resold immediately, and re-publishing will not get them back. ${impact.credit} ${impact.currency} is credited back to you.`,
          confirmText: t.has("common.continue") ? t("common.continue") : "Continue",
          cancelText: t.has("common.cancel") ? t("common.cancel") : "Cancel",
          type: "danger",
        });
        if (!ok) return;
      }
    }

    const formHasVariantOptions = productOptions.some(
      (option) => option.name.trim() && option.values.length > 0,
    );
    const missingRequiredWeight = formHasVariantOptions
      ? variants.some((variant) => {
          const requiresShipping =
            variant.requiresShipping ?? data.shipping.isPhysicalProduct;
          return (
            requiresShipping &&
            Number(variant.weight ?? data.shipping.weight ?? 0) <= 0
          );
        })
      : data.shipping.isPhysicalProduct &&
        Number(data.shipping.weight ?? 0) <= 0;
    if (shippingContext.usesWeightRates && missingRequiredWeight) {
      form.setError("shipping.weight", {
        message: "Weight is required for products using weight-based rates",
      });
      toast.error("Add a weight for every shippable product or variant");
      return;
    }

    setIsLoading(true);
    try {
      const url = productId ? `${apiPath}/${productId}` : apiPath;
      const method = productId ? "PUT" : "POST";

      // Auto-generate SKU from title if not provided
      const baseSku = data.inventory.sku?.trim() || generateSku(data.title);

      const normalizedMedia = [...mediaItemsRef.current]
        .map((m, idx) => ({
          _id: m._id || crypto.randomUUID(),
          type:
            (m.type as "image" | "video" | "model" | "external_video") ||
            "image",
          url: m.url,
          filename: m.filename,
          mimeType: m.mimeType,
          alt: m.alt || "",
          position: typeof m.position === "number" ? m.position : idx,
          size: m.size,
          width: m.width,
          height: m.height,
          thumbnailUrl: m.thumbnailUrl,
          provider: m.provider,
          embedId: m.embedId,
          // Every field here is picked by hand; without this the fit chosen
          // in the media dialog would never reach the save.
          fit: !m.type || m.type === "image" ? m.fit : undefined,
        }))
        .filter((m) => m.url);

      const sortedOptions = [...productOptions].sort(
        (a, b) => a.position - b.position,
      );

      const hasVariantOptions = sortedOptions.some(
        (o) => o.name.trim().length > 0 && o.values.length > 0,
      );

      // Updated: preserve full option structure with _id, position, and structured values
      const normalizedOptions = hasVariantOptions
        ? sortedOptions
            .filter((o) => o.name.trim().length > 0 && o.values.length > 0)
            .map((o, idx) => ({
              _id: o.id,
              name: o.name.trim(),
              ...(isOptionVisual(o.visual) ? { visual: o.visual } : {}),
              position: typeof o.position === "number" ? o.position : idx,
              values: [...o.values]
                .sort((a, b) => a.position - b.position)
                .filter((v) => v.value.trim())
                .map((v, vidx) => ({
                  _id: v.id,
                  value: v.value.trim(),
                  colorCode: v.colorCode,
                  position: typeof v.position === "number" ? v.position : vidx,
                })),
            }))
        : [];

      const normalizeSku = (baseSku: string, optionValues: string[]) => {
        const base = baseSku.trim();
        const suffix = optionValues
          .join("-")
          .toUpperCase()
          .trim()
          .replace(/[^A-Z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
        return suffix ? `${base}-${suffix}` : base;
      };

      // Updated: preserve full optionValues structure with optionId, optionName, valueId, value, colorCode
      const normalizedVariants = hasVariantOptions
        ? variants.map((v) => {
            const structuredOptionValues = v.optionValues.map((ov) => ({
              optionId: ov.optionId,
              optionName: ov.optionName,
              valueId: ov.valueId,
              value: ov.value,
              colorCode: ov.colorCode,
            }));

            const valueStrings = structuredOptionValues.map((ov) => ov.value);
            const name =
              v.name?.trim() ||
              (valueStrings.length > 0 ? valueStrings.join(" / ") : "Default");

            const sku = v.sku?.trim() || normalizeSku(baseSku, valueStrings);

            return {
              _id: v.id,
              name,
              sku,
              barcode: v.barcode?.trim() || undefined,
              barcodeFormat: v.barcodeFormat,
              barcodeSource: v.barcodeSource,
              price: typeof v.price === "number" ? v.price : 0,
              comparePrice:
                typeof v.comparePrice === "number" ? v.comparePrice : undefined,
              cost: typeof v.cost === "number" ? v.cost : undefined,
              stock: typeof v.stock === "number" ? v.stock : 0,
              optionValues: structuredOptionValues,
              mediaId: v.mediaId,
              attributes: [],
              locationInventory: Array.isArray(v.locationInventory)
                ? v.locationInventory.map((li) => ({
                    locationId: li.locationId,
                    quantity: typeof li.quantity === "number" ? li.quantity : 0,
                  }))
                : [],
              requiresShipping: v.requiresShipping,
              weight:
                typeof v.weight === "number" ? Math.max(0, v.weight) : undefined,
              weightUnit: v.weightUnit,
              preorder: v.preorder?.enabled
                ? {
                    ...v.preorder,
                    releaseDate: v.preorder.releaseDate?.trim()
                      ? new Date(v.preorder.releaseDate).toISOString()
                      : undefined,
                    supplierEta: v.preorder.supplierEta?.trim()
                      ? new Date(v.preorder.supplierEta).toISOString()
                      : undefined,
                    message: v.preorder.message?.trim() || undefined,
                    batchName: v.preorder.batchName?.trim() || undefined,
                    limit: Math.max(0, v.preorder.limit || 0),
                    reservedQuantity: Math.max(
                      0,
                      v.preorder.reservedQuantity || 0,
                    ),
                    depositValue: Math.max(0, v.preorder.depositValue || 0),
                  }
                : undefined,
            };
          })
        : [];

      // When variants exist, product-level price/stock/barcode are derived
      // from variants by the model's pre-save hook. Submitting them from the
      // form would create two competing sources of truth — instead we send
      // sensible aggregates so listing/cart code that reads product.* still
      // works, but treat per-variant values as canonical.
      const aggregatedPrice = hasVariantOptions
        ? normalizedVariants.reduce(
            (min, v) => (v.price < min ? v.price : min),
            normalizedVariants[0]?.price ?? 0,
          )
        : data.pricing.price;
      const aggregatedStock = hasVariantOptions
        ? normalizedVariants.reduce((sum, v) => sum + (v.stock || 0), 0)
        : data.inventory.quantity;

      // For single-variant products, send productLocationInventory as the
      // canonical inventory representation when locations exist. The model
      // pre-save hook will sum it back into product.stock so reads stay
      // consistent. When no locations are configured, fall back to stock.
      const productLevelLocationInventory =
        !hasVariantOptions && activeLocations.length > 0
          ? productLocationInventory.filter((li) =>
              activeLocations.some((l) => l._id === String(li.locationId)),
            )
          : undefined;
      const preorderPayload = {
        ...data.preorder,
        releaseDate: data.preorder.releaseDate?.trim()
          ? new Date(data.preorder.releaseDate).toISOString()
          : undefined,
        supplierEta: data.preorder.supplierEta?.trim()
          ? new Date(data.preorder.supplierEta).toISOString()
          : undefined,
        message: data.preorder.message?.trim() || undefined,
        batchName: data.preorder.batchName?.trim() || undefined,
        limit: Math.max(0, data.preorder.limit || 0),
        reservedQuantity: Math.max(0, data.preorder.reservedQuantity || 0),
        depositValue: Math.max(0, data.preorder.depositValue || 0),
      };

      const payload = {
        ...data,
        name: data.title,
        price: aggregatedPrice,
        // `null` (not undefined) clears an optional field: JSON.stringify drops
        // undefined, so an emptied input would never reach the server and the
        // stored value would survive. With variants these are derived from the
        // variant rows instead, so we leave them out entirely.
        comparePrice: hasVariantOptions
          ? undefined
          : (data.pricing.comparePrice ?? null),
        unitPrice: data.pricing.unitPrice ?? null,
        unitPriceUnit:
          data.pricing.unitPrice?.baseUnit ||
          (data.pricing.unitPriceUnit === "none"
            ? null
            : data.pricing.unitPriceUnit),
        cost: data.pricing.cost ?? null,
        chargeTax: data.pricing.chargeTax,
        priceOnRequest: data.pricing.priceOnRequest,
        // Null clears it (see CLEARABLE_PRODUCT_FIELDS): an emptied input must
        // drop the merchant's old wording rather than keep it alive on a
        // product that no longer uses a custom label.
        quoteButtonLabel: data.pricing.priceOnRequest
          ? data.pricing.quoteButtonLabel?.trim() || null
          : null,
        sku: baseSku,
        barcode: hasVariantOptions ? undefined : data.inventory.barcode,
        // With variants these come from the variant rows (omitted entirely).
        // Otherwise "auto"/"unspecified" mean "no stored value" — sent as null
        // so the server clears the old one instead of silently keeping it.
        // "auto" then lets assignMissingProductBarcodes re-detect the format.
        barcodeFormat: hasVariantOptions
          ? undefined
          : data.inventory.barcodeFormat === "auto"
            ? null
            : data.inventory.barcodeFormat,
        barcodeSource: hasVariantOptions
          ? undefined
          : data.inventory.barcodeSource === "unspecified"
            ? null
            : data.inventory.barcodeSource,
        stock: aggregatedStock,
        // Only the two policy switches are persisted at product level — the
        // rest of the form's `inventory` group (sku/barcode/quantity) is sent
        // as top-level fields above. A digital product is forced untracked
        // server-side; sending it here keeps the form honest either way.
        inventory: {
          tracked: data.shipping.isPhysicalProduct
            ? data.inventory.tracked
            : false,
          continueSellingWhenOutOfStock:
            data.inventory.continueSellingWhenOutOfStock,
        },
        locationInventory: productLevelLocationInventory,
        images: normalizedMedia
          .filter((m) => m.type === "image")
          .map((m) => m.url),
        media: normalizedMedia,
        // Empty array intentionally clears previously attached files.
        digitalAssets: digitalAssets.map((asset, idx) => ({
          ...asset,
          position: idx,
        })),
        digitalDelivery: { downloadLimit: digitalDownloadLimit },
        digitalPreview: digitalPreview ?? null,
        options: normalizedOptions,
        variants: normalizedVariants,
        preorder: preorderPayload,
        shipping: normalizeProductShippingData(data.shipping),
        ...(method === "PUT" && stockBaselineRef.current
          ? { stockBaseline: stockBaselineRef.current }
          : {}),
      };

      if (method === "PUT") {
        await apiClient.put(url, payload);
      } else {
        await apiClient.post(url, payload);
      }
      toast.success(
        productId
          ? "Product updated successfully"
          : "Product created successfully",
      );
      router.push(basePath);
    } catch (error) {
      toast.error(describeApiError(error, "Failed to save product"));
    } finally {
      setIsLoading(false);
    }
  };

  const watchedTitle = useWatch({ control: form.control, name: "title" }) || "";
  const watchedShortDescription =
    useWatch({ control: form.control, name: "shortDescription" }) || "";
  const watchedCategory = useWatch({ control: form.control, name: "category" });
  const watchedBrand = useWatch({ control: form.control, name: "brand" });
  const watchedProductType =
    useWatch({ control: form.control, name: "productType" }) || "";
  const watchedTags = useWatch({ control: form.control, name: "tags" }) || [];
  const watchedStatus =
    useWatch({ control: form.control, name: "status" }) || "draft";
  const watchedWeightUnit = useWatch({
    control: form.control,
    name: "shipping.weightUnit",
  });
  const watchedPrice =
    useWatch({ control: form.control, name: "pricing.price" }) || 0;
  const watchedUnitPrice = useWatch({
    control: form.control,
    name: "pricing.unitPrice",
  });
  const watchedCost = useWatch({
    control: form.control,
    name: "pricing.cost",
  });
  const watchedSeoHandle =
    useWatch({ control: form.control, name: "seo.handle" }) || "";
  const watchedSeoPageTitle =
    useWatch({ control: form.control, name: "seo.pageTitle" }) || "";
  const watchedSeoMetaDescription =
    useWatch({ control: form.control, name: "seo.metaDescription" }) || "";
  const watchedDescription =
    useWatch({ control: form.control, name: "description" }) || "";
  const watchedIsPhysicalProduct =
    useWatch({
      control: form.control,
      name: "shipping.isPhysicalProduct",
    }) ?? true;
  const watchedShippingWeight = useWatch({
    control: form.control,
    name: "shipping.weight",
  });
  const watchedMissingShippingWeight = productOptions.some(
    (option) => option.name.trim() && option.values.length > 0,
  )
    ? variants.some((variant) => {
        const requiresShipping =
          variant.requiresShipping ?? watchedIsPhysicalProduct;
        return (
          requiresShipping &&
          Number(variant.weight ?? watchedShippingWeight ?? 0) <= 0
        );
      })
    : watchedIsPhysicalProduct && Number(watchedShippingWeight || 0) <= 0;

  // Auto-apply the selected category's variant option template to the product.
  // Picking (or changing) the category merges its options in; options the user
  // added themselves are left untouched, and a previous category's injected
  // options are swapped out. Runs only when the category actually changes.
  useEffect(() => {
    if (categories.length === 0) return;
    const categoryId = watchedCategory || "";
    if (appliedCategoryRef.current === categoryId) return;
    appliedCategoryRef.current = categoryId;

    const category = categoryId
      ? categories.find((c) => String(c._id) === categoryId)
      : null;
    const template = Array.isArray(category?.options) ? category.options : [];

    // The user's / product's own options are everything we didn't inject.
    const ownOptions = productOptions.filter(
      (option) => !injectedCategoryOptionIdsRef.current.has(option.id),
    );
    const ownNames = new Set(
      ownOptions.map((option) => option.name.trim().toLowerCase()),
    );

    // Build fresh options from the template, skipping names the product already
    // has so we never clobber or duplicate the user's own options.
    const injected: VariantOption[] = template
      .filter(
        (t) =>
          t.name?.trim() &&
          Array.isArray(t.values) &&
          t.values.length > 0 &&
          !ownNames.has(t.name.trim().toLowerCase()),
      )
      .map((t) => ({
        id: generateId(),
        name: t.name.trim(),
        position: 0,
        values: t.values
          .filter((v) => v.value?.trim())
          .map((v, vIdx) => ({
            id: generateId(),
            value: v.value.trim(),
            colorCode: typeof v.colorCode === "string" ? v.colorCode : undefined,
            position: vIdx,
          })),
      }));

    const previouslyInjected = ownOptions.length !== productOptions.length;
    injectedCategoryOptionIdsRef.current = new Set(injected.map((o) => o.id));

    // Nothing new to add and nothing to swap out — leave state untouched.
    if (injected.length === 0 && !previouslyInjected) return;

    const mergedOptions = [...ownOptions, ...injected].map((option, idx) => ({
      ...option,
      position: idx,
    }));
    setProductOptions(mergedOptions);

    // Regenerate variant rows to match, preserving pricing/stock the user
    // already entered for combinations that survive.
    const combinations = generateAllCombinations(mergedOptions);
    const mergedVariants = mergeVariants(combinations, variants, watchedPrice);
    setVariants(
      activeLocations.length > 0
        ? mergedVariants.map((v) => withSyncedLocations(v, activeLocations))
        : mergedVariants,
    );
  }, [
    watchedCategory,
    categories,
    productOptions,
    variants,
    activeLocations,
    watchedPrice,
  ]);

  const getProductAuthoringFields = () => {
    const categoryName =
      categories.find((category) => String(category._id) === watchedCategory)
        ?.name || "";
    const brandName =
      brands.find((brand) => String(brand._id) === watchedBrand)?.name || "";

    return {
      title: watchedTitle,
      summary: watchedShortDescription,
      description: watchedDescription,
      category: categoryName,
      brand: brandName,
      productType: watchedProductType,
      tags: watchedTags,
      price: watchedPrice,
      attributes: form.getValues("attributes"),
    };
  };

  const ensureTitleForAI = () => {
    if (watchedTitle.trim()) return true;
    toast.error("Add a product title before using AI generation");
    return false;
  };

  const summaryRequest = {
    entity: "product" as const,
    operation: "summary" as const,
    locale,
    targetField: "shortDescription",
    fields: getProductAuthoringFields(),
    constraints: {
      maxLength: SUMMARY_MAX_CHARS,
      audience: "shopper" as const,
    },
  };

  const descriptionRequest = {
    entity: "product" as const,
    operation: "rich_content" as const,
    locale,
    targetField: "description",
    fields: getProductAuthoringFields(),
    constraints: {
      html: true,
      maxLength: DESCRIPTION_MAX_CHARS,
      audience: "shopper" as const,
    },
  };

  const generateSummaryDraft = async (request: AIAuthoringRequest) => {
    const draft = await aiAuthoring.generateContent("product-summary", request);
    if (typeof draft?.fields.shortDescription === "string")
      return draft.fields.shortDescription;
    if (typeof draft?.fields.summary === "string") return draft.fields.summary;
    return null;
  };

  const generateMediaAltText = async (media: {
    _id: string;
    url: string;
  }): Promise<string | null> => {
    const draft = await aiAuthoring.generateContent(`alt-${media._id}`, {
      entity: "product",
      operation: "alt_text",
      locale,
      sourceUrl: media.url,
      fields: getProductAuthoringFields(),
    });
    return typeof draft?.fields.alt === "string" ? draft.fields.alt : null;
  };

  const generateDescriptionDraft = async (request: AIAuthoringRequest) => {
    const draft = await aiAuthoring.generateContent(
      "product-description",
      request,
    );
    if (typeof draft?.fields.description === "string")
      return draft.fields.description;
    if (typeof draft?.fields.content === "string") return draft.fields.content;
    return null;
  };

  // Long descriptions stream so the merchant sees progress, not a spinner.
  const generateDescriptionDraftStream = async (
    request: AIAuthoringRequest,
    onDelta: (text: string) => void,
  ) => {
    const draft = await aiAuthoring.generateContentStream(
      "product-description",
      request,
      onDelta,
    );
    if (typeof draft?.fields.description === "string")
      return draft.fields.description;
    if (typeof draft?.fields.content === "string") return draft.fields.content;
    return null;
  };

  const seoRequest = {
    entity: "product" as const,
    operation: "seo" as const,
    locale,
    targetField: "seo",
    fields: getProductAuthoringFields(),
    constraints: {
      audience: "shopper" as const,
    },
  };

  const generateSeoDraft = async (request: AIAuthoringRequest) => {
    const draft = await aiAuthoring.generateContent("product-seo", request);
    return draft?.seo ?? null;
  };

  const applyEditedMedia = (
    response: AIAuthoringMediaResponse,
    mode: "add" | "replace",
    sourceId: string,
  ) => {
    const nextItem = {
      _id: response.media._id,
      url: response.media.url,
      filename: response.media.filename,
      type: response.media.type,
      mimeType: response.media.mimeType,
      alt: response.media.alt || watchedTitle,
      size: response.media.size,
      width: response.media.width,
      height: response.media.height,
    };
    updateMediaItems((prev) => {
      const next =
        mode === "replace"
          ? prev.map((item) =>
              item._id === sourceId
                ? { ...nextItem, position: item.position }
                : item,
            )
          : [...prev, { ...nextItem, position: prev.length }];
      return next.map((item, index) => ({ ...item, position: index }));
    });
  };

  // An image uploaded from inside the edit dialog is added to the product grid
  // straight away (so it is tracked, never an orphaned storage object) and then
  // becomes the dialog's edit source.
  const handleEditDialogUpload = (media: {
    _id: string;
    url: string;
    filename?: string;
    type?: string;
    mimeType?: string;
    alt?: string;
    size?: number;
    width?: number;
    height?: number;
  }) => {
    updateMediaItems((prev) =>
      [
        ...prev,
        {
          _id: media._id,
          url: media.url,
          filename: media.filename,
          type: media.type || "image",
          mimeType: media.mimeType,
          alt: media.alt,
          position: prev.length,
          size: media.size,
          width: media.width,
          height: media.height,
        },
      ].map((item, index) => ({ ...item, position: index })),
    );
  };

  // All product images, ordered — the pool the "Edit with AI" dialog lets the
  // user switch between. The header action starts on the first (cover) image.
  const editableImages = [...mediaItems]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .filter((m) => ((m as UploadedMedia).type || "image") === "image")
    .map((m) => ({ _id: m._id, url: m.url, alt: m.alt }));

  // AI Image Studio — all wiring lives in the shared hook so it stays in sync
  // with every other surface that uses it.
  const productStudio = useAiStudio({
    entity: "product",
    scope: isVendor ? "vendor" : "admin",
    locale,
    targetField: "media",
    audience: "shopper",
    getFields: getProductAuthoringFields,
    images: editableImages,
    // Autosave the studio's work per product so a page reload can resume it.
    persistKey: `product:${isVendor ? "vendor" : "admin"}:${productId ?? "new"}`,
    breadcrumbRoot: productId ? "Edit product" : "Add product",
    savedMessage: "Saved to product media",
    posHref: `/${locale}/${isVendor ? "vendor" : area}/pos`,
    browseHref: `/${locale}`,
    onUpload: handleEditDialogUpload,
    onDelete: (mediaId) =>
      updateMediaItems((prev) =>
        prev
          .filter((item) => item._id !== mediaId)
          .map((item, index) => ({ ...item, position: index })),
      ),
    onSave: (response, sourceId) =>
      applyEditedMedia(response, sourceId ? "replace" : "add", sourceId ?? ""),
    // Storefront-card preview inside the studio — a snapshot of the product
    // being edited, read fresh when the vendor toggles the preview on.
    cardPreview: () => {
      const comparePrice = form.getValues("pricing.comparePrice");
      const colorOption = findColorOption(productOptions);
      return {
        name: watchedTitle,
        price: Number(watchedPrice) || 0,
        comparePrice:
          typeof comparePrice === "number" ? comparePrice : undefined,
        variants: variants.map((variant) => ({
          price: variant.price,
          comparePrice: variant.comparePrice,
        })),
        colors: (colorOption?.values || []).map((value) => ({
          value: value.value,
          colorCode: value.colorCode,
        })),
        featured: form.getValues("featured") ?? false,
      };
    },
  });

  // Deep link from the AI Studio hub's "Design product graphics" card
  // (/admin/products/new?ai-studio=image) opens the Image Studio on arrival. A
  // ref guards against reopening once the user closes it, and the param is
  // stripped so a reload or browser back doesn't force it open again.
  const autoOpenedStudioRef = useRef(false);
  const openProductStudio = productStudio.openStudio;
  useEffect(() => {
    if (autoOpenedStudioRef.current || isFetching) return;
    if (searchParams.get("ai-studio") !== "image") return;
    autoOpenedStudioRef.current = true;
    openProductStudio(editableImages[0]?._id ?? null);
    router.replace(pathname, { scroll: false });
  }, [
    isFetching,
    searchParams,
    openProductStudio,
    editableImages,
    router,
    pathname,
  ]);

  if (isFetching) {
    return <ProductFormSkeleton />;
  }

  const hasVariants = variants.length > 0;
  const variantPriceRange = hasVariants
    ? variants.reduce(
        (acc, v) => {
          const p = typeof v.price === "number" ? v.price : 0;
          return {
            min: Math.min(acc.min, p),
            max: Math.max(acc.max, p),
          };
        },
        { min: Infinity, max: -Infinity },
      )
    : null;
  const variantTotalStock = hasVariants
    ? variants.reduce((sum, v) => sum + (v.stock || 0), 0)
    : 0;
  const watchedProfit =
    typeof watchedCost === "number" ? watchedPrice - watchedCost : undefined;
  const watchedMargin =
    typeof watchedProfit === "number" && watchedPrice > 0
      ? (watchedProfit / watchedPrice) * 100
      : undefined;
  const currencySymbol = currency?.symbol || currency?.code || "USD";



  const handleDelete = async () => {
    if (!productId) return;

    const ok = await confirm({
      title: "Delete product",
      description:
        "Are you sure you want to delete this product? This action cannot be undone.",
      confirmText: "Delete",
      cancelText: "Cancel",
      type: "danger",
      confirmVariant: "destructive",
    });

    if (!ok) return;

    setIsDeleting(true);
    try {
      await apiClient.delete(`${apiPath}/${productId}`);
      toast.success("Product deleted successfully");
      router.push(basePath);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to delete product",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
        className="mx-auto w-full max-w-6xl space-y-4"
      >
        <AdminFormStickyHeader
          className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
          title={
            watchedTitle ||
            (productId
              ? t("admin.productForm.editProduct")
              : t("admin.productForm.addProduct"))
          }
          status={
            <Badge
              variant={watchedStatus === "active" ? "default" : "outline"}
              className="shrink-0"
            >
              {watchedStatus === "active"
                ? t("admin.productForm.status.active")
                : watchedStatus === "draft"
                  ? t("admin.productForm.status.draft")
                  : t("admin.productForm.status.unlisted")}
            </Badge>
          }
          actions={
            <>
              {productId && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(
                        `/${locale}/products/${watchedSeoHandle || productId}`,
                        "_blank",
                      )
                    }
                    className="shrink-0"
                    aria-label={t("admin.productForm.actions.view")}
                  >
                    <Eye className="h-4 w-4" />
                    <span className="hidden sm:inline">
                      {t("admin.productForm.actions.view")}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDelete}
                    disabled={isLoading || isDeleting}
                    className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
                    aria-label={t(
                      "admin.productForm.actions.deleteProduct",
                    )}
                    aria-busy={isDeleting}
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    <span className="hidden sm:inline">
                      {t("admin.productForm.actions.deleteProduct")}
                    </span>
                  </Button>
                </>
              )}
              <Button
                type="submit"
                disabled={isLoading || isDeleting}
                size="sm"
              >
                {isLoading && (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                )}
                {t("common.save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => router.back()}
                className="shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("common.back")}
              </Button>
            </>
          }
        />

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-4 lg:col-span-2">
            <DetailsCard
              form={form}
              attributeSuggestionsEndpoint={
                isVendor
                  ? "/api/vendor/products/attribute-suggestions"
                  : "/api/admin/products/attribute-suggestions"
              }
              summaryAiAction={
                <AiGenerateMenu
                  label="Generate"
                  placeholder="Generate a short overview of the product under 50 words…"
                  minChars={SUMMARY_MIN_CHARS}
                  maxChars={SUMMARY_MAX_CHARS}
                  request={summaryRequest}
                  loading={aiAuthoring.isLoading("product-summary")}
                  canOpen={ensureTitleForAI}
                  onGenerate={generateSummaryDraft}
                  onApply={(value) =>
                    form.setValue("shortDescription", value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
              }
              descriptionAiAction={
                <AiGenerateMenu
                  label="Generate"
                  placeholder="Write a detailed product description…"
                  format="html"
                  minChars={DESCRIPTION_MIN_CHARS}
                  maxChars={DESCRIPTION_MAX_CHARS}
                  request={descriptionRequest}
                  loading={aiAuthoring.isLoading("product-description")}
                  canOpen={ensureTitleForAI}
                  onGenerate={generateDescriptionDraft}
                  onGenerateStream={generateDescriptionDraftStream}
                  onApply={(value) =>
                    form.setValue("description", value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
              }
            />

            {/* Format is fixed once the product exists — see ProductFormatCard. */}
            <ProductFormatCard form={form} locked={!!productId} />

            {watchedIsPhysicalProduct && (
              <PreorderCard
                form={form}
                setVariants={setVariants}
                deferredBalanceSupported={deferredBalanceSupported}
                access={preorderAccess}
              />
            )}

            <Card className="gap-2">
              <CardHeader>
                <CardTitle>
                  {t("admin.productForm.sections.media")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <MediaUploader
                  value={mediaItems.map((m) => ({
                    _id: m._id,
                    url: m.url,
                    filename: m.filename,
                    type: (m as UploadedMedia).type || "image",
                    mimeType: (m as UploadedMedia).mimeType || "image/jpeg",
                    alt: m.alt,
                    position: m.position,
                    thumbnailUrl: m.thumbnailUrl,
                    provider: m.provider,
                    embedId: m.embedId,
                    fit: m.fit,
                  }))}
                  allowImageFit
                  onChange={(newMedia) => {
                    updateMediaItems(
                      newMedia.map((m, idx) => ({
                        _id: m._id,
                        url: m.url,
                        filename: m.filename,
                        type: m.type,
                        mimeType: m.mimeType,
                        alt: m.alt,
                        position: m.position ?? idx,
                        size: m.size,
                        width: m.width,
                        height: m.height,
                        thumbnailUrl: m.thumbnailUrl,
                        provider: m.provider,
                        embedId: m.embedId,
                        fit: m.fit,
                      })),
                    );
                    // Update variants to clear invalid media IDs
                    const validIds = new Set(newMedia.map((m) => m._id));
                    setVariants((prev) =>
                      prev.map((v) =>
                        v.mediaId && !validIds.has(v.mediaId)
                          ? { ...v, mediaId: undefined }
                          : v,
                      ),
                    );
                  }}
                  maxFiles={10}
                  allowExternalVideo
                  aiGenerateAction={
                    <AiStudioMenu
                      onOpenStudio={() =>
                        productStudio.openStudio(editableImages[0]?._id ?? null)
                      }
                    />
                  }
                  onGenerateAlt={generateMediaAltText}
                />
                {productStudio.studio}
              </CardContent>
            </Card>

            {!watchedIsPhysicalProduct && (
              <DigitalFilesCard
                assets={digitalAssets}
                onChange={setDigitalAssets}
                downloadLimit={digitalDownloadLimit}
                onDownloadLimitChange={setDigitalDownloadLimit}
                preview={digitalPreview}
                onPreviewChange={setDigitalPreview}
                isVendor={isVendor}
              />
            )}

            <PricingCard
              form={form}
              currencySymbol={currencySymbol}
              hasVariants={hasVariants}
              variantCount={variants.length}
              variantPriceRange={variantPriceRange}
              watchedUnitPrice={watchedUnitPrice}
              watchedPrice={watchedPrice}
              watchedProfit={watchedProfit}
              watchedMargin={watchedMargin}
              pricingAccordionValue={pricingAccordionValue}
              setPricingAccordionValue={setPricingAccordionValue}
              unitPricePopoverOpen={unitPricePopoverOpen}
              setUnitPricePopoverOpen={setUnitPricePopoverOpen}
            />

            {watchedIsPhysicalProduct && (
              <InventoryCard
                form={form}
                hasVariants={hasVariants}
                variantCount={variants.length}
                variantTotalStock={variantTotalStock}
                activeLocations={activeLocations}
                productLocationInventory={productLocationInventory}
                setProductLocationInventory={setProductLocationInventory}
                onLocationCreated={handleLocationCreated}
                canManageLocations={canManageLocations}
              />
            )}

            {watchedIsPhysicalProduct && (
              <ShippingCard
                form={form}
                isVendor={isVendor}
                locale={locale}
                shippingContext={shippingContext}
                watchedMissingShippingWeight={watchedMissingShippingWeight}
              />
            )}

            <Card className="gap-2">
              <CardHeader>
                <CardTitle>
                  {t("admin.productForm.sections.variants")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <VariantsManager
                  options={productOptions}
                  onOptionsChange={setProductOptions}
                  variants={variants}
                  onVariantsChange={setVariants}
                  mediaItems={editableImages}
                  defaultPrice={watchedPrice}
                  locations={activeLocations}
                  defaultRequiresShipping={watchedIsPhysicalProduct}
                  defaultWeightUnit={watchedWeightUnit}
                  preorderLockedReason={preorderLockMessage(preorderAccess)}
                />
              </CardContent>
            </Card>

            <SearchEngineListingPreview
              pageTitle={watchedSeoPageTitle}
              metaDescription={watchedSeoMetaDescription}
              handle={watchedSeoHandle}
              title={watchedTitle}
              description={watchedDescription}
              entityLabel="product"
              emptyTitle="Untitled Product"
              emptyHandle="product-handle"
              pathPrefix="products"
              titleMaxChars={SEO_TITLE_MAX_CHARS}
              descriptionMaxChars={SEO_DESCRIPTION_MAX_CHARS}
              aiGenerateAction={
                <AiGenerateMenu<AIAuthoringSeoDraft>
                  label="Improve SEO"
                  placeholder="Describe the SEO you want — keywords to target, tone, focus…"
                  allowAttachment={false}
                  request={seoRequest}
                  loading={aiAuthoring.isLoading("product-seo")}
                  canOpen={ensureTitleForAI}
                  onGenerate={generateSeoDraft}
                  previewText={(draft) =>
                    [draft.pageTitle, draft.metaDescription]
                      .filter(Boolean)
                      .join("\n")
                  }
                  onApply={(draft) => {
                    if (draft.pageTitle) {
                      form.setValue("seo.pageTitle", draft.pageTitle, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }
                    if (draft.metaDescription) {
                      form.setValue(
                        "seo.metaDescription",
                        draft.metaDescription,
                        { shouldDirty: true, shouldValidate: true },
                      );
                    }
                    if (draft.handle) {
                      form.setValue("seo.handle", draft.handle, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }
                  }}
                />
              }
              onPageTitleChange={(value) =>
                form.setValue("seo.pageTitle", value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              onMetaDescriptionChange={(value) =>
                form.setValue("seo.metaDescription", value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              onHandleChange={(value) =>
                form.setValue("seo.handle", value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            />
          </div>

          <div className="min-w-0 space-y-4">
            <Card className="gap-2">
              <CardHeader>
                <CardTitle>
                  {t("admin.productForm.sections.status")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("admin.productForm.fields.status")}
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full text-start">
                            <SelectValue
                              placeholder={t(
                                "admin.productForm.placeholders.status",
                              )}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent position="popper" sideOffset={4}>
                          <SelectItem
                            value="active"
                            description={t(
                              "admin.productForm.status.activeDescription",
                            )}
                          >
                            {t("admin.productForm.status.active")}
                          </SelectItem>
                          <SelectItem
                            value="draft"
                            description={t(
                              "admin.productForm.status.draftDescription",
                            )}
                          >
                            {t("admin.productForm.status.draft")}
                          </SelectItem>
                          <SelectItem
                            value="unlisted"
                            description={t(
                              "admin.productForm.status.unlistedDescription",
                            )}
                          >
                            {t("admin.productForm.status.unlisted")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {!isVendor && (
                  <FormField
                    control={form.control}
                    name="featured"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-3">
                        <FormLabel>
                          {t("admin.productForm.fields.featured")}
                        </FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                )}
              </CardContent>
            </Card>

            <Card className="gap-2">
              <CardHeader>
                <CardTitle>
                  {t("admin.productForm.sections.publishing")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <FormField
                  control={form.control}
                  name="publishing.onlineStore"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <FormLabel>
                        {t("admin.productForm.fields.onlineStore")}
                      </FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="publishing.pointOfSale"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <FormLabel>
                        {t("admin.productForm.fields.pointOfSale")}
                      </FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <OrganizationCard
              form={form}
              categories={categories}
              brands={brands}
              availableCollections={availableCollections}
            />
          </div>
        </div>
      </form>
    </Form>
  );
}
