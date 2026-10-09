"use client";

import type { CSSProperties } from "react";
import dynamic from "next/dynamic";
import {
  Loader2,
  Minus,
  PackageOpen,
  Plus,
  RotateCcw,
  Store,
  Truck,
} from "lucide-react";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import { StorefrontChatButton } from "@/components/chat/storefront-chat-button";
import { cn } from "@/lib/utils";
import { productTracksStock } from "@/lib/products/stock-policy";
import { isColorOptionName } from "@/lib/products/color-swatch";
import {
  discountChipCss,
  purchaseButtonCss,
  quantityStepperCss,
  stockChipCss,
  typographyCss,
} from "@/lib/storefront/sections/product-detail-css";
import type {
  ProductInfoSectionKind,
  PurchaseProduct,
  PurchaseVariant,
} from "@/lib/products/purchase-product";
import { ProductImageGallery } from "./product-image-gallery";
import { OptionValueSelector } from "./option-value-selector";
import {
  isSizeOptionName,
  normalizeOptionLabel,
  useProductPurchase,
} from "./product-purchase";

// Only a sold-out pre-order mounts the waitlist form — which can be the
// moment a shopper picks that variant, so it waits for its chunk in a
// boundary of its own rather than suspending the whole product section.
const PreorderWaitlistForm = dynamic(
  () =>
    import("@/components/products/preorder-waitlist-form").then(
      (module) => module.PreorderWaitlistForm,
    ),
  { loading: () => null },
);

/*
 * The product page's controls that answer to the shopper, one per buy-box
 * row. The server draws the page around them (product-details.tsx) and each
 * reads the shared purchase state, so picking a variant moves the price, the
 * stock chip, the cart buttons, the gallery and the details list together.
 */

/* The pieces the buy box and the pinned bar swap in for a quote-only
   product. Written once rather than inline in each: two copies of the same
   swap is how one of them ends up still offering Add to cart after a
   redesign. Both take the host's own classes, so the substitute sits at the
   size and weight of what it replaced. */
export function QuotePrice({
  className,
  style,
}: {
  className: string;
  style?: CSSProperties;
}) {
  const { quoteOffer, quotedNow, formatDisplayPrice, tf } = useProductPurchase();
  return (
    <span className={className} style={style}>
      {quoteOffer ? (
        <>
          {formatDisplayPrice(quoteOffer.unitPrice)}
          {/* The offer covers one exact lot, so a shopper who has moved the
              stepper off it is told what the price actually applies to rather
              than left wondering why the button went back to asking. */}
          {quotedNow ? null : (
            <span className="ms-1 text-xs font-normal text-muted-foreground">
              {tf("product.quotedForQuantity", "for {count}").replace(
                "{count}",
                String(quoteOffer.quantity),
              )}
            </span>
          )}
        </>
      ) : (
        tf("product.priceOnRequest", "Price on request")
      )}
    </span>
  );
}

export function QuoteButton({
  className,
  style,
}: {
  className: string;
  style?: CSSProperties;
}) {
  const {
    t,
    quotedNow,
    quoteButtonText,
    requestQuote,
    handleAddToCart,
    awaitingVariantChoice,
    isAddingToCart,
  } = useProductPurchase();
  return quotedNow ? (
    <Button
      type="button"
      className={className}
      style={style}
      onClick={handleAddToCart}
      disabled={awaitingVariantChoice || isAddingToCart}
    >
      {isAddingToCart ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
      {t("product.addToCart")}
    </Button>
  ) : (
    <Button
      type="button"
      className={className}
      style={style}
      onClick={requestQuote}
      disabled={awaitingVariantChoice}
    >
      {quoteButtonText}
    </Button>
  );
}

/** The stepper beside the buttons, or its smaller copy in the pinned bar. */
export function QuantityStepper({ compact = false }: { compact?: boolean }) {
  const { detail, quantity, setQuantity, maxPurchasableQuantity, tf } =
    useProductPurchase();
  const sty = detail.style;
  const buttonClass = cn(
    "inline-flex h-full items-center justify-center text-foreground transition hover:opacity-70 disabled:opacity-40",
    compact ? "w-7" : "w-8",
  );
  const iconClass = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const Box = compact ? "span" : "div";
  return (
    <Box
      className={cn(
        "items-center justify-between border border-foreground px-1",
        compact
          ? "hidden h-9 lg:flex"
          : cn(
              "flex w-[100px] shrink-0 bg-background",
              sty.buttonLayout === "stacked" && "self-start",
            ),
      )}
      style={quantityStepperCss(sty, compact ? "compact" : "full")}
    >
      <button
        type="button"
        onClick={() => setQuantity(Math.max(1, quantity - 1))}
        disabled={quantity <= 1}
        aria-label={tf("common.decreaseQuantity", "Decrease quantity")}
        className={buttonClass}
      >
        <Minus className={iconClass} />
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
        aria-label={tf("common.increaseQuantity", "Increase quantity")}
        className={buttonClass}
      >
        <Plus className={iconClass} />
      </button>
    </Box>
  );
}

/** Price, compare-at, discount and stock chips, and the lines under them. */
export function PurchasePriceRow() {
  const {
    product,
    locale,
    detail,
    t,
    tf,
    formatDisplayPrice,
    quoteOnly,
    displayedPrice,
    displayedComparePrice,
    discountPercentage,
    preorderPurchase,
    preorderFull,
    availableStock,
    currentStock,
    collectionAtBranch,
    selectedVariant,
    signedInEmail,
  } = useProductPurchase();
  const { visibility: vis, style: sty } = detail;
  const typo = sty.typography;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-3">
        {quoteOnly ? (
          <QuotePrice
            className="text-2xl font-bold tracking-tight text-foreground"
            style={typographyCss(typo.price)}
          />
        ) : (
          <>
            <span
              className="text-2xl font-bold tracking-tight text-foreground"
              style={typographyCss(typo.price)}
            >
              {formatDisplayPrice(displayedPrice)}
            </span>
            {displayedComparePrice && displayedComparePrice > displayedPrice ? (
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
          <span
            className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
            style={discountChipCss(sty)}
          >
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
          style={stockChipCss(
            sty,
            preorderPurchase ? "preorder" : availableStock > 0 ? "in" : "out",
          )}
        >
          {preorderPurchase
            ? tf("product.preorder", "Pre-order")
            : availableStock > 0
              ? t("product.inStock")
              : t("product.outOfStock")}
        </span>
      </div>
      {/* Taking pre-orders, but every spot is taken and there is no stock to
          sell instead: a waiting list rather than a bare "Out of stock". */}
      {preorderFull ? (
        <PreorderWaitlistForm
          productKey={product.slug || String(product._id)}
          variantId={
            selectedVariant?.preorder?.enabled && selectedVariant?._id
              ? String(selectedVariant._id)
              : undefined
          }
          locale={locale}
          signedInEmail={signedInEmail}
        />
      ) : null}
      {!preorderPurchase &&
      productTracksStock(product) &&
      currentStock > 0 &&
      currentStock < 10 ? (
        <p
          className="text-sm text-orange-600"
          style={sty.lowStockColor ? { color: sty.lowStockColor } : undefined}
        >
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
}

/** One chooser per option — colour first, then size, then the rest. */
export function PurchaseVariantsRow() {
  const {
    product,
    t,
    selectedOptions,
    selectOptionValue,
    setIsSizeGuideOpen,
    variantChoicePrompt,
    unansweredOptions,
  } = useProductPurchase();
  const optionEntries = product.options
    .map((opt, idx) => ({
      opt,
      idx,
      rank: isColorOptionName(opt.name) ? 0 : isSizeOptionName(opt.name) ? 1 : 2,
    }))
    .sort((a, b) => a.rank - b.rank || a.idx - b.idx);

  return (
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
            {isSizeOptionName(opt.name) ? (
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
            onSelect={(value) => selectOptionValue(idx, value)}
            // Resolved on the server (lib/products/purchase-product.ts): the
            // value's own colour, a variant's, or the one its name says.
            resolveColor={(v) => v.colorCode ?? null}
          />
        </div>
      ))}
      {variantChoicePrompt ? (
        <div className="pt-3">
          <p
            role="status"
            className={cn(
              "text-sm font-medium",
              unansweredOptions.length > 0
                ? "text-muted-foreground"
                : "text-orange-600 dark:text-orange-400",
            )}
          >
            {variantChoicePrompt}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** The quantity stepper and the purchase buttons, or the quote button. */
export function PurchaseCartRow() {
  const {
    detail,
    tf,
    formatPrice,
    quoteOnly,
    cartButtonText,
    buyButtonText,
    purchaseShut,
    handleAddToCart,
    handleBuyNow,
    preorderPurchase,
    preorderDateLabel,
    preorderRemaining,
    preorderTerms,
  } = useProductPurchase();
  const { visibility: vis, style: sty } = detail;

  // Every control in this row shares the "Cart button radius" knob, set
  // inline: the store theme's [data-slot="button"] radius rule
  // (globals.css) outranks any rounded-* class on a Button.
  //
  // Quote-only: no quantity stepper either. The number that matters is
  // the one the shopper types into the request form, and a stepper here
  // would be a second, silently ignored answer to the same question.
  if (quoteOnly) {
    return (
      <div className="space-y-3">
        <QuoteButton
          className="h-11 w-full text-sm font-bold"
          style={{ borderRadius: sty.cartRadius, height: sty.buttonHeight }}
        />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div
        className={cn(
          "flex gap-2.5",
          // Stacked: each control on its own full-width line.
          sty.buttonLayout === "stacked"
            ? "flex-col items-stretch"
            : "flex-wrap items-center",
        )}
      >
        {vis.quantity ? <QuantityStepper /> : null}
        {sty.actions !== "buy" ? (
          <Button
            size="lg"
            className={cn(
              "h-11 min-w-[120px] bg-foreground text-sm font-bold text-background hover:bg-foreground/90",
              sty.buttonLayout === "stacked" ? "w-full" : "flex-1",
            )}
            style={purchaseButtonCss(sty, "cart")}
            onClick={handleAddToCart}
            disabled={purchaseShut}
          >
            {cartButtonText}
          </Button>
        ) : null}
        {sty.actions !== "cart" ? (
          <Button
            size="lg"
            className={cn(
              "h-11 min-w-[120px] text-sm font-bold",
              sty.buttonLayout === "stacked" ? "w-full" : "flex-1",
            )}
            style={purchaseButtonCss(sty, "buy")}
            onClick={handleBuyNow}
            disabled={purchaseShut}
          >
            {buyButtonText}
          </Button>
        ) : null}
      </div>
      {preorderPurchase ? (
        <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              {preorderDateLabel
                ? tf("product.preorderShips", "Expected ship date: {date}", {
                    date: preorderDateLabel,
                  })
                : tf("product.preorderShipsSoon", "Expected to ship soon")}
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
            {/* "Due today" is the ITEM's share and nothing else, so
                a pay-later pre-order reads as costing nothing today —
                while checkout charges shipping and tax on the spot
                (`paymentDueNow = total - outstanding`, where the
                outstanding is only the line price). Said plainly here
                rather than left for the shopper to discover at the
                payment step. */}
            {preorderTerms.dueLater > 0 ? (
              <p className="text-blue-700/80 dark:text-blue-200/80 sm:col-span-2">
                {tf(
                  "product.preorderShippingAtCheckout",
                  "Shipping and tax are charged at checkout.",
                )}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type ProductInfoField = {
  label: string;
  value: string;
  href?: string;
};

function normalizeAttributeKey(key: string) {
  return key
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildAttributeLookup(
  productAttributes: PurchaseProduct["attributes"],
  variantAttributes?: PurchaseVariant["attributes"],
) {
  const lookup = new Map<string, string>();
  const addAttributes = (attributes?: PurchaseProduct["attributes"]) => {
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

function humanizeAttributeLabel(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getSelectedOptionEntries({
  product,
  selectedVariant,
  selectedOptions,
}: {
  product: PurchaseProduct;
  selectedVariant?: PurchaseVariant;
  selectedOptions: string[];
}) {
  const productOptions = product.options;
  const optionValues = selectedVariant?.optionValues || [];

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

function getOptionValues(
  product: PurchaseProduct,
  matcher: (name: string) => boolean,
) {
  const option = product.options.find((item) => matcher(item.name));
  if (!option) return [];

  return Array.from(
    new Set(
      option.values
        .map((item) => item.value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

const INFO_FIELD_CONFIGS: Record<
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

function getProductInfoFields({
  product,
  selectedVariant,
  selectedOptions,
  sectionKind,
  locale,
}: {
  product: PurchaseProduct;
  selectedVariant?: PurchaseVariant;
  selectedOptions: string[];
  sectionKind: ProductInfoSectionKind;
  locale: string;
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

  INFO_FIELD_CONFIGS[sectionKind].forEach((config) => {
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

/**
 * The details accordion's list. The SKU, barcode, weight and the selected
 * colour and size follow the chosen variant, so the list is drawn here while
 * its accordion around it is drawn on the server.
 */
export function PurchaseDetailsFields({
  sectionKind,
}: {
  sectionKind: ProductInfoSectionKind;
}) {
  const { product, locale, selectedVariant, selectedOptions } =
    useProductPurchase();
  const fields = getProductInfoFields({
    product,
    selectedVariant,
    selectedOptions,
    sectionKind,
    locale,
  });
  return (
    <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
      {fields.map((field) => (
        <div
          key={`${field.label}-${field.value}`}
          className="grid grid-cols-[112px_1fr] gap-2"
        >
          <span className="font-medium text-foreground/80">{field.label}:</span>
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
    </div>
  );
}

/**
 * The delivery / returns card. Both lines read the settings checkout and the
 * return flow enforce (the provider's `fulfillment`). A line with nothing true
 * to say is left out, and a card with no lines is not drawn at all.
 *
 * `group`: the page has put the card in a group of its own, and the card is
 * there only while the choice is a pre-order — so the group's frame comes and
 * goes with it rather than leaving an empty band behind.
 */
export function PurchaseInfoCard({
  group,
}: {
  group?: { className: string; style: CSSProperties };
}) {
  const {
    detail,
    fulfillment,
    finalSale,
    selectedVariant,
    tf,
    formatPrice,
    preorderPurchase,
    preorderTerms,
  } = useProductPurchase();
  const sty = detail.style;
  const delivery = fulfillment?.deliveryDays ?? null;
  const returns = fulfillment?.returns ?? null;
  if (!delivery && !returns && !preorderPurchase) return null;

  /**
   * "within 4–7 days"; a window with one edge ("within 5 days") when
   * the rate names a single figure or only an upper bound.
   *
   * A pre-order counts the same figures from DISPATCH rather than from
   * checkout. The carrier's window is the carrier's window — what a
   * pre-order does not have is a parcel to start it, so printing it as
   * "standard delivery within 4–7 days" directly under a release date
   * two months out promised the goods before they exist. The rate is
   * unchanged; only the day it starts counting is said out loud.
   */
  const deliveryRange = delivery && delivery.min > 0 && delivery.min < delivery.max;
  const deliveryText = !delivery
    ? null
    : preorderPurchase
      ? deliveryRange
        ? tf(
            "product.deliveryRangeAfterDispatch",
            "Delivery within {min}–{max} days once it ships",
            { min: delivery.min, max: delivery.max },
          )
        : tf(
            "product.deliveryWithinAfterDispatch",
            "Delivery within {days} days once it ships",
            { days: delivery.max },
          )
      : deliveryRange
        ? tf(
            "product.deliveryRange",
            "Standard delivery within {min}–{max} days",
            { min: delivery.min, max: delivery.max },
          )
        : tf(
            "product.deliveryWithin",
            "Standard delivery within {days} days",
            { days: delivery.max },
          );

  /**
   * A pre-order is bought before it exists, so the return window has not
   * started and printing it promises the wrong thing: nothing has been
   * delivered to send back "in original condition". What governs the
   * money until dispatch is the cancellation rule
   * lib/orders/preorder-cancel-refund.ts enforces — cancel means refund,
   * whoever cancels, with no per-campaign exception to read — so that is
   * the policy this row states while the item is still a pre-order. The
   * return terms come back on their own the moment it ships as stock.
   */
  const preorderPolicyText = !preorderPurchase
    ? null
    : preorderTerms.dueNow <= 0
      ? tf(
          "product.preorderCancelNothingPaid",
          "Cancel until it is released for fulfilment and anything you have paid is refunded in full — the item itself is not charged until the balance is due",
        )
      : preorderTerms.dueLater > 0
        ? tf(
            "product.preorderCancelDeposit",
            "Cancel until it is released for fulfilment and your {amount} deposit is refunded in full",
            { amount: formatPrice(preorderTerms.dueNow) },
          )
        : tf(
            "product.preorderCancelRefund",
            "Cancel until it is released for fulfilment for a full refund",
          );

  // Final sale takes the place of the return terms: none of them apply.
  // The chosen variant answers when it has its own setting, else the
  // product does.
  const selectedVariantKey = selectedVariant?._id ? String(selectedVariant._id) : "";
  const isFinalSaleChoice = finalSale
    ? selectedVariantKey && selectedVariantKey in finalSale.variants
      ? finalSale.variants[selectedVariantKey]
      : finalSale.product
    : false;

  let returnsText: string | null = null;
  if (returns && !preorderPurchase && isFinalSaleChoice) {
    returnsText = tf("product.finalSale", "Final sale — this item can't be returned");
  } else if (returns && !preorderPurchase && returns.windowDays === null) {
    // No time limit (R6): the same terms, without a deadline.
    const values = {
      percent: returns.restockingFeePercent,
      fee: formatPrice(returns.returnShippingFee),
    };
    const restocking = returns.restockingFeePercent > 0;
    const shippingFee = returns.returnShippingFee > 0;
    returnsText =
      restocking && shippingFee
        ? tf(
            "product.returnsAnyTimeFees",
            "Return any time in original condition — {percent}% restocking fee and {fee} return shipping apply",
            values,
          )
        : restocking
          ? tf(
              "product.returnsAnyTimeRestocking",
              "Return any time in original condition — a {percent}% restocking fee applies",
              values,
            )
          : shippingFee
            ? tf(
                "product.returnsAnyTimeShippingFee",
                "Return any time in original condition — {fee} return shipping applies",
                values,
              )
            : tf(
                "product.returnsAnyTime",
                "Return any time in original condition for a full refund",
                values,
              );
  } else if (returns && !preorderPurchase && returns.windowDays !== null) {
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

  // One policy line, never two: the pre-order rule while it is a
  // pre-order, the return terms once it is ordinary stock.
  const policyText = preorderPolicyText ?? returnsText;

  const lineClassName = "flex items-center gap-3 py-3 text-sm text-foreground";
  const lineStyle = {
    paddingLeft: sty.cardPadding,
    paddingRight: sty.cardPadding,
  };
  const card = (
    <div
      className="divide-y divide-border rounded-xl border border-border"
      style={{
        borderRadius: sty.cardRadius,
        ...(sty.cardBackground ? { backgroundColor: sty.cardBackground } : {}),
        // Through the variable, so the hairline between the two lines
        // takes the card's border colour too.
        ...(sty.cardBorder
          ? ({ "--border": sty.cardBorder } as CSSProperties)
          : {}),
        borderWidth: sty.cardBorderWidth,
      }}
    >
      {deliveryText ? (
        <div className={lineClassName} style={lineStyle}>
          <Truck className="h-5 w-5 shrink-0" aria-hidden />
          {deliveryText}
        </div>
      ) : null}
      {policyText ? (
        <div className={lineClassName} style={lineStyle}>
          {preorderPolicyText ? (
            <RotateCcw className="h-5 w-5 shrink-0" aria-hidden />
          ) : (
            <PackageOpen className="h-5 w-5 shrink-0" aria-hidden />
          )}
          {returns?.policyPage ? (
            <Link href="/returns" className="underline-offset-4 hover:underline">
              {policyText}
            </Link>
          ) : (
            policyText
          )}
        </div>
      ) : null}
    </div>
  );
  return group ? (
    <div className={group.className} style={group.style}>
      {card}
    </div>
  ) : (
    card
  );
}

/**
 * Live chat about this product. The thread carries the variant on screen, so
 * the button reads the selection; everything else about it is the server's.
 */
export function PurchaseChatButton({
  vendorId,
  vendorName,
  label,
}: {
  vendorId?: string;
  vendorName: string;
  label: string;
}) {
  const { product, locale, selectedVariant } = useProductPurchase();
  return (
    <StorefrontChatButton
      locale={locale}
      vendorId={vendorId}
      vendorName={vendorName}
      product={{
        id: product._id,
        name: product.name,
        variantId: selectedVariant?._id,
        variantName: selectedVariant?.name,
      }}
      label={label}
    />
  );
}

/** The gallery, on the picture the shopper — or their variant — chose. */
export function PurchaseGallery({
  layout,
}: {
  layout: "bottom" | "left" | "grid" | "carousel" | "vertical";
}) {
  const { product, detail, selectedImage, setSelectedImage, discountPercentage } =
    useProductPurchase();
  const { visibility: vis, style: sty } = detail;
  return (
    <ProductImageGallery
      media={product.media}
      productName={product.name}
      selectedIndex={selectedImage}
      onSelect={setSelectedImage}
      discountPercentage={vis.discountChipOnImage ? discountPercentage : 0}
      layout={layout}
      stageBackground={sty.previewBackground || undefined}
      stageHeight={sty.previewHeight > 0 ? sty.previewHeight : undefined}
      appearance={{
        radius: sty.imageRadius,
        gap: sty.imageGap,
        fit: sty.imageFit,
        padding: sty.imagePadding,
        thumbSize: sty.thumbSize,
        thumbRadius: sty.thumbRadius,
        thumbActiveBorder: sty.thumbActiveBorder,
        thumbBackground: sty.thumbBackground,
        thumbFit: sty.thumbFit,
        zoom: vis.zoom,
        thumbnails: vis.thumbnails,
      }}
    />
  );
}
