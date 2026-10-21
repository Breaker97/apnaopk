"use client";

import * as React from "react";
import {
  Barcode,
  Download,
  Loader2,
  Printer,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { toast } from "@/components/ui/toast-notification";
import { useCurrency } from "@/providers/currency-provider";
import { useAppSettings } from "@/providers/app-settings-provider";
import { renderBarcodeSvg } from "@/lib/barcode/render";
import { detectBarcodeFormat, type BarcodeFormat } from "@/lib/barcode/standards";
import {
  buildTsplProductLabel,
  buildZplProductLabel,
  MAX_LABEL_BARCODE_HEIGHT_MM,
  type ThermalPrinterLanguage,
} from "@/lib/barcode/thermal";
import {
  checkLabelSize,
  LABEL_SIZE_LIMITS,
  layoutProductLabel,
} from "@/lib/barcode/label-layout";
import {
  findQzPrinters,
  printRawWithQz,
  THERMAL_PRINTER_PROFILE_KEY,
} from "@/lib/printing/qz-client";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

export interface BarcodeLabelInventoryItem {
  id: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  sku: string;
  barcode: string;
  barcodeFormat?: BarcodeFormat;
  barcodeSource?: "manufacturer" | "gs1" | "internal";
  price: number;
  onHand: number;
}

interface BarcodeLabelStudioProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: BarcodeLabelInventoryItem[];
}

const PRESETS = {
  "38x25": { widthMm: 38, heightMm: 25 },
  "40x25": { widthMm: 40, heightMm: 25 },
  "50x25": { widthMm: 50, heightMm: 25 },
  "50x30": { widthMm: 50, heightMm: 30 },
  "60x40": { widthMm: 60, heightMm: 40 },
  "100x50": { widthMm: 100, heightMm: 50 },
  "100x150": { widthMm: 100, heightMm: 150 },
} satisfies Record<string, { widthMm: number; heightMm: number }>;

type LabelPreset = keyof typeof PRESETS;

/** A preset, or a size the user typed in (kept in this browser only). */
type SizeChoice = LabelPreset | "custom";

interface LabelSizeMm {
  widthMm: number;
  heightMm: number;
}

const PRESET_KEYS = Object.keys(PRESETS) as LabelPreset[];

const SIZE_OPTIONS = [
  ...PRESET_KEYS.map((key) => ({
    value: key,
    label: `${PRESETS[key].widthMm} × ${PRESETS[key].heightMm} mm`,
    // So "50 x 30" and "50*30" find it, not only "50x30" (the value) or "×".
    keywords: `${PRESETS[key].widthMm} x ${PRESETS[key].heightMm} ${PRESETS[key].widthMm}*${PRESETS[key].heightMm}`,
  })),
  { value: "custom", label: "Custom size…", keywords: "custom own manual" },
];

/** The widest print head most desktop thermal printers have. */
const COMMON_PRINTER_WIDTH_MM = 104;

const roundToTenth = (value: number) => Math.round(value * 10) / 10;

function isValidCustomSize(value: unknown): value is LabelSizeMm {
  if (!value || typeof value !== "object") return false;
  const { widthMm, heightMm } = value as Partial<LabelSizeMm>;
  return (
    typeof widthMm === "number" &&
    typeof heightMm === "number" &&
    checkLabelSize(widthMm, heightMm) === null
  );
}

function barcodeHeightMm(labelHeightMm: number) {
  return Math.min(MAX_LABEL_BARCODE_HEIGHT_MM, Math.max(9, labelHeightMm * 0.38));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function BarcodeLabelStudio({
  open,
  onOpenChange,
  items,
}: BarcodeLabelStudioProps) {
  const { formatPrice } = useCurrency();
  // Named after the store, since this string is what the operator sees in the
  // OS print queue.
  const { storeName } = useAppSettings();
  const [preset, setPreset] = React.useState<SizeChoice>("50x30");
  // The size a user typed. Never sent to the server: it lives in this browser
  // (with the printer choice below), so any vendor can print any size without
  // the store having to add it to a list first.
  const [customSize, setCustomSize] = React.useState<LabelSizeMm | null>(null);
  const [dpi, setDpi] = React.useState<203 | 300>(203);
  const [language, setLanguage] =
    React.useState<ThermalPrinterLanguage>("zpl");
  const [printerName, setPrinterName] = React.useState("");
  const [printers, setPrinters] = React.useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = React.useState(false);
  const [isPrinting, setIsPrinting] = React.useState(false);
  const [useStockQuantity, setUseStockQuantity] = React.useState(false);
  const [showPrice, setShowPrice] = React.useState(true);
  const [showSku, setShowSku] = React.useState(true);
  const [copies, setCopies] = React.useState<Record<string, number>>({});

  useApplyOnChange([items, open], () => {
    if (!open) return;
    setCopies((current) => {
      const next = { ...current };
      for (const item of items) {
        if (next[item.id] === undefined) next[item.id] = 1;
      }
      return next;
    });
    try {
      const stored = JSON.parse(
        localStorage.getItem(THERMAL_PRINTER_PROFILE_KEY) || "{}",
      ) as {
        printerName?: string;
        language?: ThermalPrinterLanguage;
        dpi?: 203 | 300;
        preset?: SizeChoice;
        customSize?: unknown;
      };
      if (stored.printerName) setPrinterName(stored.printerName);
      if (stored.language) setLanguage(stored.language);
      if (stored.dpi) setDpi(stored.dpi);
      const storedCustom = isValidCustomSize(stored.customSize)
        ? stored.customSize
        : null;
      if (storedCustom) setCustomSize(storedCustom);
      if (stored.preset === "custom") {
        if (storedCustom) setPreset("custom");
      } else if (stored.preset && PRESETS[stored.preset]) {
        setPreset(stored.preset);
      }
    } catch {
      // Ignore a malformed local device profile.
    }
  });

  React.useEffect(() => {
    if (!open) return;
    localStorage.setItem(
      THERMAL_PRINTER_PROFILE_KEY,
      JSON.stringify({ printerName, language, dpi, preset, customSize }),
    );
  }, [customSize, dpi, language, open, preset, printerName]);

  const dimensions: LabelSizeMm =
    preset === "custom" ? (customSize ?? PRESETS["50x30"]) : PRESETS[preset];
  const sizeLabel = `${dimensions.widthMm} × ${dimensions.heightMm} mm`;
  const validItems = React.useMemo(
    () => items.filter((item) => item.barcode.trim()),
    [items],
  );
  const skippedCount = items.length - validItems.length;
  const getCopies = React.useCallback(
    (item: BarcodeLabelInventoryItem) =>
      Math.min(
        500,
        Math.max(
          1,
          Math.trunc(useStockQuantity ? Math.max(1, item.onHand) : copies[item.id] || 1),
        ),
      ),
    [copies, useStockQuantity],
  );
  const totalCopies = validItems.reduce((sum, item) => sum + getCopies(item), 0);

  // What a label cannot hold at this size, found before anything reaches a
  // printer: a bad check digit, a barcode wider than the label, a label too
  // short for its lines. Printing waits until each one is dealt with.
  const problems = React.useMemo(() => {
    const sizeProblem = checkLabelSize(dimensions.widthMm, dimensions.heightMm);
    if (sizeProblem) return [sizeProblem];
    const found: string[] = [];
    for (const item of validItems) {
      const result = layoutProductLabel({
        barcode: item.barcode,
        barcodeFormat: item.barcodeFormat || detectBarcodeFormat(item.barcode),
        productName: item.productName,
        variantName: item.variantName || undefined,
        sku: showSku ? item.sku : undefined,
        price: showPrice ? formatPrice(item.price) : undefined,
        widthMm: dimensions.widthMm,
        heightMm: dimensions.heightMm,
        dpi,
      });
      if (result.ok) continue;
      const name = item.variantName
        ? `${item.productName} (${item.variantName})`
        : item.productName;
      for (const problem of result.problems) found.push(`${name}: ${problem}`);
    }
    return found;
  }, [dimensions, dpi, formatPrice, showPrice, showSku, validItems]);
  const canPrint = validItems.length > 0 && problems.length === 0;

  const buildRawJobs = React.useCallback(
    () =>
      validItems.map((item) => {
        const input = {
          barcode: item.barcode,
          barcodeFormat: item.barcodeFormat || detectBarcodeFormat(item.barcode),
          productName: item.productName,
          variantName: item.variantName || undefined,
          sku: showSku ? item.sku : undefined,
          price: showPrice ? formatPrice(item.price) : undefined,
          widthMm: dimensions.widthMm,
          heightMm: dimensions.heightMm,
          dpi,
          copies: getCopies(item),
        };
        return language === "zpl"
          ? buildZplProductLabel(input)
          : buildTsplProductLabel(input);
      }),
    [dimensions, dpi, formatPrice, getCopies, language, showPrice, showSku, validItems],
  );

  const discoverPrinters = async () => {
    setIsDiscovering(true);
    try {
      const found = await findQzPrinters();
      setPrinters(found);
      if (!printerName && found[0]) setPrinterName(found[0]);
      toast.success(`${found.length} printer${found.length === 1 ? "" : "s"} found`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "QZ Tray is not running or configured",
      );
    } finally {
      setIsDiscovering(false);
    }
  };

  const directPrint = async () => {
    setIsPrinting(true);
    try {
      await printRawWithQz(printerName, buildRawJobs(), {
        jobName: `${storeName} product barcode labels`,
      });
      toast.success(`${totalCopies} label${totalCopies === 1 ? "" : "s"} sent to printer`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Direct print failed");
    } finally {
      setIsPrinting(false);
    }
  };

  const browserPrint = () => {
    if (!canPrint) return;
    const labelHtml: string[] = [];
    for (const item of validItems) {
      let svg: string;
      try {
        svg = renderBarcodeSvg(item.barcode, {
          format: item.barcodeFormat,
          heightMm: barcodeHeightMm(dimensions.heightMm),
          includeText: true,
          scale: dpi === 300 ? 3 : 2,
          paddingMm: 2.5,
        });
      } catch (error) {
        toast.error(
          `${item.productName}: ${error instanceof Error ? error.message : "invalid barcode"}`,
        );
        return;
      }

      for (let count = 0; count < getCopies(item); count += 1) {
        labelHtml.push(`<section class="label">
          <div class="name">${escapeHtml(item.productName)}</div>
          ${item.variantName ? `<div class="variant">${escapeHtml(item.variantName)}</div>` : ""}
          <div class="barcode">${svg}</div>
          <div class="footer">
            ${showSku ? `<span>SKU ${escapeHtml(item.sku)}</span>` : "<span></span>"}
            ${showPrice ? `<strong>${escapeHtml(formatPrice(item.price))}</strong>` : ""}
          </div>
        </section>`);
      }
    }

    const iframe = document.createElement("iframe");
    iframe.title = "Barcode labels";
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    document.body.appendChild(iframe);
    const target = iframe.contentWindow;
    if (!target) return;
    target.document.open();
    target.document.write(`<!doctype html><html><head><meta charset="utf-8" />
      <title>Barcode labels</title><style>
      @page { size: ${dimensions.widthMm}mm ${dimensions.heightMm}mm; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, sans-serif; }
      .label { width: ${dimensions.widthMm}mm; height: ${dimensions.heightMm}mm; padding: 1.6mm 2mm; overflow: hidden; break-after: page; page-break-after: always; display: flex; flex-direction: column; }
      .label:last-child { break-after: auto; page-break-after: auto; }
      .name { font-size: 8pt; line-height: 1.1; font-weight: 700; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      .variant { font-size: 6.5pt; line-height: 1.1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      .barcode { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
      .barcode svg { display: block; width: 100%; height: 100%; }
      .footer { display: flex; justify-content: space-between; align-items: end; gap: 2mm; font-size: 6.5pt; line-height: 1; }
      .footer span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .footer strong { flex: none; font-size: 8pt; white-space: nowrap; }
      </style></head><body>${labelHtml.join("")}</body></html>`);
    target.document.close();
    const cleanup = () => iframe.remove();
    const print = () => {
      target.focus();
      target.print();
      window.setTimeout(cleanup, 3000);
    };
    if (iframe.contentDocument?.readyState === "complete") print();
    else iframe.addEventListener("load", print, { once: true });
  };

  const downloadCommands = () => {
    if (!canPrint) return;
    try {
      downloadText(`storify-product-labels.${language}`, buildRawJobs().join("\n"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not build the label commands");
    }
  };

  // Fit the preview in the panel: wide labels by width, tall ones by height,
  // and nothing bigger than 5 px per mm.
  const previewScale = Math.min(320 / dimensions.widthMm, 360 / dimensions.heightMm, 5);
  const previewItem = validItems[0];
  let previewSvg = "";
  if (previewItem) {
    try {
      previewSvg = renderBarcodeSvg(previewItem.barcode, {
        format: previewItem.barcodeFormat,
        heightMm: barcodeHeightMm(dimensions.heightMm),
        includeText: true,
        scale: dpi === 300 ? 3 : 2,
      });
    } catch {
      previewSvg = "";
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Barcode className="h-5 w-5" /> Product barcode labels
          </DialogTitle>
          <DialogDescription>
            Print standards-compliant stock labels through the browser or send
            native ZPL/TSPL commands to a thermal printer with QZ Tray.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Label size</Label>
                <SearchableSelect
                  options={SIZE_OPTIONS}
                  ariaLabel="Label size"
                  value={preset}
                  onValueChange={(value) => {
                    const next = value as SizeChoice;
                    // The first time "Custom" is picked it starts from the size
                    // being used, so only what differs has to be typed.
                    if (next === "custom") {
                      setCustomSize((current) => current ?? { ...dimensions });
                    }
                    setPreset(next);
                  }}
                  renderValue={() =>
                    preset === "custom" ? `Custom · ${sizeLabel}` : sizeLabel
                  }
                  searchPlaceholder="Search sizes..."
                  emptyText="No sizes found"
                  // Inside the dialog, whose scroll lock would otherwise
                  // swallow the wheel over the portaled list.
                  modal
                />
              </div>
              <div className="space-y-1.5">
                <Label>Printer language</Label>
                <Select value={language} onValueChange={(value) => setLanguage(value as ThermalPrinterLanguage)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zpl">ZPL / ZPL emulation</SelectItem>
                    <SelectItem value="tspl">TSPL / TSPL emulation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Resolution</Label>
                <Select value={String(dpi)} onValueChange={(value) => setDpi(value === "300" ? 300 : 203)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="203">203 DPI</SelectItem>
                    <SelectItem value="300">300 DPI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {preset === "custom" && customSize ? (
                <div className="space-y-2 sm:col-span-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="label-custom-width">Width (mm)</Label>
                      <NumberInput
                        id="label-custom-width"
                        min={LABEL_SIZE_LIMITS.minWidthMm}
                        max={LABEL_SIZE_LIMITS.maxWidthMm}
                        step={0.5}
                        value={customSize.widthMm}
                        whenEmpty="keep"
                        normalize={roundToTenth}
                        onValueChange={(next) => {
                          if (next === undefined) return;
                          setCustomSize((current) => ({
                            ...(current ?? dimensions),
                            widthMm: next,
                          }));
                        }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="label-custom-height">Height (mm)</Label>
                      <NumberInput
                        id="label-custom-height"
                        min={LABEL_SIZE_LIMITS.minHeightMm}
                        max={LABEL_SIZE_LIMITS.maxHeightMm}
                        step={0.5}
                        value={customSize.heightMm}
                        whenEmpty="keep"
                        normalize={roundToTenth}
                        onValueChange={(next) => {
                          if (next === undefined) return;
                          setCustomSize((current) => ({
                            ...(current ?? dimensions),
                            heightMm: next,
                          }));
                        }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Width {LABEL_SIZE_LIMITS.minWidthMm}–{LABEL_SIZE_LIMITS.maxWidthMm} mm,
                    height {LABEL_SIZE_LIMITS.minHeightMm}–{LABEL_SIZE_LIMITS.maxHeightMm} mm.
                    This size is not saved to the store; this computer remembers the last one you used.
                  </p>
                  {customSize.widthMm > COMMON_PRINTER_WIDTH_MM ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Most desktop thermal printers print up to {COMMON_PRINTER_WIDTH_MM} mm wide.
                      A wider label may be cut off.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-5 rounded-lg border p-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={useStockQuantity} onChange={(event) => setUseStockQuantity(event.target.checked)} />
                Print current on-hand quantity
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showSku} onChange={(event) => setShowSku(event.target.checked)} />
                Show SKU
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showPrice} onChange={(event) => setShowPrice(event.target.checked)} />
                Show price
              </label>
            </div>

            {skippedCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {skippedCount} selected {skippedCount === 1 ? "item has" : "items have"} no
                barcode and will be skipped.
              </p>
            ) : null}

            <div className="max-h-[320px] overflow-y-auto rounded-lg border">
              {items.map((item) => (
                <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_90px] items-center gap-3 border-b p-3 last:border-b-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.productName}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {item.variantName ? `${item.variantName} · ` : ""}{item.barcode || "No barcode"}
                    </p>
                  </div>
                  <NumberInput
                    min={1}
                    max={500}
                    step={1}
                    disabled={useStockQuantity}
                    value={useStockQuantity ? Math.max(1, item.onHand) : copies[item.id] || 1}
                    whenEmpty="keep"
                    normalize={Math.trunc}
                    onValueChange={(next) => {
                      if (next === undefined) return;
                      setCopies((current) => ({ ...current, [item.id]: next }));
                    }}
                    aria-label={`Copies for ${item.productName}`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Print preview</p>
                <p
                  className={
                    preset === "custom"
                      ? "rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {preset === "custom" ? `Custom · ${sizeLabel}` : sizeLabel}
                </p>
              </div>
              <div
                className="mx-auto flex flex-col overflow-hidden bg-white p-3 text-black shadow-sm ring-1 ring-border"
                style={{
                  width: `${dimensions.widthMm * previewScale}px`,
                  height: `${dimensions.heightMm * previewScale}px`,
                }}
              >
                {previewItem ? (
                  <>
                    <p className="truncate text-xs font-bold">{previewItem.productName}</p>
                    {previewItem.variantName ? <p className="truncate text-[10px]">{previewItem.variantName}</p> : null}
                    <div
                      className="flex min-h-0 flex-1 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
                      dangerouslySetInnerHTML={{ __html: previewSvg }}
                    />
                    <div className="flex items-end justify-between gap-1 text-[9px]">
                      <span className="min-w-0 truncate">{showSku ? `SKU ${previewItem.sku}` : ""}</span>
                      <strong className="shrink-0">{showPrice ? formatPrice(previewItem.price) : ""}</strong>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Select inventory items with barcodes</div>
                )}
              </div>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                {validItems.length} SKU · {totalCopies} {totalCopies === 1 ? "label" : "labels"}
              </p>
            </div>

            {problems.length > 0 ? (
              <div
                role="alert"
                className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
              >
                <p className="font-medium">These labels cannot be printed as set up:</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {problems.slice(0, 4).map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
                {problems.length > 4 ? <p>and {problems.length - 4} more.</p> : null}
              </div>
            ) : null}

            <div className="space-y-2 rounded-lg border p-4">
              <div className="flex gap-2">
                <Select value={printerName} onValueChange={setPrinterName}>
                  <SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder="Select QZ printer" /></SelectTrigger>
                  <SelectContent>
                    {printers.map((printer) => <SelectItem key={printer} value={printer}>{printer}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="icon" onClick={discoverPrinters} disabled={isDiscovering} title="Discover printers">
                  {isDiscovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
              </div>
              <Button type="button" className="w-full" onClick={directPrint} disabled={!printerName || isPrinting || !canPrint}>
                {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
                Direct thermal print
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={browserPrint} disabled={!canPrint}>
                <Printer className="mr-2 h-4 w-4" /> Browser / driver print
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={downloadCommands} disabled={!canPrint}>
                <Download className="mr-2 h-4 w-4" /> Download {language.toUpperCase()}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
