"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Star,
  Minus,
  Plus,
  ShoppingBag,
  BookOpen,
  ChevronRight,
  FileDown,
  Home,
  PackageOpen,
  Store,
  Truck,
} from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCurrency } from "@/providers/currency-provider";
import { useMultiVendorMode } from "@/providers/app-settings-provider";
import { useCart } from "@/hooks/use-cart";
import { toast } from "@/components/ui/toast-notification";
import { type Locale } from "@/config/i18n.config";
import { ProductCollapsibleSection } from "./product-collapsible-section";
import { ProductImageGallery } from "./product-image-gallery";
import { OptionValueSelector } from "./option-value-selector";
import { ProductShareButtons } from "./product-share-buttons";
import { StorefrontChatButton } from "@/components/chat/storefront-chat-button";
import { VendorExternalChannels } from "@/components/chat/vendor-external-channels";
import type { VendorMessagingSettings } from "@/lib/notifications/vendor-messaging";
import type { ProductFulfillmentNotes } from "@/lib/products/fulfillment-notes";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/intl/money";
import { trackAddToCart, trackProductView } from "@/lib/analytics/events";
import {
  UNTRACKED_PURCHASE_CAP,
  getPurchasableQuantity,
  productTracksStock,
} from "@/lib/products/stock-policy";
import {
  DEFAULT_PRODUCT_DETAIL_GROUPS,
  visibleProductDetailGroups,
  type ProductDetailRow,
} from "@/lib/storefront/sections/product-detail-rows";
import {
  DEFAULT_PRODUCT_DETAIL_CONFIG,
  typographyCss,
  type ProductDetailConfig,
} from "@/lib/storefront/sections/product-detail-style";
import {
  getQuoteButtonLabel,
  isQuoteOnlyProduct,
} from "@/lib/products/quote-pricing";
import {
  QuoteRequestDialog,
} from "@/components/products/quote-request-dialog";
import { useHydrated } from "@/hooks/use-client-value";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

// Deferred so the large size-chart tables/modal load only when opened.
const ProductSizeGuide = dynamic(() => import("./product-size-guide"));

interface Product {
  _id: string;
  name: string;
  title?: string;
  slug: string;
  description: string;
  shortDescription?: string;
  price: number;
  comparePrice?: number;
  /** Sold by quote — see lib/products/quote-pricing.ts. */
  priceOnRequest?: boolean;
  quoteButtonLabel?: string;
  sku: string;
  barcode?: string;
  stock: number;
  /** Stock policy — read via lib/products/stock-policy.ts, never directly. */
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean };
  preorder?: {
    enabled?: boolean;
    releaseDate?: string | Date;
    message?: string;
    limit?: number;
    reservedQuantity?: number;
    preorderOnly?: boolean;
    autoConvert?: boolean;
    paymentMode?: "full" | "deposit" | "pay_later";
    depositType?: "percentage" | "fixed";
    depositValue?: number;
    batchName?: string;
  };
  images: string[];
  media?: {
    _id: string;
    type?: "image" | "video" | "model" | "external_video";
    url: string;
    alt?: string;
    position?: number;
    mimeType?: string;
    thumbnailUrl?: string;
    provider?: "youtube" | "vimeo";
    embedId?: string;
  }[];
  /** Sanitized for the storefront — no storage keys, display fields only. */
  digitalAssets?: { _id: string; filename: string; size?: number }[];
  digitalPreview?: { url: string; filename?: string };
  category?: { _id: string; name: string; slug: string };
  brand?: { _id: string; name: string; slug: string; logo?: string };
  tags: string[];
  attributes: { name: string; value: string }[];
  shipping?: {
    isPhysicalProduct?: boolean;
    weight?: number;
    weightUnit?: "g" | "kg" | "lb" | "oz";
    countryOfOrigin?: string;
    hsCode?: string;
  };
  options?: {
    name: string;
    values: {
      _id: string;
      value: string;
      position?: number;
      colorCode?: string;
    }[];
  }[];
  variants: {
    _id: string;
    name: string;
    sku: string;
    barcode?: string;
    price: number;
    comparePrice?: number;
    stock: number;
    attributes: { name: string; value: string }[];
    optionValues?: (
      | string
      | {
          optionId: string;
          optionName: string;
          valueId: string;
          value: string;
          colorCode?: string;
        }
    )[];
    requiresShipping?: boolean;
    weight?: number;
    weightUnit?: "g" | "kg" | "lb" | "oz";
    mediaId?: string;
    image?: string;
    preorder?: Product["preorder"];
  }[];
  rating: number;
  reviewCount: number;
  /** Lifetime units sold, when the API provides it (Minimal's "N sold"). */
  soldCount?: number;
  featured: boolean;
  vendorId?: {
    _id: string;
    storeName: string;
    slug: string;
    logo?: string;
    rating: number;
    messaging?: VendorMessagingSettings;
    isDefault?: boolean;
  };
  platformMessaging?: VendorMessagingSettings;
}

type OptionValueObj = {
  optionId: string;
  optionName: string;
  valueId: string;
  value: string;
  colorCode?: string;
};

type ProductMediaKind = "image" | "video" | "model" | "external_video";
type ProductDetailsSection = "description" | "specifications" | "reviews";
type ProductInfoSectionKind =
  | "sizeFit"
  | "technicalDetails"
  | "dimensionsDetails"
  | "productInformation"
  | "productDetails";
type ProductInfoField = {
  label: string;
  value: string;
  href?: string;
};

type DisplayMedia = {
  id: string;
  type: ProductMediaKind;
  url: string;
  alt: string;
  mimeType?: string;
  thumbnailUrl?: string;
  provider?: "youtube" | "vimeo";
  embedId?: string;
};

function getProductInfoSectionKind(product: Product): ProductInfoSectionKind {
  const categoryText = [
    product.category?.name,
    product.category?.slug,
    ...(product.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    /\b(cloth|clothes|clothing|fashion|apparel|wear|shirt|t-shirt|tee|pant|jean|dress|shoe|sneaker|hoodie|jacket)\b/.test(
      categoryText,
    )
  ) {
    return "sizeFit";
  }

  if (
    /\b(electronic|electronics|phone|mobile|laptop|computer|camera|audio|speaker|headphone|gadget|device|tv|television)\b/.test(
      categoryText,
    )
  ) {
    return "technicalDetails";
  }

  if (
    /\b(furniture|home|decor|table|chair|sofa|bed|mattress|cabinet|shelf|lighting)\b/.test(
      categoryText,
    )
  ) {
    return "dimensionsDetails";
  }

  if (
    /\b(beauty|cosmetic|skincare|makeup|perfume|fragrance|health|personal-care)\b/.test(
      categoryText,
    )
  ) {
    return "productInformation";
  }

  return "productDetails";
}

function normalizeAttributeKey(key: string) {
  return key
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildAttributeLookup(
  productAttributes: Product["attributes"],
  variantAttributes?: Product["variants"][number]["attributes"],
) {
  const lookup = new Map<string, string>();
  const addAttributes = (attributes?: Product["attributes"]) => {
    attributes?.forEach((attribute) => {
      const key = normalizeAttributeKey(attribute.name || "");
      const value = attribute.value?.trim();
      if (key && value) lookup.set(key, value);
    });
  };

  addAttributes(productAttributes);
  addAttributes(variantAttributes);

  return lookup;
}

function getAttributeValue(attributes: Map<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = attributes.get(normalizeAttributeKey(key));
    if (value) return value;
  }
  return undefined;
}

function formatProductWeight(
  weight?: number,
  weightUnit?: "g" | "kg" | "lb" | "oz",
) {
  if (typeof weight !== "number" || Number.isNaN(weight) || weight <= 0) {
    return undefined;
  }
  return `${weight}${weightUnit ? ` ${weightUnit}` : ""}`;
}

function formatPreorderDate(value?: string | Date) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getPreorderRemaining(settings?: Product["preorder"]) {
  const limit = Number(settings?.limit || 0);
  if (!Number.isFinite(limit) || limit <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - Number(settings?.reservedQuantity || 0));
}

function isPreorderOpen(settings?: Product["preorder"]) {
  if (!settings?.enabled) return false;
  const releaseDate = settings.releaseDate
    ? new Date(settings.releaseDate)
    : null;
  if (
    settings.autoConvert !== false &&
    releaseDate &&
    !Number.isNaN(releaseDate.getTime()) &&
    releaseDate.getTime() < Date.now()
  ) {
    return false;
  }
  return getPreorderRemaining(settings) > 0;
}

function calculatePreorderDueNow(params: {
  unitPrice: number;
  quantity: number;
  settings?: Product["preorder"];
}) {
  const lineTotal = Math.max(0, params.unitPrice * params.quantity);
  const mode = params.settings?.paymentMode || "full";
  if (mode === "pay_later") return { dueNow: 0, dueLater: lineTotal };
  if (mode !== "deposit") return { dueNow: lineTotal, dueLater: 0 };

  const rawValue = Number(params.settings?.depositValue || 0);
  const value = Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
  const dueNow =
    params.settings?.depositType === "fixed"
      ? Math.min(lineTotal, value * params.quantity)
      : Math.min(lineTotal, (lineTotal * Math.min(value, 100)) / 100);
  return { dueNow, dueLater: Math.max(0, lineTotal - dueNow) };
}

/* The Description row in the minimal appearance is a summary, not the whole
   article — the full rich text still renders in the page's Description
   section below. Merchants who wrote a short description get theirs
   verbatim; otherwise we trim the long copy down to its opening sentences. */
const DESCRIPTION_SUMMARY_MAX_CHARS = 240;

function getDescriptionSummary(product: Product) {
  const short = product.shortDescription?.trim();
  if (short) return short;

  const plain = (product.description || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= DESCRIPTION_SUMMARY_MAX_CHARS) return plain;

  // Cut on the last whole word so the ellipsis never lands mid-word.
  const clipped = plain.slice(0, DESCRIPTION_SUMMARY_MAX_CHARS);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).replace(/[,;:.\s]+$/, "")}…`;
}

function humanizeAttributeLabel(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isColorOptionName(optionName: string) {
  return ["color", "colour", "colors", "colours"].some((keyword) =>
    optionName.toLowerCase().includes(keyword),
  );
}

function isSizeOptionName(optionName: string) {
  return ["size", "sizing"].some((keyword) =>
    optionName.toLowerCase().includes(keyword),
  );
}

function getSelectedOptionEntries({
  product,
  selectedVariant,
  selectedOptions,
}: {
  product: Product;
  selectedVariant?: Product["variants"][number];
  selectedOptions: string[];
}) {
  const productOptions = product.options || [];
  const optionValues = (selectedVariant?.optionValues || []) as (
    string | OptionValueObj
  )[];

  if (optionValues.length > 0) {
    return optionValues
      .map((optionValue, index) => {
        if (typeof optionValue === "string") {
          return {
            name: productOptions[index]?.name || "",
            value: optionValue,
          };
        }

        return {
          name: optionValue.optionName || productOptions[index]?.name || "",
          value: optionValue.value,
        };
      })
      .filter((entry) => entry.name && entry.value);
  }

  return selectedOptions
    .map((value, index) => ({
      name: productOptions[index]?.name || "",
      value,
    }))
    .filter((entry) => entry.name && entry.value);
}

function getOptionValues(product: Product, matcher: (name: string) => boolean) {
  const option = product.options?.find((item) => matcher(item.name));
  if (!option) return [];

  return Array.from(
    new Set(
      option.values
        .map((item) => item.value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function getProductInfoFields({
  product,
  selectedVariant,
  selectedOptions,
  sectionKind,
  locale,
}: {
  product: Product;
  selectedVariant?: Product["variants"][number];
  selectedOptions: string[];
  sectionKind: ProductInfoSectionKind;
  locale: Locale;
}): ProductInfoField[] {
  const attributes = buildAttributeLookup(
    product.attributes || [],
    selectedVariant?.attributes || [],
  );
  const categoryHref = product.category
    ? `/${locale}/categories/${product.category.slug}`
    : undefined;
  const brandHref = product.brand
    ? `/${locale}/brands/${encodeURIComponent(product.brand.slug)}`
    : undefined;
  const weight =
    formatProductWeight(selectedVariant?.weight, selectedVariant?.weightUnit) ||
    formatProductWeight(product.shipping?.weight, product.shipping?.weightUnit);

  const fields: ProductInfoField[] = [
    {
      label: "SKU",
      value: selectedVariant?.sku || product.sku,
    },
  ];

  if (product.brand?.name) {
    fields.push({
      label: "Brand",
      value: product.brand.name,
      href: brandHref,
    });
  }

  if (product.category?.name) {
    fields.push({
      label: "Category",
      value: product.category.name,
      href: categoryHref,
    });
  }

  if (sectionKind === "sizeFit") {
    const selectedEntries = getSelectedOptionEntries({
      product,
      selectedVariant,
      selectedOptions,
    });
    const selectedColor = selectedEntries.find((entry) =>
      isColorOptionName(entry.name),
    )?.value;
    const selectedSize = selectedEntries.find((entry) =>
      isSizeOptionName(entry.name),
    )?.value;

    if (selectedColor) fields.push({ label: "Color", value: selectedColor });
    if (selectedSize) {
      fields.push({ label: "Size shown", value: selectedSize });
    }
  }

  const configs: Record<
    ProductInfoSectionKind,
    { label: string; keys: string[] }[]
  > = {
    sizeFit: [
      {
        label: "Material",
        keys: ["material", "fabric", "composition", "upper_material"],
      },
      { label: "Fit", keys: ["fit", "fit_type", "silhouette"] },
      {
        label: "Size shown",
        keys: ["size_display", "size_shown", "display_size", "model_size"],
      },
      {
        label: "Model info",
        keys: ["model_info", "model_height", "model_wears", "model_size"],
      },
      { label: "Care", keys: ["care", "care_instructions", "wash_care"] },
    ],
    technicalDetails: [
      { label: "Brand", keys: ["brand", "manufacturer"] },
      { label: "Model", keys: ["model", "model_number", "part_number"] },
      { label: "Warranty", keys: ["warranty", "guarantee"] },
      { label: "Power", keys: ["power", "battery", "battery_life"] },
      { label: "Connectivity", keys: ["connectivity", "connection"] },
      { label: "Dimensions", keys: ["dimensions", "size"] },
      { label: "In the box", keys: ["in_the_box", "box_contents"] },
    ],
    dimensionsDetails: [
      { label: "Material", keys: ["material", "finish"] },
      { label: "Dimensions", keys: ["dimensions", "size", "l_w_h"] },
      { label: "Assembly", keys: ["assembly", "assembly_required"] },
      { label: "Load capacity", keys: ["load_capacity", "weight_capacity"] },
      { label: "Care", keys: ["care", "care_instructions", "cleaning"] },
      { label: "Origin", keys: ["country_of_origin", "origin"] },
    ],
    productInformation: [
      { label: "Net content", keys: ["net_content", "volume", "quantity"] },
      { label: "Ingredients", keys: ["ingredients"] },
      {
        label: "Suitable for",
        keys: ["skin_type", "hair_type", "suitable_for"],
      },
      { label: "How to use", keys: ["how_to_use", "usage", "directions"] },
      { label: "Shelf life", keys: ["shelf_life", "expiry", "expiration"] },
      { label: "Warnings", keys: ["warnings", "caution"] },
    ],
    productDetails: [
      { label: "Brand", keys: ["brand", "manufacturer"] },
      { label: "Model", keys: ["model", "model_number"] },
      { label: "Material", keys: ["material"] },
      { label: "Dimensions", keys: ["dimensions", "size"] },
      { label: "Warranty", keys: ["warranty", "guarantee"] },
      { label: "Origin", keys: ["country_of_origin", "origin"] },
    ],
  };

  configs[sectionKind].forEach((config) => {
    const value = getAttributeValue(attributes, config.keys);
    if (value) fields.push({ label: config.label, value });
  });

  if (sectionKind === "sizeFit") {
    const availableColors = getOptionValues(product, isColorOptionName);
    const availableSizes = getOptionValues(product, isSizeOptionName);
    const selectedEntries = getSelectedOptionEntries({
      product,
      selectedVariant,
      selectedOptions,
    });
    const selectedColor = selectedEntries.find((entry) =>
      isColorOptionName(entry.name),
    )?.value;

    if (availableColors.length > 0) {
      fields.push({
        label: "Color variants",
        value: availableColors.join(", "),
      });
    }
    if (availableSizes.length > 0) {
      fields.push({
        label: selectedColor ? `${selectedColor} sizes` : "Available sizes",
        value: availableSizes.join(", "),
      });
    }
  }

  if (weight) fields.push({ label: "Weight", value: weight });
  if (product.shipping?.countryOfOrigin) {
    fields.push({ label: "Origin", value: product.shipping.countryOfOrigin });
  }
  if (selectedVariant?.barcode || product.barcode) {
    fields.push({
      label: "Barcode",
      value: selectedVariant?.barcode || product.barcode || "",
    });
  }

  const usedLabels = new Set(fields.map((field) => field.label.toLowerCase()));
  for (const [key, value] of attributes.entries()) {
    const label = humanizeAttributeLabel(key);
    if (usedLabels.has(label.toLowerCase())) continue;
    fields.push({ label, value });
    usedLabels.add(label.toLowerCase());
    if (fields.length >= 12) break;
  }

  return fields
    .filter((field) => field.value.trim().length > 0)
    .filter(
      (field, index, allFields) =>
        allFields.findIndex(
          (candidate) =>
            candidate.label.toLowerCase() === field.label.toLowerCase(),
        ) === index,
    )
    .slice(0, 12);
}

function inferMediaType(media: {
  type?: ProductMediaKind;
  url: string;
  mimeType?: string;
}): ProductMediaKind {
  if (media.type) return media.type;
  const mimeType = media.mimeType?.toLowerCase() || "";
  const url = media.url.toLowerCase();

  if (mimeType.startsWith("video/")) return "video";
  if (
    mimeType.includes("gltf") ||
    mimeType === "application/octet-stream" ||
    url.endsWith(".glb") ||
    url.endsWith(".gltf")
  ) {
    return "model";
  }

  return "image";
}

function firstImageUrl(media: DisplayMedia[], images: string[]) {
  return (
    media.find((item) => item.type === "image")?.url ||
    images.find(Boolean) ||
    media.find((item) => item.thumbnailUrl)?.thumbnailUrl ||
    ""
  );
}

const colorMap: Record<string, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  purple: "#a855f7",
  pink: "#ec4899",
  black: "#000000",
  white: "#ffffff",
  gray: "#6b7280",
  grey: "#6b7280",
  brown: "#92400e",
  navy: "#1e3a8a",
  beige: "#d4c4a8",
  cream: "#fffdd0",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  maroon: "#7f1d1d",
  olive: "#65a30d",
  coral: "#fb7185",
  mint: "#86efac",
  gold: "#ca8a04",
  silver: "#94a3b8",
};

function getColorCode(value: string, colorCode?: string): string | null {
  if (colorCode) return colorCode;
  const lowerValue = value.toLowerCase();
  return colorMap[lowerValue] || null;
}

function getVariantColorCodeForOptionValue({
  product,
  optionName,
  valueId,
  value,
}: {
  product: Product;
  optionName: string;
  valueId: string;
  value: string;
}) {
  for (const variant of product.variants || []) {
    const optionValues = (variant.optionValues || []) as (
      string | OptionValueObj
    )[];

    for (let index = 0; index < optionValues.length; index += 1) {
      const optionValue = optionValues[index];
      if (typeof optionValue === "string") continue;

      const variantOptionName =
        optionValue.optionName || product.options?.[index]?.name || "";
      const matchesOption =
        variantOptionName.toLowerCase() === optionName.toLowerCase();
      const matchesValue =
        optionValue.valueId === valueId || optionValue.value === value;

      if (matchesOption && matchesValue && optionValue.colorCode) {
        return optionValue.colorCode;
      }
    }
  }

  return undefined;
}

interface ProductDetailsProps {
  product: Product;
  locale: Locale;
  /**
   * The nearest branch that can actually hand this over, when the shopper has
   * set a location. Resolved on the server so the per-branch counts behind the
   * answer never reach the browser — see `lib/locations/product-collection.ts`.
   */
  collectionOffer?: {
    branchName: string;
    pickupArea?: string;
    distanceKm?: number;
    /** Variants the branch stocks; `null` when the product has none. */
    variantIds: string[] | null;
  } | null;
  /**
   * What the "Delivery info" row may promise: the delivery window checkout
   * would quote and the return terms in force, resolved on the server from
   * the store's settings (lib/products/product-fulfillment-notes.ts). Absent
   * or empty, the row draws nothing — never the old placeholder copy.
   */
  fulfillment?: ProductFulfillmentNotes | null;
  /**
   * The product template's `galleryLayout` setting (product-main section).
   * "full" and "vertical" also change the page arrangement: "full" stacks
   * the gallery above the buy box at every width; "vertical" keeps the two
   * columns but makes the BUY BOX the sticky side while the media list
   * scrolls.
   */
  galleryLayout?: "bottom" | "left" | "grid" | "carousel" | "vertical" | "full";
  /**
   * Which buy-box ARRANGEMENT to draw. Presentation only: both appearances
   * run the identical logic above — variant matching, stock policy, preorder
   * terms, cart handlers — and differ solely in how the same values are laid
   * out. Adding one means adding a branch in the buy-box column below and
   * nothing else; if you find yourself reaching for it outside that column,
   * the difference belongs in the shared code instead.
   */
  appearance?: ProductBuyBoxAppearance;
  /**
   * The Minimal design's row arrangement: visible row keys per group, a
   * hairline between groups. Resolved by the section definition from the
   * stored `rows` setting; the other appearances ignore it.
   */
  rowGroups?: ProductDetailRow[][];
  /**
   * The Minimal design's Visibility + Style knobs, resolved by the section
   * definition from the stored `detailStyle` setting. Ignored elsewhere.
   */
  detail?: ProductDetailConfig;
  /**
   * The template also renders the standalone `product-specification`
   * section (the Electronics preset does), so the inline spec block here
   * stands down — two spec tables on one page is the bug this prevents.
   */
  standaloneSpecs?: boolean;
}

/** The buy-box designs `product-main` offers as section variants. */
export type ProductBuyBoxAppearance = "classic" | "electronics" | "minimal";

export function ProductDetails({
  product,
  locale,
  collectionOffer,
  fulfillment = null,
  galleryLayout = "bottom",
  appearance = "classic",
  rowGroups,
  detail = DEFAULT_PRODUCT_DETAIL_CONFIG,
  standaloneSpecs = false,
}: ProductDetailsProps) {
  const t = useTranslations();
  const router = useRouter();
  const { currency, formatPrice } = useCurrency();
  const { isMultiVendor } = useMultiVendorMode();
  const { addItem, clearCart, items } = useCart();
  const directVendor =
    product.vendorId && product.vendorId.isDefault !== true
      ? product.vendorId
      : undefined;
  const messaging = directVendor?.messaging || product.platformMessaging;
  // "Sold by" attribution — only in a marketplace (multi-vendor on), and only
  // for third-party sellers: the default vendor IS the store itself and has no
  // public /vendors page to stand behind the link.
  const soldByVendor = isMultiVendor ? directVendor : undefined;

  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [isBuyingNow, setIsBuyingNow] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [isSizeGuideOpen, setIsSizeGuideOpen] = useState(false);
  const [isQuoteOpen, setIsQuoteOpen] = useState(false);
  const hasMounted = useHydrated();

  /**
   * "Price on request": this product has no price a shopper may read and no
   * cart line they may create. Every buy box below swaps its money for a
   * "Price on request" line and its Add to cart / Buy now pair for the single
   * button that opens the request form — the cart API refuses these products
   * anyway, so leaving a live Add to cart on screen would only produce an
   * error toast at the end of a click the shopper had every reason to expect
   * to work.
   */
  const quoteOnly = isQuoteOnlyProduct(product);

  const hasSpecifications =
    Array.isArray(product.attributes) && product.attributes.length > 0;
  const hasDescription = !!product.description?.trim();
  const descriptionSummary = getDescriptionSummary(product);
  const descriptionRef = useRef<HTMLDivElement | null>(null);
  const specificationsRef = useRef<HTMLDivElement | null>(null);
  const [activeSection, setActiveSection] =
    useState<ProductDetailsSection>("description");

  // Minimal design's morphing tab bar. It pins under the storefront header
  // when its home slot scrolls past it — and the product/name (left) and
  // price/CTA (right) only exist while pinned. Its pinned life is decoupled
  // from its DOM parent on purpose: reviews render as their own section
  // further down the page and the strip must ride until THAT section's end,
  // which CSS sticky cannot do across section boundaries. So while pinned
  // the strip is position:fixed at its home slot's measured left/width (the
  // slot keeps its height so nothing jumps), and once the reviews section's
  // bottom passes the strip it slides away. Band changes go through state;
  // per-frame geometry writes go straight to the element.
  const tabsHomeRef = useRef<HTMLDivElement | null>(null);
  const tabsBarRef = useRef<HTMLDivElement | null>(null);
  const [tabsStuck, setTabsStuck] = useState(false);
  const [tabsReleased, setTabsReleased] = useState(false);

  useEffect(() => {
    if (appearance !== "minimal") return;
    const home = tabsHomeRef.current;
    const bar = tabsBarRef.current;
    if (!home || !bar) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const header = document.querySelector<HTMLElement>(
        "[data-sticky-header]",
      );
      const offset = header?.offsetHeight ?? 64;
      const homeRect = home.getBoundingClientRect();
      const barHeight = bar.offsetHeight;
      const stuck = homeRect.top <= offset;
      // The strip rides only as far as the reviews section. A template
      // without one falls back to the details section — the old boundary.
      const bound =
        document.getElementById("reviews") ?? home.closest("section");
      const released = Boolean(
        stuck &&
        bound &&
        bound.getBoundingClientRect().bottom <= offset + barHeight,
      );

      if (stuck) {
        // The bar's -mx-4 bleed still applies under position:fixed, so the
        // measured slot width is widened by both margins to keep the fixed
        // box exactly where the in-flow box was.
        const marginX = parseFloat(getComputedStyle(bar).marginLeft) || 0;
        home.style.height = `${barHeight}px`;
        bar.style.position = "fixed";
        bar.style.top = `${offset}px`;
        bar.style.left = `${homeRect.left}px`;
        bar.style.width = `${homeRect.width - 2 * marginX}px`;
      } else {
        home.style.height = "";
        bar.style.position = "";
        bar.style.top = "";
        bar.style.left = "";
        bar.style.width = "";
      }
      setTabsStuck(stuck && !released);
      setTabsReleased(released);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [appearance]);

  const scrollToSection = (target: ProductDetailsSection) => {
    // The specification block lives INSIDE this component under the classic
    // appearance and in its own `product-specification` section under the
    // electronics one, so fall back to the id the section publishes.
    const el =
      target === "description"
        ? descriptionRef.current
        : target === "specifications"
          ? (specificationsRef.current ??
            document.getElementById("specifications"))
          : document.getElementById("reviews");
    if (!el) return;
    setActiveSection(target);
    const header = document.querySelector<HTMLElement>("[data-sticky-header]");
    const offset = (header?.offsetHeight ?? 64) + 24;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
  };

  useEffect(() => {
    const desc = descriptionRef.current;
    if (!desc) return;

    const targets: Element[] = [desc];
    const spec =
      specificationsRef.current ?? document.getElementById("specifications");
    const reviews = document.getElementById("reviews");
    if (spec) targets.push(spec);
    if (reviews) targets.push(reviews);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const target = visible.target as HTMLElement;
        const id = target.dataset.section ?? target.id;
        if (
          id === "description" ||
          id === "specifications" ||
          id === "reviews"
        ) {
          setActiveSection(id);
        }
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
    // All three sections render unconditionally now, so the observer no longer
    // needs to re-subscribe when a product happens to lack specs or reviews.
  }, []);

  const displayMedia = useMemo(() => {
    if (Array.isArray(product.media) && product.media.length > 0) {
      return [...product.media]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((m) => ({
          id: m._id,
          type: inferMediaType(m),
          url: m.url,
          alt: m.alt || product.name,
          mimeType: m.mimeType,
          thumbnailUrl: m.thumbnailUrl,
          provider: m.provider,
          embedId: m.embedId,
        }));
    }
    return (product.images || []).map((url, idx) => ({
      id: String(idx),
      type: "image" as const,
      url,
      alt: product.name,
    }));
  }, [product.images, product.media, product.name]);
  const cartPreviewImage = useMemo(
    () => firstImageUrl(displayMedia, product.images || []),
    [displayMedia, product.images],
  );

  const selectedVariant = useMemo(() => {
    if (!Array.isArray(product.variants) || product.variants.length === 0) {
      return undefined;
    }
    const hasOptions =
      Array.isArray(product.options) && product.options.length > 0;
    if (!hasOptions) return product.variants[0];
    const key = selectedOptions.join("||");
    return (
      product.variants.find((v) => {
        const vKey = ((v.optionValues ?? []) as (string | OptionValueObj)[])
          .map((ov) => (typeof ov === "string" ? ov : ov.value))
          .join("||");
        return vKey === key;
      }) || product.variants[0]
    );
  }, [product.options, product.variants, selectedOptions]);

  useApplyOnChange([product._id, product.options, product.variants], () => {
    if (
      Array.isArray(product.options) &&
      product.options.length > 0 &&
      Array.isArray(product.variants) &&
      product.variants.length > 0
    ) {
      const first = product.variants[0];
      const initial = Array.isArray(first.optionValues)
        ? (first.optionValues as (string | OptionValueObj)[]).map((ov) =>
            typeof ov === "string" ? ov : ov.value,
          )
        : product.options.map((o) => o.values?.[0]?.value || "");
      setSelectedOptions(initial);
    } else {
      setSelectedOptions([]);
    }
    setSelectedImage(0);
    setQuantity(1);
  });

  useApplyOnChange([displayMedia, product.media, selectedVariant], () => {
    if (!selectedVariant) return;
    if (
      selectedVariant.mediaId &&
      Array.isArray(product.media) &&
      product.media.length > 0
    ) {
      const idx = displayMedia.findIndex(
        (m) => m.id === selectedVariant.mediaId,
      );
      if (idx >= 0) setSelectedImage(idx);
    }
  });

  const displayedPrice = selectedVariant?.price ?? product.price;
  const displayedComparePrice =
    selectedVariant?.comparePrice ?? product.comparePrice;
  // Zero for a quote-only product: a "% OFF" badge computed against a price
  // the shopper is never shown is a discount off nothing.
  const discountPercentage =
    !quoteOnly &&
    displayedComparePrice &&
    displayedComparePrice > displayedPrice
      ? Math.round(
          ((displayedComparePrice - displayedPrice) / displayedComparePrice) *
            100,
        )
      : 0;
  /**
   * The collection offer, once it is checked against what is actually selected.
   *
   * `variantIds` is `null` for a product with no variants, where the offer
   * stands as given. With variants it lists exactly the ones that branch holds,
   * so switching from a size it stocks to one it does not withdraws the line
   * rather than leaving a promise on screen for a different item.
   */
  const collectionAtBranch =
    collectionOffer &&
    (collectionOffer.variantIds === null ||
      (selectedVariant?._id
        ? collectionOffer.variantIds.includes(String(selectedVariant._id))
        : false))
      ? collectionOffer
      : null;
  const currentStock = selectedVariant?.stock ?? product.stock;
  // What the buyer may actually take: `currentStock` for a tracked product,
  // otherwise the untracked cap (digital downloads, tracking off, or
  // "continue selling when out of stock").
  const availableStock = getPurchasableQuantity(product, currentStock);
  const selectedPreorder = selectedVariant?.preorder?.enabled
    ? selectedVariant.preorder
    : product.preorder;
  const preorderOpen = isPreorderOpen(selectedPreorder);
  const preorderPurchase =
    preorderOpen && (selectedPreorder?.preorderOnly || availableStock <= 0);
  const preorderRemaining = getPreorderRemaining(selectedPreorder);
  const maxPurchasableQuantity = preorderPurchase
    ? Math.min(
        UNTRACKED_PURCHASE_CAP,
        Number.isFinite(preorderRemaining)
          ? preorderRemaining
          : UNTRACKED_PURCHASE_CAP,
      )
    : availableStock;
  const preorderDateLabel = formatPreorderDate(selectedPreorder?.releaseDate);
  const preorderLimit = Number(selectedPreorder?.limit || 0);
  const preorderReserved = Math.max(
    0,
    Number(selectedPreorder?.reservedQuantity || 0),
  );
  const preorderProgress =
    preorderLimit > 0
      ? Math.min(100, Math.round((preorderReserved / preorderLimit) * 100))
      : 0;
  const preorderTerms = calculatePreorderDueNow({
    unitPrice: selectedVariant?.price ?? product.price,
    quantity,
    settings: selectedPreorder,
  });
  const analyticsItem = useMemo(
    () => ({
      item_id: String(product._id),
      item_name: product.name,
      item_variant: selectedVariant?._id
        ? String(selectedVariant._id)
        : undefined,
      item_category: product.category?.name,
      item_brand: product.brand?.name,
      sku: selectedVariant?.sku || product.sku,
      price: selectedVariant?.price ?? product.price,
      quantity,
    }),
    [
      product._id,
      product.name,
      product.price,
      product.sku,
      product.category?.name,
      product.brand?.name,
      quantity,
      selectedVariant?._id,
      selectedVariant?.price,
      selectedVariant?.sku,
    ],
  );

  useEffect(() => {
    trackProductView({
      currency: currency.code,
      value: selectedVariant?.price ?? product.price,
      items: [analyticsItem],
    });
  }, [analyticsItem, currency.code, product.price, selectedVariant?.price]);

  const handleAddToCart = async () => {
    if (quoteOnly) return;
    setIsAddingToCart(true);
    try {
      await addItem({
        productId: product._id,
        variantId: selectedVariant?._id,
        name: selectedVariant
          ? `${product.name} - ${selectedVariant.name}`
          : product.name,
        price: selectedVariant?.price ?? product.price,
        image:
          displayMedia[selectedImage]?.type === "image"
            ? displayMedia[selectedImage].url
            : cartPreviewImage,
        quantity,
      });
      trackAddToCart({
        currency: currency.code,
        value: (selectedVariant?.price ?? product.price) * quantity,
        items: [analyticsItem],
      });
      toast.success(t("cart.itemAdded"));
    } catch {
      toast.error(t("common.error"));
    } finally {
      setIsAddingToCart(false);
    }
  };

  const handleBuyNow = async () => {
    if (quoteOnly) return;
    setIsBuyingNow(true);
    try {
      // "Buy Now" goes straight to checkout for this single item, so clear
      // the existing cart when it contains items of a different purchase type
      // (the API rejects mixed standard/pre-order carts).
      const requestedPurchaseType = preorderPurchase ? "preorder" : "standard";
      const hasMixedCart = items.some(
        (item) => (item.purchaseType || "standard") !== requestedPurchaseType,
      );
      if (hasMixedCart) {
        await clearCart();
      }

      await addItem({
        productId: product._id,
        variantId: selectedVariant?._id,
        name: selectedVariant
          ? `${product.name} - ${selectedVariant.name}`
          : product.name,
        price: selectedVariant?.price ?? product.price,
        image:
          displayMedia[selectedImage]?.type === "image"
            ? displayMedia[selectedImage].url
            : cartPreviewImage,
        quantity,
      });
      trackAddToCart({
        currency: currency.code,
        value: (selectedVariant?.price ?? product.price) * quantity,
        items: [analyticsItem],
      });
      router.push(`/${locale}/checkout`);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t("common.error");
      toast.error(message);
    } finally {
      setIsBuyingNow(false);
    }
  };

  const isColorOption = (optionName: string) => {
    const colorKeywords = ["color", "colour", "colors", "colours"];
    return colorKeywords.some((k) => optionName.toLowerCase().includes(k));
  };
  const isSizeOption = (optionName: string) => {
    const sizeKeywords = ["size", "sizing"];
    return sizeKeywords.some((k) => optionName.toLowerCase().includes(k));
  };
  const optionEntries = useMemo(() => {
    const opts = Array.isArray(product.options) ? product.options : [];
    return opts
      .map((opt, idx) => ({
        opt,
        idx,
        rank: isColorOption(opt.name) ? 0 : isSizeOption(opt.name) ? 1 : 2,
      }))
      .sort((a, b) => a.rank - b.rank || a.idx - b.idx);
  }, [product.options]);

  const normalizeOptionLabel = (name: string) => {
    if (isColorOption(name)) return "Color";
    if (isSizeOption(name)) return "Size";
    return name;
  };
  const tf = (
    key: string,
    fallback: string,
    values?: Record<string, string | number>,
  ) => {
    if (t.has(key)) {
      return t(key as never, values as never);
    }
    if (!values) return fallback;
    return fallback.replace(/\{(\w+)\}/g, (_, token) =>
      String(values[token] ?? `{${token}}`),
    );
  };
  /**
   * Same as `tf`, for templates whose {placeholders} are substituted by the
   * component that RECEIVES them rather than here. `t.raw` returns the message
   * exactly as authored, so the placeholder survives to the consumer instead of
   * being resolved (or stripped) at this layer.
   */
  const traw = (key: string, fallback: string) =>
    t.has(key) ? String(t.raw(key)) : fallback;
  const buyNowLabel = t.has("common.buyNow")
    ? t("common.buyNow")
    : t.has("product.buyNow")
      ? t("product.buyNow")
      : "Buy now";
  const productInfoSectionKind = getProductInfoSectionKind(product);
  const productInfoSectionTitle = {
    sizeFit: tf("product.sizeAndFit", "Size & Fit"),
    technicalDetails: tf("product.technicalDetails", "Technical Details"),
    dimensionsDetails: tf("product.dimensionsDetails", "Dimensions & Details"),
    productInformation: tf("product.productInformation", "Product Information"),
    productDetails: tf("product.productDetails", "Product Details"),
  }[productInfoSectionKind];
  const productInfoFields = useMemo(
    () =>
      getProductInfoFields({
        product,
        selectedVariant,
        selectedOptions,
        sectionKind: productInfoSectionKind,
        locale,
      }),
    [locale, product, productInfoSectionKind, selectedOptions, selectedVariant],
  );
  const formatDisplayPrice = (price: number) => {
    if (hasMounted) {
      return formatPrice(price);
    }

    // Keep SSR and first client render deterministic to avoid hydration
    // mismatches. The currency still comes from the store (seeded during render
    // by <CurrencyApplier>, so both passes agree) — pinning it to USD here made
    // every non-dollar store flash a "$" before mount.
    return formatCurrency(price, currency.code, currency.locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };
  /* The two pieces every buy box swaps in for a quote-only product. Written
     once here rather than inline in each design: five layouts (minimal,
     electronics, classic, the desktop sticky bar and the mobile one) each
     print a price and a cart control, and five copies of the same swap is how
     one of them ends up still offering Add to cart after a redesign. Both take
     the host design's own classes, so the substitute sits at the size and
     weight of what it replaced. */
  const quoteButtonText = getQuoteButtonLabel(
    product,
    tf("product.requestQuote", "Request a quote"),
  );
  const renderQuotePrice = (
    className: string,
    style?: React.CSSProperties,
  ) => (
    <span className={className} style={style}>
      {tf("product.priceOnRequest", "Price on request")}
    </span>
  );
  const renderQuoteButton = (className: string) => (
    <Button
      type="button"
      className={className}
      onClick={() => setIsQuoteOpen(true)}
    >
      {quoteButtonText}
    </Button>
  );

  // Fixed set of tabs: the three sections always render (each with its own
  // empty state), so the tab strip no longer changes shape per product.
  const sectionTabs: { id: ProductDetailsSection; label: string }[] = [
    { id: "description", label: tf("product.description", "Description") },
    {
      id: "specifications",
      label: tf("product.specifications", "Specifications"),
    },
    { id: "reviews", label: tf("product.reviews", "Reviews") },
  ];

  // "full" stacks everything in one column and renders the gallery in its
  // classic bottom arrangement; "vertical" flips which column is sticky —
  // the media list scrolls while the buy box holds.
  const isFullWidthLayout = galleryLayout === "full";
  const isVerticalLayout = galleryLayout === "vertical";
  const galleryInternalLayout = isFullWidthLayout ? "bottom" : galleryLayout;

  /* "Sold by {seller}" line, shared by every buy-box design. The template is
     split around its placeholder so the seller name can carry emphasis and
     the link while translators keep control of word order. `cart.soldBy` is
     the phrase's existing home (the bag's per-seller group headers). */
  const renderSoldBy = () => {
    if (!soldByVendor) return null;
    const template = traw("cart.soldBy", "Sold by {seller}");
    const [beforeSeller, afterSeller = ""] = template.split("{seller}");
    return (
      <Link
        href={`/${locale}/vendors/${encodeURIComponent(soldByVendor.slug)}`}
        className="group/vendor flex w-fit max-w-full items-center gap-2 text-sm text-muted-foreground"
      >
        {soldByVendor.logo ? (
          <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded-full border border-border">
            <AppImage
              src={soldByVendor.logo}
              alt=""
              fill
              sizes="20px"
              className="object-cover"
            />
          </span>
        ) : (
          <Store className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 truncate">
          {beforeSeller}
          <span className="font-semibold text-foreground group-hover/vendor:underline">
            {soldByVendor.storeName}
          </span>
          {afterSeller}
        </span>
      </Link>
    );
  };

  // ── Minimal design rows (Figma 774:4992) ────────────────────────────────
  // The SAME computed values as the other appearances — price, stock,
  // preorder, variant and cart rules all come from the shared code above —
  // arranged as merchant-ordered rows. Groups come from the section's
  // "Order" setting; a hairline is drawn between groups.
  const minimalGroups =
    rowGroups && rowGroups.length > 0
      ? rowGroups
      : visibleProductDetailGroups(DEFAULT_PRODUCT_DETAIL_GROUPS);
  const { visibility: vis, style: sty } = detail;
  const typo = sty.typography;

  /* Accordion rows per the Figma: hairline-separated, title with a plus on
     the end edge that turns into an X when open — no boxed chrome. Native
     <details> so open state needs no React state. */
  const minimalAccordion = (title: string, content: React.ReactNode) => (
    <details className="group/acc py-4 first:pt-0 last:pb-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-medium text-foreground [&::-webkit-details-marker]:hidden">
        {title}
        <Plus
          className="h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-open/acc:rotate-45"
          aria-hidden
        />
      </summary>
      <div className="pt-3">{content}</div>
    </details>
  );

  const renderMinimalRow = (row: ProductDetailRow) => {
    switch (row) {
      case "breadcrumb":
        return (
          <nav
            aria-label={tf("common.breadcrumb", "Breadcrumb")}
            className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
            style={typographyCss(typo.category)}
          >
            <Link
              href={`/${locale}`}
              aria-label={t("common.home")}
              // A 14px icon is the whole link. The pseudo-element takes the
              // reach to ~30x22 without moving anything; it stops there
              // rather than at 44 because the breadcrumb's own items sit
              // 6px apart and overlapping hit areas mis-fire.
              className="relative transition-colors before:absolute before:-inset-x-1 before:-inset-y-2 before:content-[''] hover:text-foreground"
            >
              <Home className="h-3.5 w-3.5" />
            </Link>
            {product.category ? (
              <>
                <ChevronRight className="h-3 w-3 opacity-60" aria-hidden />
                <Link
                  href={`/${locale}/categories/${product.category.slug}`}
                  className="transition-colors hover:text-foreground"
                >
                  {product.category.name}
                </Link>
              </>
            ) : null}
            {product.brand?.name ? (
              <>
                <ChevronRight className="h-3 w-3 opacity-60" aria-hidden />
                <Link
                  href={`/${locale}/brands/${encodeURIComponent(product.brand.slug)}`}
                  className="transition-colors hover:text-foreground"
                >
                  {product.brand.name}
                </Link>
              </>
            ) : null}
          </nav>
        );
      case "brand":
        // Only the brand logo is shown here — never the brand name. When the
        // brand has no logo the row still reserves its height so the blocks
        // below it do not shift.
        if (!product.brand?.name) return null;
        return product.brand.logo ? (
          <Link
            href={`/${locale}/brands/${encodeURIComponent(product.brand.slug)}`}
            className="flex h-12 w-fit items-center hover:opacity-80"
            aria-label={product.brand.name}
          >
            <span className="relative h-12 w-56 shrink-0">
              <AppImage
                src={product.brand.logo}
                alt={product.brand.name}
                fill
                sizes="224px"
                className="object-contain object-left"
              />
            </span>
          </Link>
        ) : (
          <div className="h-12" aria-hidden />
        );
      case "title":
        return (
          <h1
            className="text-xl font-semibold tracking-tight text-foreground md:text-2xl"
            style={typographyCss(typo.product)}
          >
            {product.name}
          </h1>
        );
      case "vendor":
        return renderSoldBy();
      case "rating": {
        const starStyle = sty.ratingColor
          ? { color: sty.ratingColor, fill: sty.ratingColor }
          : undefined;
        return (
          <div className="flex flex-wrap items-center gap-2">
            {vis.ratingMinimized ? (
              <span className="flex items-center gap-1.5">
                <Star
                  className="h-4 w-4 fill-amber-500 text-amber-500"
                  style={starStyle}
                />
                <span className="text-sm font-semibold text-foreground">
                  {product.rating.toFixed(1)}
                </span>
              </span>
            ) : (
              <div className="flex items-center">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Star
                    key={`minimal-rating-star-${index}`}
                    className={cn(
                      "h-4 w-4",
                      index < Math.round(product.rating)
                        ? "fill-amber-500 text-amber-500"
                        : "fill-muted-foreground text-muted-foreground opacity-30",
                    )}
                    style={
                      index < Math.round(product.rating) ? starStyle : undefined
                    }
                  />
                ))}
              </div>
            )}
            {vis.ratingCount ? (
              <Link
                href="#reviews"
                className="relative text-xs font-medium text-muted-foreground before:absolute before:-inset-x-1 before:-inset-y-2 before:content-[''] hover:text-foreground"
              >
                ({product.reviewCount})
              </Link>
            ) : null}
            {vis.itemSold && (product.soldCount ?? 0) > 0 ? (
              <span className="border-s border-border ps-2.5 text-xs font-medium text-muted-foreground">
                {tf("product.itemsSold", "{count} sold", {
                  count: product.soldCount ?? 0,
                })}
              </span>
            ) : null}
            {vis.variantCount && product.variants.length > 1 ? (
              <span className="text-xs font-semibold text-sky-600">
                +{product.variants.length}
              </span>
            ) : null}
          </div>
        );
      }
      case "price":
        return (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-3">
              {quoteOnly ? (
                renderQuotePrice(
                  "text-2xl font-bold tracking-tight text-foreground",
                  typographyCss(typo.price),
                )
              ) : (
                <>
                  <span
                    className="text-2xl font-bold tracking-tight text-foreground"
                    style={typographyCss(typo.price)}
                  >
                    {formatDisplayPrice(displayedPrice)}
                  </span>
                  {displayedComparePrice &&
                  displayedComparePrice > displayedPrice ? (
                    <span
                      className="text-base font-medium text-muted-foreground line-through"
                      style={typographyCss(typo.discounted)}
                    >
                      {formatDisplayPrice(displayedComparePrice)}
                    </span>
                  ) : null}
                </>
              )}
              {vis.discountChip && discountPercentage > 0 ? (
                <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
                  {discountPercentage}% OFF
                </span>
              ) : null}
              <span
                className={cn(
                  "inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold",
                  preorderPurchase
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                    : availableStock > 0
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200"
                      : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200",
                )}
                style={{
                  ...(sty.stockBackground
                    ? { backgroundColor: sty.stockBackground }
                    : {}),
                  ...typographyCss(typo.stock),
                }}
              >
                {preorderPurchase
                  ? tf("product.preorder", "Pre-order")
                  : availableStock > 0
                    ? t("product.inStock")
                    : t("product.outOfStock")}
              </span>
            </div>
            {!preorderPurchase &&
            productTracksStock(product) &&
            currentStock > 0 &&
            currentStock < 10 ? (
              <p className="text-sm text-orange-600">
                {tf("product.lowStock", "Only {count} left in stock", {
                  count: currentStock,
                })}
              </p>
            ) : null}
            {collectionAtBranch ? (
              <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <Store
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="font-medium">
                    {tf("product.collectAt", "Collect at {branch}", {
                      branch: collectionAtBranch.branchName,
                    })}
                  </span>
                </span>
              </div>
            ) : null}
          </div>
        );
      case "variants":
        return optionEntries.length > 0 ? (
          <div className="divide-y divide-border">
            {optionEntries.map(({ opt, idx }) => (
              <div
                key={opt.name}
                // `justify-between` is the two-column design: it reads as a
                // label/value pair only while the column is narrow. Stacked, it
                // opened ~400px of dead space between "Color" and its swatches,
                // so below lg the values simply follow the label.
                className="flex flex-wrap items-center gap-x-4 gap-y-2.5 py-3.5 first:pt-0 last:pb-0 lg:justify-between lg:gap-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-foreground">
                    {normalizeOptionLabel(opt.name)}
                  </span>
                  {isSizeOption(opt.name) ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-sky-600 hover:text-sky-500"
                      onClick={() => setIsSizeGuideOpen(true)}
                    >
                      {t("product.sizeGuide")}
                    </button>
                  ) : null}
                </div>
                <OptionValueSelector
                  size="sm"
                  option={opt}
                  selectedValue={selectedOptions[idx]}
                  onSelect={(value) => {
                    const next = [...selectedOptions];
                    next[idx] = value;
                    setSelectedOptions(next);
                    setQuantity(1);
                  }}
                  resolveColor={(v) =>
                    getColorCode(
                      v.value,
                      v.colorCode ||
                        getVariantColorCodeForOptionValue({
                          product,
                          optionName: opt.name,
                          valueId: v._id,
                          value: v.value,
                        }),
                    )
                  }
                />
              </div>
            ))}
          </div>
        ) : null;
      case "quantity-cart":
        // Quote-only: no quantity stepper either. The number that matters is
        // the one the shopper types into the request form, and a stepper here
        // would be a second, silently ignored answer to the same question.
        if (quoteOnly) {
          return (
            <div className="space-y-3">
              {renderQuoteButton(
                "h-11 w-full rounded-[5px] text-sm font-bold",
              )}
            </div>
          );
        }
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex h-11 w-[100px] shrink-0 items-center justify-between rounded-md border border-foreground bg-background px-1">
                <button
                  type="button"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={quantity <= 1}
                  aria-label={tf(
                    "common.decreaseQuantity",
                    "Decrease quantity",
                  )}
                  className="inline-flex h-full w-8 items-center justify-center text-foreground transition hover:opacity-70 disabled:opacity-40"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="min-w-5 text-center text-sm font-bold text-foreground">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setQuantity(Math.min(maxPurchasableQuantity, quantity + 1))
                  }
                  disabled={quantity >= maxPurchasableQuantity}
                  aria-label={tf(
                    "common.increaseQuantity",
                    "Increase quantity",
                  )}
                  className="inline-flex h-full w-8 items-center justify-center text-foreground transition hover:opacity-70 disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <Button
                size="lg"
                className="h-11 min-w-[120px] flex-1 rounded-[5px] bg-foreground text-sm font-bold text-background hover:bg-foreground/90"
                style={{
                  ...(sty.cartBackground
                    ? { backgroundColor: sty.cartBackground }
                    : {}),
                  ...(sty.cartBorder && sty.cartBorderWidth > 0
                    ? {
                        borderColor: sty.cartBorder,
                        borderWidth: sty.cartBorderWidth,
                        borderStyle: "solid",
                      }
                    : {}),
                  borderRadius: sty.cartRadius,
                  ...typographyCss(typo.cart),
                }}
                onClick={handleAddToCart}
                disabled={
                  maxPurchasableQuantity <= 0 || isAddingToCart || isBuyingNow
                }
              >
                {preorderPurchase
                  ? tf("product.preorderNow", "Pre-order now")
                  : t("common.addToCart")}
              </Button>
              <Button
                size="lg"
                className="h-11 min-w-[120px] flex-1 rounded-md text-sm font-bold"
                onClick={handleBuyNow}
                disabled={
                  maxPurchasableQuantity <= 0 || isBuyingNow || isAddingToCart
                }
              >
                {preorderPurchase
                  ? tf("product.preorderCheckout", "Pre-order checkout")
                  : buyNowLabel}
              </Button>
            </div>
            {preorderPurchase ? (
              <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {preorderDateLabel
                      ? tf(
                          "product.preorderShips",
                          "Expected ship date: {date}",
                          {
                            date: preorderDateLabel,
                          },
                        )
                      : tf(
                          "product.preorderShipsSoon",
                          "Expected to ship soon",
                        )}
                  </p>
                  {Number.isFinite(preorderRemaining) ? (
                    <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-500/20 dark:text-blue-100">
                      {Math.max(0, preorderRemaining)} spots left
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-2 rounded-md bg-white/70 p-3 text-xs text-blue-900 dark:bg-blue-950/30 dark:text-blue-100 sm:grid-cols-2">
                  <div>
                    <span className="block text-blue-700/80 dark:text-blue-200/80">
                      Due today
                    </span>
                    <span className="font-semibold">
                      {formatPrice(preorderTerms.dueNow)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-blue-700/80 dark:text-blue-200/80">
                      Due before shipping
                    </span>
                    <span className="font-semibold">
                      {formatPrice(preorderTerms.dueLater)}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      case "description":
        // This row only holds the short summary — the full rich-text
        // description keeps its own "Description" section further down, so the
        // label here has to differ or the page reads two of the same heading.
        return minimalAccordion(
          tf("product.overview", "Overview"),
          <p className="text-sm leading-relaxed text-muted-foreground">
            {descriptionSummary ||
              tf("product.noDescription", "No description available.")}
          </p>,
        );
      case "details":
        return minimalAccordion(
          productInfoSectionTitle,
          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            {productInfoFields.map((field) => (
              <div
                key={`${field.label}-${field.value}`}
                className="grid grid-cols-[112px_1fr] gap-2"
              >
                <span className="font-medium text-foreground/80">
                  {field.label}:
                </span>
                {field.href ? (
                  <Link
                    href={field.href}
                    className="min-w-0 break-words underline underline-offset-4 hover:text-foreground"
                  >
                    {field.value}
                  </Link>
                ) : (
                  <span className="min-w-0 break-words">{field.value}</span>
                )}
              </div>
            ))}
          </div>,
        );
      case "faq":
        return minimalAccordion(
          tf("product.faq", "FAQ"),
          <p className="text-sm text-muted-foreground">
            {tf(
              "product.faqHint",
              "Common questions about this product will appear here.",
            )}
          </p>,
        );
      case "info-card": {
        // Both lines read the settings checkout and the return flow enforce
        // (see the `fulfillment` prop). A line with nothing true to say is
        // left out, and a card with no lines is not drawn at all.
        const delivery = fulfillment?.deliveryDays ?? null;
        const returns = fulfillment?.returns ?? null;
        if (!delivery && !returns) return null;

        // "within 4–7 days"; a window with one edge ("within 5 days") when
        // the rate names a single figure or only an upper bound.
        const deliveryText = delivery
          ? delivery.min > 0 && delivery.min < delivery.max
            ? tf(
                "product.deliveryRange",
                "Standard delivery within {min}–{max} days",
                { min: delivery.min, max: delivery.max },
              )
            : tf(
                "product.deliveryWithin",
                "Standard delivery within {days} days",
                { days: delivery.max },
              )
          : null;

        let returnsText: string | null = null;
        if (returns) {
          const values = {
            days: returns.windowDays,
            percent: returns.restockingFeePercent,
            fee: formatPrice(returns.returnShippingFee),
          };
          const restocking = returns.restockingFeePercent > 0;
          const shippingFee = returns.returnShippingFee > 0;
          returnsText =
            restocking && shippingFee
              ? tf(
                  "product.returnsWindowFees",
                  "Return within {days} days in original condition — {percent}% restocking fee and {fee} return shipping apply",
                  values,
                )
              : restocking
                ? tf(
                    "product.returnsWindowRestocking",
                    "Return within {days} days in original condition — a {percent}% restocking fee applies",
                    values,
                  )
                : shippingFee
                  ? tf(
                      "product.returnsWindowShippingFee",
                      "Return within {days} days in original condition — {fee} return shipping applies",
                      values,
                    )
                  : tf(
                      "product.returnsWindow",
                      "Return within {days} days in original condition for a full refund",
                      values,
                    );
        }

        const lineClassName =
          "flex items-center gap-3 py-3 text-sm text-foreground";
        const lineStyle = {
          paddingLeft: sty.cardPadding,
          paddingRight: sty.cardPadding,
        };
        return (
          <div
            className="divide-y divide-border rounded-xl border border-border"
            style={{
              borderRadius: sty.cardRadius,
              ...(sty.cardBackground
                ? { backgroundColor: sty.cardBackground }
                : {}),
              ...(sty.cardBorder ? { borderColor: sty.cardBorder } : {}),
              borderWidth: sty.cardBorderWidth,
            }}
          >
            {deliveryText ? (
              <div className={lineClassName} style={lineStyle}>
                <Truck className="h-5 w-5 shrink-0" aria-hidden />
                {deliveryText}
              </div>
            ) : null}
            {returnsText ? (
              <div className={lineClassName} style={lineStyle}>
                <PackageOpen className="h-5 w-5 shrink-0" aria-hidden />
                {returns?.policyPage ? (
                  <Link
                    href={`/${locale}/returns`}
                    className="underline-offset-4 hover:underline"
                  >
                    {returnsText}
                  </Link>
                ) : (
                  returnsText
                )}
              </div>
            ) : null}
          </div>
        );
      }
      case "share":
        // The Figma's two-row arrangement: a "Share" title, then the icons
        // as gray rounded tiles (the component's tile variant skips its own
        // inline label so the title is not said twice).
        return (
          <div className="space-y-2.5">
            <p className="text-sm font-semibold text-foreground">
              {/* `product.share` is a NAMESPACE (facebook/twitter/…), so the
                  heading must read its `label` leaf — `t.has` answers true
                  for the namespace itself and then renders the raw key. */}
              {tf("product.share.label", "Share")}
            </p>
            <ProductShareButtons
              productName={product.name}
              image={product.images?.[0]}
              variant="tile"
            />
          </div>
        );
      case "chat":
        return messaging ? (
          <div className="flex flex-wrap items-center gap-2">
            {messaging?.liveChatEnabled !== false ? (
              <StorefrontChatButton
                locale={locale}
                vendorId={directVendor?._id}
                vendorName={
                  directVendor?.storeName ||
                  tf("chat.storeSupport", "Store support")
                }
                product={{
                  id: product._id,
                  name: product.name,
                  variantId: selectedVariant?._id,
                  variantName: selectedVariant?.name,
                }}
                label={
                  directVendor
                    ? tf("chat.chatWithVendor", "Chat with vendor")
                    : tf("chat.chatWithStore", "Chat with store")
                }
              />
            ) : null}
            <VendorExternalChannels
              chatOnLabel={traw(
                "chat.externalChannels.chatOn",
                "Chat with {vendor} on {channel}",
              )}
              whatsappProductMessage={traw(
                "chat.externalChannels.whatsappProductMessage",
                "Hello {vendor}, I have a question about {product}.",
              )}
              whatsappStoreMessage={traw(
                "chat.externalChannels.whatsappStoreMessage",
                "Hello {vendor}, I have a question about your store.",
              )}
              settings={messaging}
              vendorName={
                directVendor?.storeName ||
                tf("chat.storeSupport", "Store support")
              }
              productName={product.name}
            />
          </div>
        ) : null;
      default:
        return null;
    }
  };

  /* A row can render nothing for a given product — `variants` on a product
     with no options is the everyday case. Its group wrapper still carried the
     hairline and the half-gap padding, so those products showed an empty
     bordered strip between the price and the cart row. Render the rows first
     and drop any group that came back with nothing in it, so the hairline and
     the gap leave together. Indexing after the filter is what keeps the
     first/last padding rules on the groups that actually appear. */
  const minimalRenderedGroups =
    appearance === "minimal"
      ? minimalGroups
          .map((keys) => ({
            keys,
            rows: keys.map((key) => ({ key, node: renderMinimalRow(key) })),
          }))
          .filter((group) => group.rows.some((row) => row.node != null))
      : [];

  return (
    <div className="space-y-14">
      <div
        className={cn(
          "grid grid-cols-1 gap-8",
          // The split used to wait for xl (1280): a 13" laptop at default
          // zoom never reached it, so 1024 rendered the phone layout — a
          // 992px-wide gallery with the price a full screen below it.
          !isFullWidthLayout && "lg:grid-cols-2 lg:gap-10 xl:gap-12",
        )}
      >
        {/* Sticky offset tracks the real header height (--storefront-header-height,
            published by store-header) instead of a hardcoded value that pushed the
            gallery below the buy box at scroll 0. Pinned from lg, where the
            two-column layout starts. */}
        <div
          className={cn(
            !isFullWidthLayout &&
              !isVerticalLayout &&
              "lg:sticky lg:top-[calc(var(--storefront-header-height,4rem)+1.5rem)] lg:self-start",
          )}
        >
          <ProductImageGallery
            media={displayMedia}
            productName={product.name}
            selectedIndex={selectedImage}
            onSelect={setSelectedImage}
            discountPercentage={
              appearance === "minimal" && !vis.discountChipOnImage
                ? 0
                : discountPercentage
            }
            layout={galleryInternalLayout}
            stageBackground={
              appearance === "minimal" && sty.previewBackground
                ? sty.previewBackground
                : undefined
            }
            stageHeight={
              appearance === "minimal" && sty.previewHeight > 0
                ? sty.previewHeight
                : undefined
            }
          />
        </div>

        <div
          className={cn(
            // Same cap the gallery carries (GALLERY_STACK_CLASS) so the two
            // read as one centred column while stacked, instead of a label
            // pinned left and its values flung 400px away at the right edge.
            !isFullWidthLayout && "mx-auto w-full max-w-xl lg:max-w-none",
            isVerticalLayout &&
              "lg:sticky lg:top-[calc(var(--storefront-header-height,4rem)+1.5rem)] lg:self-start",
          )}
        >
          {appearance === "minimal" ? (
            /* ── Minimal buy box (Figma 774:4992) ──────────────────────────
              Merchant-ordered rows from the section's "Order" setting. Every
              row reads the shared values computed above, so this design can
              never disagree with the others about price, stock, or
              purchasability. Hairlines are not between every pair of groups:
              per the Figma they sit ON TOP of the variants block, the cart
              row, and each accordion row — the heading, price, and info-card
              runs separate by whitespace alone. */
            <div>
              {minimalRenderedGroups.map(({ keys, rows }, groupIndex) => {
                // A group of nothing but accordions renders as one hairline
                // list (the Figma's Description / Technical Details / FAQ run)
                // instead of gap-spaced rows.
                const accordionsOnly = keys.every(
                  (key) =>
                    key === "description" || key === "details" || key === "faq",
                );
                const bordered =
                  groupIndex > 0 &&
                  (accordionsOnly ||
                    keys[0] === "variants" ||
                    keys[0] === "quantity-cart");
                return (
                  <div
                    key={`minimal-group-${groupIndex}`}
                    className={cn(
                      "flex flex-col",
                      bordered && "border-t border-border",
                    )}
                    style={{
                      paddingTop: groupIndex === 0 ? 0 : sty.groupGap / 2,
                      paddingBottom:
                        groupIndex === minimalRenderedGroups.length - 1
                          ? 0
                          : sty.groupGap / 2,
                      rowGap: accordionsOnly ? 0 : sty.itemGap,
                    }}
                  >
                    {accordionsOnly ? (
                      <div className="divide-y divide-border">
                        {rows.map(({ key, node }) => (
                          <Fragment key={key}>{node}</Fragment>
                        ))}
                      </div>
                    ) : (
                      rows.map(({ key, node }) => (
                        <Fragment key={key}>{node}</Fragment>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          ) : appearance === "electronics" ? (
            /* ── Electronics buy box (Figma 675:5021) ──────────────────────
              The SAME values the classic column below renders — every price,
              stock, preorder and variant rule is computed once above and read
              here through the closure, so the two designs can never disagree
              about what the product costs or whether it can be bought.

              What differs is rhythm: hairline-separated rows (`divide-y`
              collapses cleanly when a conditional row is absent), each option
              label sitting BESIDE its values instead of above them, and one
              dark full-width call to action. */
            <div className="divide-y divide-border">
              <div className="space-y-2.5 pb-5">
                {product.brand?.name ? (
                  product.brand.logo ? (
                    <Link
                      href={`/${locale}/brands/${encodeURIComponent(
                        product.brand.slug,
                      )}`}
                      className="flex h-12 w-fit items-center hover:opacity-80"
                      aria-label={product.brand.name}
                    >
                      <span className="relative h-12 w-56 shrink-0">
                        <AppImage
                          src={product.brand.logo}
                          alt={product.brand.name}
                          fill
                          sizes="224px"
                          className="object-contain object-left"
                        />
                      </span>
                    </Link>
                  ) : (
                    <div className="h-12" aria-hidden />
                  )
                ) : null}

                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  {product.name}
                </h1>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Star
                          key={`electronics-rating-star-${index}`}
                          className={cn(
                            "h-[18px] w-[18px]",
                            index < Math.round(product.rating)
                              ? "fill-amber-500 text-amber-500"
                              : "fill-muted-foreground text-muted-foreground opacity-30",
                          )}
                        />
                      ))}
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">
                      ({product.reviewCount})
                    </span>
                  </div>
                  <Link
                    href="#reviews"
                    className="border-s border-border ps-3 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {t("common.reviews")}
                  </Link>
                </div>

                {renderSoldBy()}
              </div>

              <div className="space-y-3 py-5">
                <div className="flex flex-wrap items-center gap-3">
                  {quoteOnly ? (
                    renderQuotePrice(
                      "text-3xl font-bold tracking-tight text-foreground",
                    )
                  ) : (
                    <>
                      <span className="text-3xl font-bold tracking-tight text-foreground">
                        {formatDisplayPrice(displayedPrice)}
                      </span>
                      {displayedComparePrice &&
                      displayedComparePrice > displayedPrice ? (
                        <span className="text-base font-medium text-muted-foreground line-through">
                          {formatDisplayPrice(displayedComparePrice)}
                        </span>
                      ) : null}
                    </>
                  )}
                  <span
                    className={cn(
                      "inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold",
                      preorderPurchase
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                        : availableStock > 0
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200"
                          : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200",
                    )}
                  >
                    {preorderPurchase
                      ? tf("product.preorder", "Pre-order")
                      : availableStock > 0
                        ? t("product.inStock")
                        : t("product.outOfStock")}
                  </span>
                </div>

                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  {product.shortDescription ||
                    tf("product.noDescription", "No description available.")}
                </p>

                {collectionAtBranch ? (
                  <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                    <Store
                      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="font-medium">
                        {tf("product.collectAt", "Collect at {branch}", {
                          branch: collectionAtBranch.branchName,
                        })}
                      </span>
                      {collectionAtBranch.pickupArea ||
                      typeof collectionAtBranch.distanceKm === "number" ? (
                        <span className="block text-xs text-muted-foreground">
                          {[
                            collectionAtBranch.pickupArea,
                            typeof collectionAtBranch.distanceKm === "number"
                              ? t("location.kmAway", {
                                  km: Math.max(
                                    1,
                                    Math.round(collectionAtBranch.distanceKm),
                                  ),
                                })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ) : null}

                {product.digitalAssets?.length ||
                product.digitalPreview?.url ? (
                  <div className="flex flex-wrap items-center gap-3">
                    {(product.digitalAssets?.length ?? 0) > 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                        <FileDown className="h-3.5 w-3.5" />
                        {tf(
                          "product.digitalDownloadNote",
                          "Instant download · {count} file(s)",
                          { count: product.digitalAssets?.length ?? 0 },
                        )}
                      </span>
                    ) : null}
                    {product.digitalPreview?.url ? (
                      <a
                        href={product.digitalPreview.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-600 hover:text-sky-500"
                      >
                        <BookOpen className="h-4 w-4" />
                        {tf("product.readSample", "Read a sample")}
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* One row per option: label on the start edge, values on the end
                edge. `flex-wrap` lets a long value list drop under its label
                instead of squeezing the pills. */}
              {optionEntries.map(({ opt, idx }) => (
                <div
                  key={opt.name}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-base font-semibold text-foreground">
                      {normalizeOptionLabel(opt.name)}
                    </span>
                    {isSizeOption(opt.name) ? (
                      <button
                        type="button"
                        className="text-xs font-medium text-sky-600 hover:text-sky-500"
                        onClick={() => setIsSizeGuideOpen(true)}
                      >
                        {t("product.sizeGuide")}
                      </button>
                    ) : null}
                  </div>
                  <OptionValueSelector
                    size="sm"
                    option={opt}
                    selectedValue={selectedOptions[idx]}
                    onSelect={(value) => {
                      const next = [...selectedOptions];
                      next[idx] = value;
                      setSelectedOptions(next);
                      setQuantity(1);
                    }}
                    resolveColor={(v) =>
                      getColorCode(
                        v.value,
                        v.colorCode ||
                          getVariantColorCodeForOptionValue({
                            product,
                            optionName: opt.name,
                            valueId: v._id,
                            value: v.value,
                          }),
                      )
                    }
                  />
                </div>
              ))}

              <div className="space-y-3 py-5">
                {quoteOnly ? (
                  renderQuoteButton(
                    "h-[52px] w-full rounded-md text-sm font-bold",
                  )
                ) : (
                <>
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex h-[52px] w-[117px] shrink-0 items-center justify-between rounded-md border border-foreground bg-background px-1">
                    <button
                      type="button"
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      disabled={quantity <= 1}
                      aria-label={tf(
                        "common.decreaseQuantity",
                        "Decrease quantity",
                      )}
                      className="inline-flex h-full w-9 items-center justify-center text-foreground transition hover:opacity-70 disabled:opacity-40"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="min-w-6 text-center text-base font-bold text-foreground">
                      {quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setQuantity(
                          Math.min(maxPurchasableQuantity, quantity + 1),
                        )
                      }
                      disabled={quantity >= maxPurchasableQuantity}
                      aria-label={tf(
                        "common.increaseQuantity",
                        "Increase quantity",
                      )}
                      className="inline-flex h-full w-9 items-center justify-center text-foreground transition hover:opacity-70 disabled:opacity-40"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <Button
                    size="lg"
                    className="h-[52px] flex-1 min-w-[180px] rounded-md bg-foreground text-sm font-bold text-background hover:bg-foreground/90"
                    onClick={handleAddToCart}
                    disabled={
                      maxPurchasableQuantity <= 0 ||
                      isAddingToCart ||
                      isBuyingNow
                    }
                  >
                    <ShoppingBag className="mr-2 h-4 w-4" />
                    {preorderPurchase
                      ? tf("product.preorderNow", "Pre-order now")
                      : t("common.addToCart")}
                  </Button>
                </div>
                {/* The design shows one CTA; Buy Now stays because removing a
                  checkout path is a commerce change, not a restyle. */}
                <Button
                  size="lg"
                  variant="outline"
                  className="h-[52px] w-full rounded-md border-foreground text-sm font-bold"
                  onClick={handleBuyNow}
                  disabled={
                    maxPurchasableQuantity <= 0 || isBuyingNow || isAddingToCart
                  }
                >
                  {preorderPurchase
                    ? tf("product.preorderCheckout", "Pre-order checkout")
                    : buyNowLabel}
                </Button>
                </>
                )}

                {preorderPurchase ? (
                  <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">
                        {preorderDateLabel
                          ? tf(
                              "product.preorderShips",
                              "Expected ship date: {date}",
                              { date: preorderDateLabel },
                            )
                          : tf(
                              "product.preorderShipsSoon",
                              "Expected to ship soon",
                            )}
                      </p>
                      {Number.isFinite(preorderRemaining) ? (
                        <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-500/20 dark:text-blue-100">
                          {Math.max(0, preorderRemaining)} spots left
                        </span>
                      ) : null}
                    </div>
                    {preorderLimit > 0 ? (
                      <div className="space-y-1.5">
                        <div className="h-2 overflow-hidden rounded-full bg-blue-200/70 dark:bg-blue-950">
                          <div
                            className="h-full rounded-full bg-blue-600"
                            style={{ width: `${preorderProgress}%` }}
                          />
                        </div>
                        <p className="text-xs text-blue-800/80 dark:text-blue-100/75">
                          {preorderReserved} of {preorderLimit} reservations
                          claimed
                        </p>
                      </div>
                    ) : null}
                    <div className="grid gap-2 rounded-md bg-white/70 p-3 text-xs text-blue-900 dark:bg-blue-950/30 dark:text-blue-100 sm:grid-cols-2">
                      <div>
                        <span className="block text-blue-700/80 dark:text-blue-200/80">
                          Due today
                        </span>
                        <span className="font-semibold">
                          {formatPrice(preorderTerms.dueNow)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-blue-700/80 dark:text-blue-200/80">
                          Due before shipping
                        </span>
                        <span className="font-semibold">
                          {formatPrice(preorderTerms.dueLater)}
                        </span>
                      </div>
                    </div>
                    {selectedPreorder?.batchName ? (
                      <p className="text-xs font-medium">
                        Batch: {selectedPreorder.batchName}
                      </p>
                    ) : null}
                    {selectedPreorder?.message ? (
                      <p>{selectedPreorder.message}</p>
                    ) : null}
                  </div>
                ) : null}

                {!preorderPurchase &&
                productTracksStock(product) &&
                currentStock > 0 &&
                currentStock < 10 ? (
                  <p className="text-sm text-orange-600">
                    {tf("product.lowStock", "Only {count} left in stock", {
                      count: currentStock,
                    })}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2 py-4">
                <ProductCollapsibleSection title={productInfoSectionTitle}>
                  <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    {productInfoFields.map((field) => (
                      <div
                        key={`${field.label}-${field.value}`}
                        className="grid grid-cols-[112px_1fr] gap-2"
                      >
                        <span className="font-medium text-foreground/80">
                          {field.label}:
                        </span>
                        {field.href ? (
                          <Link
                            href={field.href}
                            className="min-w-0 break-words underline underline-offset-4 hover:text-foreground"
                          >
                            {field.value}
                          </Link>
                        ) : (
                          <span className="min-w-0 break-words">
                            {field.value}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </ProductCollapsibleSection>
                <ProductCollapsibleSection title={tf("product.faq", "FAQ")}>
                  <p className="text-sm text-muted-foreground">
                    {tf(
                      "product.faqHint",
                      "Common questions about this product will appear here.",
                    )}
                  </p>
                </ProductCollapsibleSection>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-5">
                <div className="flex flex-wrap items-center gap-2">
                  {messaging?.liveChatEnabled !== false ? (
                    <StorefrontChatButton
                      locale={locale}
                      vendorId={directVendor?._id}
                      vendorName={
                        directVendor?.storeName ||
                        tf("chat.storeSupport", "Store support")
                      }
                      product={{
                        id: product._id,
                        name: product.name,
                        variantId: selectedVariant?._id,
                        variantName: selectedVariant?.name,
                      }}
                      label={
                        directVendor
                          ? tf("chat.chatWithVendor", "Chat with vendor")
                          : tf("chat.chatWithStore", "Chat with store")
                      }
                    />
                  ) : null}
                  {messaging ? (
                    <VendorExternalChannels
                      chatOnLabel={traw(
                        "chat.externalChannels.chatOn",
                        "Chat with {vendor} on {channel}",
                      )}
                      whatsappProductMessage={traw(
                        "chat.externalChannels.whatsappProductMessage",
                        "Hello {vendor}, I have a question about {product}.",
                      )}
                      whatsappStoreMessage={traw(
                        "chat.externalChannels.whatsappStoreMessage",
                        "Hello {vendor}, I have a question about your store.",
                      )}
                      settings={messaging}
                      vendorName={
                        directVendor?.storeName ||
                        tf("chat.storeSupport", "Store support")
                      }
                      productName={product.name}
                    />
                  ) : null}
                </div>
                <ProductShareButtons
                  productName={product.name}
                  image={product.images?.[0]}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="space-y-4">
                {/* <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Link href={`/${locale}`} className="hover:text-foreground">
                  {t("common.home")}
                </Link>
                <span>/</span>
                {product.category ? (
                  <Link
                    href={`/${locale}/categories/${product.category.slug}`}
                    className="hover:text-foreground"
                  >
                    {product.category.name}
                  </Link>
                ) : (
                  <span>{t("common.products")}</span>
                )}
                <span>/</span>
                <span className="text-foreground">{product.name}</span>
              </div> */}

                {product.brand?.name ? (
                  product.brand.logo ? (
                    <Link
                      href={`/${locale}/brands/${encodeURIComponent(
                        product.brand.slug,
                      )}`}
                      className="flex h-12 w-fit items-center hover:opacity-80"
                      aria-label={product.brand.name}
                    >
                      <span className="relative h-12 w-56 shrink-0">
                        <AppImage
                          src={product.brand.logo}
                          alt={product.brand.name}
                          fill
                          sizes="224px"
                          className="object-contain object-left"
                        />
                      </span>
                    </Link>
                  ) : (
                    <div className="h-12" aria-hidden />
                  )
                ) : null}

                <h1 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl xl:text-3xl xl:leading-[1.05]">
                  {product.name}
                </h1>
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: 5 }).map((_, index) => {
                    const isFilled = index < Math.round(product.rating);
                    return (
                      <Star
                        key={`rating-star-${index}`}
                        className={cn(
                          "h-4 w-4",
                          isFilled
                            ? "fill-amber-500 text-amber-500"
                            : "fill-muted-foreground text-muted-foreground opacity-30",
                        )}
                      />
                    );
                  })}
                  <Link
                    href="#reviews"
                    className="ml-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    ({product.reviewCount} {t("common.reviews")})
                  </Link>
                </div>
                {renderSoldBy()}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-end gap-2">
                      {quoteOnly ? (
                        renderQuotePrice(
                          "text-xl font-semibold leading-none text-foreground",
                        )
                      ) : (
                        <>
                          <span className="text-xl font-semibold leading-none text-foreground">
                            {formatDisplayPrice(displayedPrice)}
                          </span>
                          {displayedComparePrice &&
                            displayedComparePrice > displayedPrice && (
                              <span className="text-base font-medium leading-none text-muted-foreground line-through">
                                {formatDisplayPrice(displayedComparePrice)}
                              </span>
                            )}
                        </>
                      )}
                    </div>

                    <div
                      className={cn(
                        "inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold",
                        preorderPurchase
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                          : availableStock > 0
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200"
                            : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200",
                      )}
                    >
                      {preorderPurchase
                        ? tf("product.preorder", "Pre-order")
                        : availableStock > 0
                          ? t("product.inStock")
                          : t("product.outOfStock")}
                    </div>
                  </div>
                </div>

                {/* Collection, when the shopper has told us where they are and a
                  branch in range actually holds this. Withdrawn the moment
                  they switch to a variant that branch does not have, because
                  the whole value of the line is that it is specific. */}
                {collectionAtBranch ? (
                  <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                    <Store
                      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="font-medium">
                        {tf("product.collectAt", "Collect at {branch}", {
                          branch: collectionAtBranch.branchName,
                        })}
                      </span>
                      {collectionAtBranch.pickupArea ||
                      typeof collectionAtBranch.distanceKm === "number" ? (
                        <span className="block text-xs text-muted-foreground">
                          {[
                            collectionAtBranch.pickupArea,
                            typeof collectionAtBranch.distanceKm === "number"
                              ? t("location.kmAway", {
                                  km: Math.max(
                                    1,
                                    Math.round(collectionAtBranch.distanceKm),
                                  ),
                                })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ) : null}

                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  {product.shortDescription ||
                    tf("product.noDescription", "No description available.")}
                </p>

                {/* Digital product: instant-download note + public sample */}
                {(product.digitalAssets?.length ||
                  product.digitalPreview?.url) && (
                  <div className="flex flex-wrap items-center gap-3">
                    {(product.digitalAssets?.length ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                        <FileDown className="h-3.5 w-3.5" />
                        {tf(
                          "product.digitalDownloadNote",
                          "Instant download · {count} file(s)",
                          { count: product.digitalAssets?.length ?? 0 },
                        )}
                      </span>
                    )}
                    {product.digitalPreview?.url && (
                      <a
                        href={product.digitalPreview.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-600 hover:text-sky-500"
                      >
                        <BookOpen className="h-4 w-4" />
                        {tf("product.readSample", "Read a sample")}
                      </a>
                    )}
                  </div>
                )}
              </div>

              {optionEntries.length > 0 && (
                <div className="space-y-4 xl:space-y-6">
                  {optionEntries.map(({ opt, idx }) => {
                    const isSize = isSizeOption(opt.name);
                    return (
                      <div key={opt.name} className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium text-foreground">
                            {normalizeOptionLabel(opt.name)}
                          </div>
                          {isSize && (
                            <button
                              type="button"
                              className="text-xs font-medium text-sky-600 hover:text-sky-500"
                              onClick={() => setIsSizeGuideOpen(true)}
                            >
                              {t("product.sizeGuide")}
                            </button>
                          )}
                        </div>

                        <OptionValueSelector
                          size="sm"
                          option={opt}
                          selectedValue={selectedOptions[idx]}
                          onSelect={(value) => {
                            const next = [...selectedOptions];
                            next[idx] = value;
                            setSelectedOptions(next);
                            setQuantity(1);
                          }}
                          resolveColor={(v) =>
                            getColorCode(
                              v.value,
                              v.colorCode ||
                                getVariantColorCodeForOptionValue({
                                  product,
                                  optionName: opt.name,
                                  valueId: v._id,
                                  value: v.value,
                                }),
                            )
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {quoteOnly ? (
                renderQuoteButton(
                  "h-12 w-full rounded-sm px-4 text-sm font-semibold sm:px-5 sm:text-base",
                )
              ) : (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-12 items-center overflow-hidden rounded-xl border border-border bg-muted">
                  <button
                    type="button"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    disabled={quantity <= 1}
                    className="inline-flex h-full w-12 items-center justify-center bg-muted text-muted-foreground transition hover:bg-muted/80 disabled:opacity-50"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="inline-flex h-full w-16 items-center justify-center border-x border-border bg-muted/80 text-center text-[23px] font-normal leading-none text-foreground">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setQuantity(
                        Math.min(maxPurchasableQuantity, quantity + 1),
                      )
                    }
                    disabled={quantity >= maxPurchasableQuantity}
                    className="inline-flex h-full w-12 items-center justify-center bg-muted text-foreground/80 transition hover:bg-muted/80 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex flex-1 min-w-[260px] flex-wrap items-center gap-3">
                  <Button
                    size="lg"
                    className="h-12 flex-1 rounded-sm bg-foreground px-4 text-sm font-semibold text-background hover:bg-foreground/90 sm:px-5 sm:text-base"
                    onClick={handleAddToCart}
                    disabled={
                      maxPurchasableQuantity <= 0 ||
                      isAddingToCart ||
                      isBuyingNow
                    }
                  >
                    <ShoppingBag className="mr-2 h-4 w-4" />
                    {preorderPurchase
                      ? tf("product.preorderNow", "Pre-order now")
                      : t("common.addToCart")}
                  </Button>
                  <Button
                    size="lg"
                    className="h-12 flex-1 rounded-sm bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:px-5 sm:text-base"
                    onClick={handleBuyNow}
                    disabled={
                      maxPurchasableQuantity <= 0 ||
                      isBuyingNow ||
                      isAddingToCart
                    }
                  >
                    {preorderPurchase
                      ? tf("product.preorderCheckout", "Pre-order checkout")
                      : buyNowLabel}
                  </Button>
                </div>
              </div>
              )}

              {/* Secondary actions on one line: chat/messaging on the start edge,
                sharing pushed to the end. Demoted below the CTAs so chat never
                competes with Add to Cart / Buy Now for the primary click. */}
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pt-8">
                <div className="flex flex-wrap items-center gap-2">
                  {messaging?.liveChatEnabled !== false ? (
                    <StorefrontChatButton
                      locale={locale}
                      vendorId={directVendor?._id}
                      vendorName={
                        directVendor?.storeName ||
                        tf("chat.storeSupport", "Store support")
                      }
                      product={{
                        id: product._id,
                        name: product.name,
                        variantId: selectedVariant?._id,
                        variantName: selectedVariant?.name,
                      }}
                      label={
                        directVendor
                          ? tf("chat.chatWithVendor", "Chat with vendor")
                          : tf("chat.chatWithStore", "Chat with store")
                      }
                    />
                  ) : null}
                  {messaging ? (
                    <VendorExternalChannels
                      // raw(): the messages keep their {vendor}/{channel}/{product}
                      // placeholders for VendorExternalChannels to substitute, since
                      // only that component knows the values.
                      chatOnLabel={traw(
                        "chat.externalChannels.chatOn",
                        "Chat with {vendor} on {channel}",
                      )}
                      whatsappProductMessage={traw(
                        "chat.externalChannels.whatsappProductMessage",
                        "Hello {vendor}, I have a question about {product}.",
                      )}
                      whatsappStoreMessage={traw(
                        "chat.externalChannels.whatsappStoreMessage",
                        "Hello {vendor}, I have a question about your store.",
                      )}
                      settings={messaging}
                      vendorName={
                        directVendor?.storeName ||
                        tf("chat.storeSupport", "Store support")
                      }
                      productName={product.name}
                    />
                  ) : null}
                </div>

                <ProductShareButtons
                  productName={product.name}
                  image={product.images?.[0]}
                />
              </div>

              {preorderPurchase && (
                <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">
                      {preorderDateLabel
                        ? tf(
                            "product.preorderShips",
                            "Expected ship date: {date}",
                            {
                              date: preorderDateLabel,
                            },
                          )
                        : tf(
                            "product.preorderShipsSoon",
                            "Expected to ship soon",
                          )}
                    </p>
                    {Number.isFinite(preorderRemaining) ? (
                      <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-500/20 dark:text-blue-100">
                        {Math.max(0, preorderRemaining)} spots left
                      </span>
                    ) : null}
                  </div>

                  {preorderLimit > 0 ? (
                    <div className="space-y-1.5">
                      <div className="h-2 overflow-hidden rounded-full bg-blue-200/70 dark:bg-blue-950">
                        <div
                          className="h-full rounded-full bg-blue-600"
                          style={{ width: `${preorderProgress}%` }}
                        />
                      </div>
                      <p className="text-xs text-blue-800/80 dark:text-blue-100/75">
                        {preorderReserved} of {preorderLimit} reservations
                        claimed
                      </p>
                    </div>
                  ) : null}

                  <div className="grid gap-2 rounded-md bg-white/70 p-3 text-xs text-blue-900 dark:bg-blue-950/30 dark:text-blue-100 sm:grid-cols-2">
                    <div>
                      <span className="block text-blue-700/80 dark:text-blue-200/80">
                        Due today
                      </span>
                      <span className="font-semibold">
                        {formatPrice(preorderTerms.dueNow)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-blue-700/80 dark:text-blue-200/80">
                        Due before shipping
                      </span>
                      <span className="font-semibold">
                        {formatPrice(preorderTerms.dueLater)}
                      </span>
                    </div>
                  </div>

                  {selectedPreorder?.batchName ? (
                    <p className="text-xs font-medium">
                      Batch: {selectedPreorder.batchName}
                    </p>
                  ) : null}
                  {selectedPreorder?.message ? (
                    <p>{selectedPreorder.message}</p>
                  ) : null}
                </div>
              )}

              {/* Scarcity only means something when the count is a real limit. */}
              {!preorderPurchase &&
                productTracksStock(product) &&
                currentStock > 0 &&
                currentStock < 10 && (
                  <p className="text-sm text-orange-600">
                    {tf("product.lowStock", "Only {count} left in stock", {
                      count: currentStock,
                    })}
                  </p>
                )}

              <div className="h-px w-full bg-border/80" />

              <div className="space-y-2">
                <ProductCollapsibleSection title={productInfoSectionTitle}>
                  <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    {productInfoFields.map((field) => (
                      <div
                        key={`${field.label}-${field.value}`}
                        className="grid grid-cols-[112px_1fr] gap-2"
                      >
                        <span className="font-medium text-foreground/80">
                          {field.label}:
                        </span>
                        {field.href ? (
                          <Link
                            href={field.href}
                            className="min-w-0 break-words underline underline-offset-4 hover:text-foreground"
                          >
                            {field.value}
                          </Link>
                        ) : (
                          <span className="min-w-0 break-words">
                            {field.value}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </ProductCollapsibleSection>

                <ProductCollapsibleSection title={tf("product.faq", "FAQ")}>
                  <p className="text-sm text-muted-foreground">
                    {tf(
                      "product.faqHint",
                      "Common questions about this product will appear here.",
                    )}
                  </p>
                </ProductCollapsibleSection>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* The sticky product bar (Figma 697:65). It sits after the hero and
          rides the page down, carrying the buy box's own quantity and
          handlers — which is why it lives here rather than in a section of
          its own: a second component would need a second copy of that
          state and the two could disagree. It replaces the classic tab
          strip below, so only one of the two ever renders. */}
      {appearance === "electronics" ? (
        <div className="sticky top-[var(--storefront-header-height,4rem)] z-30 -mx-4 border-b border-border bg-background/90 px-4 backdrop-blur-xl">
          <div className="flex items-center gap-4 py-3">
            <span className="relative hidden h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted sm:block">
              <AppImage
                src={firstImageUrl(displayMedia, product.images)}
                alt=""
                fill
                sizes="56px"
                className="object-contain"
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold text-foreground">
                {product.name}
              </span>
            </span>

            {/* Same targets as the classic tab strip — one scroll spy, one
                set of ids, whichever chrome is on screen. */}
            <nav className="hidden items-center gap-8 lg:flex">
              {sectionTabs.map(({ id, label }) => (
                <button
                  key={`sticky-${id}`}
                  type="button"
                  onClick={() => scrollToSection(id)}
                  className={cn(
                    "text-xs font-semibold transition-colors",
                    activeSection === id
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </nav>

            {quoteOnly
              ? renderQuotePrice(
                  "hidden text-base font-bold text-foreground sm:block",
                )
              : (
                <span className="hidden text-base font-bold text-foreground sm:block">
                  {formatDisplayPrice(displayedPrice)}
                </span>
              )}

            <span className="flex shrink-0 items-center gap-1.5">
              {quoteOnly ? (
                renderQuoteButton("h-9 rounded-md px-4 text-xs font-bold")
              ) : (
              <>
              <span className="hidden h-9 items-center justify-between rounded-md border border-foreground px-1 sm:flex">
                <button
                  type="button"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={quantity <= 1}
                  aria-label={tf(
                    "common.decreaseQuantity",
                    "Decrease quantity",
                  )}
                  className="inline-flex h-full w-7 items-center justify-center text-foreground transition hover:opacity-70 disabled:opacity-40"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-5 text-center text-sm font-bold text-foreground">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setQuantity(Math.min(maxPurchasableQuantity, quantity + 1))
                  }
                  disabled={quantity >= maxPurchasableQuantity}
                  aria-label={tf(
                    "common.increaseQuantity",
                    "Increase quantity",
                  )}
                  className="inline-flex h-full w-7 items-center justify-center text-foreground transition hover:opacity-70 disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </span>
              <Button
                size="sm"
                className="h-9 rounded-md bg-foreground px-4 text-xs font-bold text-background hover:bg-foreground/90"
                onClick={handleAddToCart}
                disabled={
                  maxPurchasableQuantity <= 0 || isAddingToCart || isBuyingNow
                }
              >
                {preorderPurchase
                  ? tf("product.preorderNow", "Pre-order now")
                  : t("common.addToCart")}
              </Button>
              </>
              )}
            </span>
          </div>
        </div>
      ) : null}

      {isSizeGuideOpen && (
        <ProductSizeGuide
          product={product}
          onClose={() => setIsSizeGuideOpen(false)}
        />
      )}

      {/* Mounted once for the whole page, whichever buy box opened it — every
          design's quote button drives the same dialog. */}
      {quoteOnly ? (
        <QuoteRequestDialog
          open={isQuoteOpen}
          onOpenChange={setIsQuoteOpen}
          target={{
            productId: product._id,
            productName: product.name,
            variantId: selectedVariant?._id,
            variantName: selectedVariant?.name,
            quantity,
          }}
        />
      ) : null}

      <section className="py-8">
        {appearance === "minimal" ? (
          <>
            {/* The home slot: where the strip lives un-pinned, and the
                height placeholder while the strip rides fixed. The pinned
                strip shrinks a step and the product (left) and price/CTA
                (right) slide in; scrolling back up reverses it. It slides
                away once the reviews section ends (see the effect above). */}
            <div ref={tabsHomeRef} className="mb-8">
              <div
                ref={tabsBarRef}
                className={cn(
                  "z-30 -mx-4 border-b border-border bg-background/95 px-4 backdrop-blur-xl transition-[transform,opacity] duration-300",
                  tabsReleased &&
                    "pointer-events-none -translate-y-full opacity-0",
                )}
              >
                <div
                  className={cn(
                    "flex items-center gap-3 transition-[padding] duration-300",
                    tabsStuck ? "py-2" : "py-4",
                  )}
                >
                  <div
                    inert={!tabsStuck}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-3 transition-all duration-300",
                      tabsStuck
                        ? "translate-x-0 opacity-100"
                        : "pointer-events-none -translate-x-3 opacity-0",
                    )}
                  >
                    <span className="relative hidden h-11 w-11 shrink-0 overflow-hidden rounded-md bg-muted sm:block">
                      <AppImage
                        src={firstImageUrl(displayMedia, product.images)}
                        alt=""
                        fill
                        sizes="44px"
                        className="object-contain"
                      />
                    </span>
                    <span className="hidden min-w-0 truncate text-sm font-semibold text-foreground md:block">
                      {product.name}
                    </span>
                  </div>

                  <nav
                    className={cn(
                      "flex shrink-0 items-center justify-center gap-6 font-semibold transition-all duration-300 sm:gap-10",
                      tabsStuck ? "text-xs" : "text-sm",
                    )}
                  >
                    {sectionTabs.map(({ id, label }) => (
                      <button
                        key={`minimal-tab-${id}`}
                        type="button"
                        onClick={() => scrollToSection(id)}
                        className={cn(
                          "transition-colors",
                          activeSection === id
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {label}
                        {id === "reviews" && (product.reviewCount ?? 0) > 0
                          ? ` (${product.reviewCount})`
                          : ""}
                      </button>
                    ))}
                  </nav>

                  <div
                    inert={!tabsStuck}
                    className={cn(
                      "flex min-w-0 flex-1 items-center justify-end gap-2.5 transition-all duration-300",
                      tabsStuck
                        ? "translate-x-0 opacity-100"
                        : "pointer-events-none translate-x-3 opacity-0",
                    )}
                  >
                    {quoteOnly
                      ? renderQuotePrice(
                          "hidden text-base font-bold text-foreground sm:block",
                        )
                      : (
                        <span className="hidden text-base font-bold text-foreground sm:block">
                          {formatDisplayPrice(displayedPrice)}
                        </span>
                      )}
                    {quoteOnly ? (
                      renderQuoteButton(
                        "hidden h-9 rounded-md px-4 text-xs font-bold sm:inline-flex",
                      )
                    ) : (
                    <>
                    <span className="hidden h-9 items-center justify-between rounded-md border border-foreground px-1 lg:flex">
                      <button
                        type="button"
                        onClick={() => setQuantity(Math.max(1, quantity - 1))}
                        disabled={quantity <= 1}
                        aria-label={tf(
                          "common.decreaseQuantity",
                          "Decrease quantity",
                        )}
                        className="inline-flex h-full w-7 items-center justify-center text-foreground transition hover:opacity-70 disabled:opacity-40"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="min-w-5 text-center text-sm font-bold text-foreground">
                        {quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setQuantity(
                            Math.min(maxPurchasableQuantity, quantity + 1),
                          )
                        }
                        disabled={quantity >= maxPurchasableQuantity}
                        aria-label={tf(
                          "common.increaseQuantity",
                          "Increase quantity",
                        )}
                        className="inline-flex h-full w-7 items-center justify-center text-foreground transition hover:opacity-70 disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </span>
                    <Button
                      size="sm"
                      className="hidden h-9 rounded-md bg-foreground px-4 text-xs font-bold text-background hover:bg-foreground/90 sm:inline-flex"
                      onClick={handleAddToCart}
                      disabled={
                        maxPurchasableQuantity <= 0 ||
                        isAddingToCart ||
                        isBuyingNow
                      }
                    >
                      {preorderPurchase
                        ? tf("product.preorderNow", "Pre-order now")
                        : t("common.addToCart")}
                    </Button>
                    </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : appearance === "electronics" ? null : (
          <div className="mb-8 flex flex-wrap items-center border-b border-border">
            {sectionTabs.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => scrollToSection(id)}
                className={cn(
                  "relative -mb-px inline-flex h-12 items-center gap-1.5 border-b-2 px-4 text-sm font-medium transition-colors",
                  activeSection === id
                    ? "border-blue-600 bg-blue-50 text-blue-600 dark:border-blue-400 dark:bg-blue-950/30 dark:text-blue-400"
                    : "border-transparent text-foreground hover:bg-muted/60 hover:text-blue-600 dark:hover:text-blue-400",
                )}
              >
                <span>{label}</span>
                {/* The tab itself is always present; the count pill is not
                  worth rendering as a bare "0". */}
                {id === "reviews" && (product.reviewCount ?? 0) > 0 && (
                  <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-zinc-300 px-2 py-0.5 text-xs font-semibold leading-none text-white dark:bg-zinc-600">
                    {product.reviewCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="max-w-4xl space-y-8 text-sm leading-7 text-muted-foreground">
          <div
            ref={descriptionRef}
            data-section="description"
            className="scroll-mt-24"
          >
            <h3 className="mb-4 text-xl font-semibold text-foreground">
              {tf("product.description", "Description")}
            </h3>
            {hasDescription ? (
              <div
                className="rich-text-content max-w-none text-muted-foreground [&_img]:h-auto [&_img]:max-h-[640px] [&_img]:w-auto [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-border [&_img]:object-contain"
                // Already sanitized by getStorefrontProductBySlug on the
                // server — see lib/products/storefront-product-detail.ts.
                dangerouslySetInnerHTML={{ __html: product.description }}
              />
            ) : (
              <p>{tf("product.noDescription", "No description available.")}</p>
            )}
          </div>

          {/* Electronics moves the table onto the page as its own
              `product-specification` section — and any template carrying
              that section makes this copy stand down the same way. */}
          {appearance === "electronics" || standaloneSpecs ? null : (
            <div
              ref={specificationsRef}
              data-section="specifications"
              className="scroll-mt-24"
            >
              <h3 className="mb-4 text-xl font-semibold text-foreground">
                {tf("product.specifications", "Specifications")}
              </h3>
              {hasSpecifications ? (
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-border">
                      {product.attributes.map((attr, index) => (
                        <tr key={`${attr.name}-${index}`}>
                          <th
                            scope="row"
                            className="w-1/3 bg-muted/30 px-4 py-3 text-left align-top font-medium text-foreground"
                          >
                            {attr.name}
                          </th>
                          <td className="px-4 py-3 align-top text-foreground/90">
                            {attr.value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>
                  {tf(
                    "product.noSpecifications",
                    "No specifications available for this product.",
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        {product.tags.length > 0 && (
          <div className="mt-7 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {tf("common.tags", "Tags")}:
            </span>
            {product.tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="rounded-full px-3 py-1 text-xs"
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
