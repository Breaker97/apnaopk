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
import { toast } from "@/components/ui/toast-notification";
import { useCurrency } from "@/providers/currency-provider";
import { useAppSettings } from "@/providers/app-settings-provider";
import { renderBarcodeSvg } from "@/lib/barcode/render";
import { detectBarcodeFormat, type BarcodeFormat } from "@/lib/barcode/standards";
import {
  buildTsplProductLabel,
  buildZplProductLabel,
  type ThermalPrinterLanguage,
} from "@/lib/barcode/thermal";
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

type LabelPreset = "40x25" | "50x30" | "60x40";

const PRESETS: Record<LabelPreset, { widthMm: number; heightMm: number }> = {
  "40x25": { widthMm: 40, heightMm: 25 },
  "50x30": { widthMm: 50, heightMm: 30 },
  "60x40": { widthMm: 60, heightMm: 40 },
};

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
  const [preset, setPreset] = React.useState<LabelPreset>("50x30");
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
        preset?: LabelPreset;
      };
      if (stored.printerName) setPrinterName(stored.printerName);
      if (stored.language) setLanguage(stored.language);
      if (stored.dpi) setDpi(stored.dpi);
      if (stored.preset && PRESETS[stored.preset]) setPreset(stored.preset);
    } catch {
      // Ignore a malformed local device profile.
    }
  });

  React.useEffect(() => {
    if (!open) return;
    localStorage.setItem(
      THERMAL_PRINTER_PROFILE_KEY,
      JSON.stringify({ printerName, language, dpi, preset }),
    );
  }, [dpi, language, open, preset, printerName]);

  const dimensions = PRESETS[preset];
  const validItems = React.useMemo(
    () => items.filter((item) => item.barcode.trim()),
    [items],
  );
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
    if (validItems.length === 0) return;
    const labelHtml: string[] = [];
    for (const item of validItems) {
      let svg: string;
      try {
        svg = renderBarcodeSvg(item.barcode, {
          format: item.barcodeFormat,
          heightMm: Math.max(9, dimensions.heightMm * 0.38),
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
      .barcode svg { display: block; width: 100%; max-height: ${Math.max(10, dimensions.heightMm - 10)}mm; }
      .footer { display: flex; justify-content: space-between; align-items: end; gap: 2mm; font-size: 6.5pt; line-height: 1; }
      .footer strong { font-size: 8pt; }
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

  const previewItem = validItems[0];
  let previewSvg = "";
  if (previewItem) {
    try {
      previewSvg = renderBarcodeSvg(previewItem.barcode, {
        format: previewItem.barcodeFormat,
        heightMm: Math.max(9, dimensions.heightMm * 0.38),
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
                <Select value={preset} onValueChange={(value) => setPreset(value as LabelPreset)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="40x25">40 × 25 mm</SelectItem>
                    <SelectItem value="50x30">50 × 30 mm</SelectItem>
                    <SelectItem value="60x40">60 × 40 mm</SelectItem>
                  </SelectContent>
                </Select>
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
              <p className="mb-3 text-sm font-medium">Print preview</p>
              <div
                className="mx-auto flex flex-col overflow-hidden bg-white p-3 text-black shadow-sm ring-1 ring-border"
                style={{
                  width: `${Math.min(320, dimensions.widthMm * 5)}px`,
                  aspectRatio: `${dimensions.widthMm}/${dimensions.heightMm}`,
                }}
              >
                {previewItem ? (
                  <>
                    <p className="truncate text-xs font-bold">{previewItem.productName}</p>
                    {previewItem.variantName ? <p className="truncate text-[10px]">{previewItem.variantName}</p> : null}
                    <div className="flex min-h-0 flex-1 items-center" dangerouslySetInnerHTML={{ __html: previewSvg }} />
                    <div className="flex justify-between text-[9px]">
                      <span>{showSku ? `SKU ${previewItem.sku}` : ""}</span>
                      <strong>{showPrice ? formatPrice(previewItem.price) : ""}</strong>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Select inventory items with barcodes</div>
                )}
              </div>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                {validItems.length} SKU · {totalCopies} labels
              </p>
            </div>

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
              <Button type="button" className="w-full" onClick={directPrint} disabled={!printerName || isPrinting || validItems.length === 0}>
                {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
                Direct thermal print
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={browserPrint} disabled={validItems.length === 0}>
                <Printer className="mr-2 h-4 w-4" /> Browser / driver print
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => downloadText(`storify-product-labels.${language}`, buildRawJobs().join("\n"))} disabled={validItems.length === 0}>
                <Download className="mr-2 h-4 w-4" /> Download {language.toUpperCase()}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
