"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Upload,
  CalendarClock,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { generateBarcode } from "@/lib/products/codes";
import { useCurrency } from "@/providers/currency-provider";
import {
  collectVariantBarcodes,
  generateVariantSku,
  type MediaItem,
  type ProductVariant,
} from "@/components/admin/variants-manager/helpers";
import { AppImage } from "@/components/ui/app-image";

export function ImageSelectorModal({
  open,
  onClose,
  mediaItems,
  selectedId,
  onSelect,
  onUpload,
  isBulk = false,
  bulkCount = 0,
}: {
  open: boolean;
  onClose: () => void;
  mediaItems: MediaItem[];
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  onUpload?: (file: File) => Promise<MediaItem | null>;
  isBulk?: boolean;
  bulkCount?: number;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (file: File) => {
    if (!onUpload) return;

    setIsUploading(true);
    try {
      const newMedia = await onUpload(file);
      if (newMedia) {
        onSelect(newMedia._id);
        onClose();
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      handleFileSelect(file);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
    e.target.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-6 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {isBulk
              ? `Select image for ${bulkCount} variant${bulkCount !== 1 ? "s" : ""}`
              : "Select variant image"}
          </DialogTitle>
          <DialogDescription>
            Pick an image from the product media gallery.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Upload Zone */}
          {onUpload && (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              className={cn(
                "border-2 border-dashed rounded-2xl p-6 text-center transition-colors",
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25",
                isUploading && "opacity-50 pointer-events-none"
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleInputChange}
                className="hidden"
              />

              {isUploading ? (
                <div className="flex items-center justify-center gap-2 py-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">Uploading...</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2"
                >
                  <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
                  <p className="text-sm text-muted-foreground">
                    Drop image here or click to upload
                  </p>
                </button>
              )}
            </div>
          )}

          {/* Existing Media Grid */}
          {mediaItems.length > 0 && (
            <div className="grid max-h-[60vh] grid-cols-3 gap-4 overflow-y-auto pr-1 scrollbar-none [&::-webkit-scrollbar]:hidden hover:scrollbar-thin hover:[scrollbar-color:var(--border)_transparent] hover:[&::-webkit-scrollbar]:block hover:[&::-webkit-scrollbar]:w-1.5 hover:[&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-border/50">
              <button
                type="button"
                onClick={() => {
                  onSelect(undefined);
                  onClose();
                }}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-2xl border border-dashed bg-muted/40 text-sm font-medium text-muted-foreground transition-all hover:bg-muted",
                  !selectedId
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border"
                )}
              >
                None
              </button>
              {mediaItems.map((m) => (
                <button
                  key={m._id}
                  type="button"
                  onClick={() => {
                    onSelect(m._id);
                    onClose();
                  }}
                  className={cn(
                    "group relative aspect-square overflow-hidden rounded-2xl border bg-muted transition-all hover:shadow-md",
                    selectedId === m._id
                      ? "border-primary ring-2 ring-primary/40"
                      : "border-border hover:border-foreground/20"
                  )}
                >
                  <AppImage
                    src={m.url}
                    alt={m.alt || ""}
                    fill
                    sizes="160px"
                    className="object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                </button>
              ))}
            </div>
          )}

          {/* Empty state */}
          {mediaItems.length === 0 && !onUpload && (
            <p className="text-center text-sm text-muted-foreground py-4">
              No product media available. Upload images in the Media section
              first.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Variant Row Component with inline upload

export function VariantEditModal({
  variant,
  variants,
  open,
  onClose,
  onUpdate,
  onRemove,
  defaultRequiresShipping,
  defaultWeightUnit,
}: {
  variant: ProductVariant | null;
  variants: ProductVariant[];
  open: boolean;
  onClose: () => void;
  onUpdate: (variant: ProductVariant) => void;
  onRemove: (variantId: string) => void;
  defaultRequiresShipping: boolean;
  defaultWeightUnit: "g" | "kg" | "lb" | "oz";
}) {
  const { currency } = useCurrency();
  const currencySymbol = currency?.symbol || currency?.code || "USD";
  const [createVariant, setCreateVariant] = useState(true);
  const [price, setPrice] = useState(() =>
    variant?.price ? String(variant.price) : "",
  );
  const [comparePrice, setComparePrice] = useState(() =>
    typeof variant?.comparePrice === "number"
      ? String(variant.comparePrice)
      : "",
  );
  const [cost, setCost] = useState(() =>
    typeof variant?.cost === "number" ? String(variant.cost) : "",
  );
  const [sku, setSku] = useState(() => variant?.sku || "");
  const [barcode, setBarcode] = useState(() => variant?.barcode || "");
  const [barcodeFormat, setBarcodeFormat] = useState<
    "auto" | "ean13" | "upca" | "gtin14" | "code128"
  >(() => variant?.barcodeFormat || "auto");
  const [barcodeSource, setBarcodeSource] = useState<
    "unspecified" | "manufacturer" | "gs1" | "internal"
  >(() => variant?.barcodeSource || "unspecified");
  const [requiresShipping, setRequiresShipping] = useState(
    () => variant?.requiresShipping ?? defaultRequiresShipping,
  );
  const [weight, setWeight] = useState(() =>
    typeof variant?.weight === "number" ? String(variant.weight) : "",
  );
  const [weightUnit, setWeightUnit] = useState<"g" | "kg" | "lb" | "oz">(
    () => variant?.weightUnit || defaultWeightUnit,
  );
  const [preorderEnabled, setPreorderEnabled] = useState(
    () => variant?.preorder?.enabled || false,
  );
  const [preorderReleaseDate, setPreorderReleaseDate] = useState(
    () => variant?.preorder?.releaseDate || "",
  );
  const [preorderLimit, setPreorderLimit] = useState(() =>
    typeof variant?.preorder?.limit === "number"
      ? String(variant.preorder.limit)
      : "0",
  );
  const [preorderMessage, setPreorderMessage] = useState(
    () => variant?.preorder?.message || "",
  );
  const [preorderPaymentMode, setPreorderPaymentMode] = useState<
    "full" | "deposit" | "pay_later"
  >(() => variant?.preorder?.paymentMode || "full");
  const [preorderDepositType, setPreorderDepositType] = useState<
    "percentage" | "fixed"
  >(() => variant?.preorder?.depositType || "percentage");
  const [preorderDepositValue, setPreorderDepositValue] = useState(() =>
    typeof variant?.preorder?.depositValue === "number"
      ? String(variant.preorder.depositValue)
      : "0",
  );
  const [preorderSupplierEta, setPreorderSupplierEta] = useState(
    () => variant?.preorder?.supplierEta || "",
  );
  const [preorderBatchName, setPreorderBatchName] = useState(
    () => variant?.preorder?.batchName || "",
  );

  const priceNumber = parseFloat(price);
  const comparePriceNumber = parseFloat(comparePrice);
  const costNumber = parseFloat(cost);
  const hasComparePrice =
    !Number.isNaN(comparePriceNumber) &&
    comparePrice.trim() !== "" &&
    comparePriceNumber >= 0;
  const hasCost =
    !Number.isNaN(costNumber) && cost.trim() !== "" && costNumber >= 0;
  const profit =
    !Number.isNaN(priceNumber) && priceNumber > 0 && hasCost
      ? priceNumber - costNumber
      : null;
  const margin =
    profit !== null && priceNumber > 0 ? (profit / priceNumber) * 100 : null;

  const handleAutoGenerateInventory = () => {
    if (!variant) return;
    const usedBarcodes = collectVariantBarcodes(variants, variant.id);
    setSku(generateVariantSku(variant));
    setBarcode(generateBarcode(usedBarcodes));
    setBarcodeFormat("ean13");
    setBarcodeSource("internal");
  };

  const handleDone = () => {
    if (!variant) return;

    if (!createVariant) {
      onRemove(variant.id);
      onClose();
      return;
    }

    const nextPrice = Number.isNaN(priceNumber)
      ? 0
      : Math.max(0, priceNumber);
    const nextComparePrice = hasComparePrice
      ? Math.max(0, comparePriceNumber)
      : undefined;
    const nextCost = hasCost ? Math.max(0, costNumber) : undefined;

    onUpdate({
      ...variant,
      price: nextPrice,
      comparePrice: nextComparePrice,
      cost: nextCost,
      sku: sku.trim(),
      barcode: barcode.trim() || undefined,
      barcodeFormat: barcodeFormat === "auto" ? undefined : barcodeFormat,
      barcodeSource:
        barcodeSource === "unspecified" ? undefined : barcodeSource,
      requiresShipping,
      weight:
        requiresShipping && weight.trim() !== ""
          ? Math.max(0, parseFloat(weight) || 0)
          : undefined,
      weightUnit: requiresShipping ? weightUnit : undefined,
      preorder: preorderEnabled
        ? {
            enabled: true,
            releaseDate: preorderReleaseDate || undefined,
            message: preorderMessage.trim() || undefined,
            limit: Math.max(0, parseInt(preorderLimit, 10) || 0),
            reservedQuantity: Math.max(
              0,
              Number(variant.preorder?.reservedQuantity || 0),
            ),
            preorderOnly: variant.preorder?.preorderOnly || false,
            autoConvert: variant.preorder?.autoConvert ?? true,
            paymentMode: preorderPaymentMode,
            depositType: preorderDepositType,
            depositValue: Math.max(
              0,
              parseFloat(preorderDepositValue) || 0,
            ),
            supplierEta: preorderSupplierEta || undefined,
            batchName: preorderBatchName.trim() || undefined,
          }
        : {
            ...variant.preorder,
            enabled: false,
          },
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-[620px] gap-0 overflow-y-auto p-0">
        <DialogHeader className="border-b px-4 py-4">
          <DialogTitle className="text-base">
            Edit {variant?.name || "variant"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Edit this variant price, compare-at price, cost, SKU, and barcode.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-0">
          <div className="border-b px-4 py-4">
            <Label className="flex items-center gap-2 text-sm font-normal">
              <input
                type="checkbox"
                checked={createVariant}
                onChange={(event) => setCreateVariant(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 accent-foreground"
              />
              Create this variant
            </Label>
          </div>

          <div className="space-y-5 border-b px-4 py-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="variant-price" className="text-sm font-normal">
                  Price
                </Label>
                <CurrencyInput
                  id="variant-price"
                  currencySymbol={currencySymbol}
                  step="0.01"
                  min="0"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  className="h-9"
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="variant-compare-price"
                  className="text-sm font-normal"
                >
                  Compare-at price
                </Label>
                <CurrencyInput
                  id="variant-compare-price"
                  currencySymbol={currencySymbol}
                  step="0.01"
                  min="0"
                  value={comparePrice}
                  onChange={(event) => setComparePrice(event.target.value)}
                  className="h-9"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-normal">Barcode standard</Label>
                <Select value={barcodeFormat} onValueChange={(value) => setBarcodeFormat(value as typeof barcodeFormat)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    <SelectItem value="ean13">EAN-13 / GTIN-13</SelectItem>
                    <SelectItem value="upca">UPC-A / GTIN-12</SelectItem>
                    <SelectItem value="gtin14">GTIN-14</SelectItem>
                    <SelectItem value="code128">Code 128 (internal)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-normal">Identifier source</Label>
                <Select value={barcodeSource} onValueChange={(value) => setBarcodeSource(value as typeof barcodeSource)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unspecified">Not specified</SelectItem>
                    <SelectItem value="manufacturer">Manufacturer assigned</SelectItem>
                    <SelectItem value="gs1">GS1 issued</SelectItem>
                    <SelectItem value="internal">Internal store code</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="flex h-8 items-center gap-2 rounded-md border px-3 text-sm">
                <span>Cost</span>
                <span className="text-muted-foreground">{currencySymbol}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={cost}
                  onChange={(event) => setCost(event.target.value)}
                  placeholder="--"
                  className="w-16 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="flex h-8 items-center gap-2 rounded-md border px-3 text-sm">
                <span>Profit</span>
                <span className="text-muted-foreground">
                  {profit === null
                    ? "--"
                    : `${currencySymbol}${profit.toFixed(2)}`}
                </span>
              </div>
              <div className="flex h-8 items-center gap-2 rounded-md border px-3 text-sm">
                <span>Margin</span>
                <span className="text-muted-foreground">
                  {margin === null ? "--" : `${margin.toFixed(1)}%`}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-4 border-b px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Inventory</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAutoGenerateInventory}
                disabled={!variant}
                className="h-8 gap-2"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Auto-generate
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="variant-sku" className="text-sm font-normal">
                  SKU (Stock Keeping Unit)
                </Label>
                <Input
                  id="variant-sku"
                  value={sku}
                  onChange={(event) => setSku(event.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="variant-barcode"
                  className="text-sm font-normal"
                >
                  Barcode (ISBN, UPC, GTIN, etc.)
                </Label>
                <Input
                  id="variant-barcode"
                  value={barcode}
                  onChange={(event) => setBarcode(event.target.value)}
                  className="h-9"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4 border-b px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Shipping</h3>
              <Label className="flex items-center gap-2 text-sm font-normal">
                <input
                  type="checkbox"
                  checked={requiresShipping}
                  onChange={(event) => setRequiresShipping(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 accent-foreground"
                />
                Requires shipping
              </Label>
            </div>
            {requiresShipping && (
              <div className="grid gap-3 md:grid-cols-[1fr_140px]">
                <div className="space-y-1.5">
                  <Label htmlFor="variant-weight" className="text-sm font-normal">
                    Weight override
                  </Label>
                  <Input
                    id="variant-weight"
                    type="number"
                    min="0"
                    step="0.01"
                    value={weight}
                    onChange={(event) => setWeight(event.target.value)}
                    className="h-9"
                    placeholder="Use product weight"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-normal">Unit</Label>
                  <Select
                    value={weightUnit}
                    onValueChange={(value) =>
                      setWeightUnit(value as "g" | "kg" | "lb" | "oz")
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kg">kg</SelectItem>
                      <SelectItem value="g">g</SelectItem>
                      <SelectItem value="lb">lb</SelectItem>
                      <SelectItem value="oz">oz</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 border-b px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <CalendarClock className="h-4 w-4" />
                Pre-order
              </h3>
              <Label className="flex items-center gap-2 text-sm font-normal">
                <input
                  type="checkbox"
                  checked={preorderEnabled}
                  onChange={(event) => setPreorderEnabled(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 accent-foreground"
                />
                Enable
              </Label>
            </div>

            {preorderEnabled && (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="variant-preorder-release" className="text-sm font-normal">
                      Expected ship date
                    </Label>
                    <Input
                      id="variant-preorder-release"
                      type="date"
                      value={preorderReleaseDate}
                      onChange={(event) =>
                        setPreorderReleaseDate(event.target.value)
                      }
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="variant-preorder-limit" className="text-sm font-normal">
                      Pre-order limit
                    </Label>
                    <Input
                      id="variant-preorder-limit"
                      type="number"
                      min="0"
                      value={preorderLimit}
                      onChange={(event) => setPreorderLimit(event.target.value)}
                      className="h-9"
                    />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-normal">Payment</Label>
                    <Select
                      value={preorderPaymentMode}
                      onValueChange={(value) =>
                        setPreorderPaymentMode(
                          value as "full" | "deposit" | "pay_later",
                        )
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full">Full payment</SelectItem>
                        <SelectItem value="deposit">Deposit</SelectItem>
                        <SelectItem value="pay_later">Pay later</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-normal">Deposit type</Label>
                    <Select
                      value={preorderDepositType}
                      onValueChange={(value) =>
                        setPreorderDepositType(value as "percentage" | "fixed")
                      }
                      disabled={preorderPaymentMode !== "deposit"}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage</SelectItem>
                        <SelectItem value="fixed">Fixed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="variant-preorder-deposit" className="text-sm font-normal">
                      Deposit value
                    </Label>
                    <Input
                      id="variant-preorder-deposit"
                      type="number"
                      min="0"
                      step="0.01"
                      value={preorderDepositValue}
                      disabled={preorderPaymentMode !== "deposit"}
                      onChange={(event) =>
                        setPreorderDepositValue(event.target.value)
                      }
                      className="h-9"
                    />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="variant-supplier-eta" className="text-sm font-normal">
                      Supplier ETA
                    </Label>
                    <Input
                      id="variant-supplier-eta"
                      type="date"
                      value={preorderSupplierEta}
                      onChange={(event) =>
                        setPreorderSupplierEta(event.target.value)
                      }
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="variant-batch-name" className="text-sm font-normal">
                      Batch
                    </Label>
                    <Input
                      id="variant-batch-name"
                      value={preorderBatchName}
                      onChange={(event) => setPreorderBatchName(event.target.value)}
                      className="h-9"
                      placeholder="Spring drop"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="variant-preorder-message" className="text-sm font-normal">
                    Storefront message
                  </Label>
                  <Input
                    id="variant-preorder-message"
                    value={preorderMessage}
                    onChange={(event) => setPreorderMessage(event.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="border-b px-4 py-4 text-sm text-muted-foreground">
            Save the product to edit more variant details.
          </div>
        </div>

        <DialogFooter className="bg-muted/30 px-4 py-3">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleDone}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Variant Group Component
