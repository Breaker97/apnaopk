"use client";

import * as React from "react";
import {
  Search,
  ScanBarcode,
  Camera,
  Calculator,
  Fullscreen,
  Minimize,
  SlidersHorizontal,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { BarcodeCameraDialog } from "@/components/pos/barcode-camera-dialog";
import { POSCalculatorDialog } from "@/components/pos/pos-calculator-dialog";

type POSStockStatusFilter = "all" | "in_stock" | "out_of_stock";

type POSScanSource = "hardware" | "camera";
type POSScanFeedback = {
  status: "success" | "error";
  code: string;
  message: string;
  detail?: string;
};

interface POSSearchBarProps {
  className?: string;

  /**
   * Rendered first in the bar, before the search field. The counter badge lives
   * here rather than among the filters on purpose: "which register is this" is
   * read before anything is typed, and the slot keeps that decision with the
   * workspace that owns the location instead of burying it in this component.
   */
  leading?: React.ReactNode;

  // Search
  searchQuery: string;
  onSearchChange: (value: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;

  // Scan
  scanQuery: string;
  onScanQueryChange: (value: string) => void;
  onScanKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  scanInputRef: React.RefObject<HTMLInputElement | null>;
  isScanResolving: boolean;
  scanQueueLength: number;
  lastScanFeedback: POSScanFeedback | null;
  onOpenCameraScanner: () => void;
  showCameraScanner: boolean;
  onCameraOpenChange: (open: boolean) => void;
  onCameraScan: (code: string, source?: POSScanSource) => void;

  // Filters
  stockStatus: POSStockStatusFilter;
  onStockStatusChange: (value: POSStockStatusFilter) => void;
  /**
   * Source and vendor only exist as concepts when the register may sell vendor
   * stock; a single-vendor shop should not see two dead dropdowns.
   */
}

export function POSSearchBar({
  className,
  leading,
  searchQuery,
  onSearchChange,
  searchInputRef,
  scanQuery,
  onScanQueryChange,
  onScanKeyDown,
  scanInputRef,
  isScanResolving,
  scanQueueLength,
  lastScanFeedback,
  onOpenCameraScanner,
  showCameraScanner,
  onCameraOpenChange,
  onCameraScan,
  stockStatus,
  onStockStatusChange,
}: POSSearchBarProps) {
  const [showCalculatorDialog, setShowCalculatorDialog] = React.useState(false);
  const [showFilterSheet, setShowFilterSheet] = React.useState(false);
  const { isFullscreen, toggleFullscreen } = useFullscreen();

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;

      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.key.toLowerCase() === "c" &&
        !showCameraScanner &&
        !showCalculatorDialog
      ) {
        event.preventDefault();
        setShowCalculatorDialog(true);
        return;
      }

      if (event.key === "F8" && !showCameraScanner && !showCalculatorDialog) {
        event.preventDefault();
        scanInputRef.current?.focus();
        return;
      }

      if (
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !isInEditable &&
        !showCameraScanner &&
        !showCalculatorDialog
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [scanInputRef, searchInputRef, showCalculatorDialog, showCameraScanner]);

  const activeFilterCount = stockStatus !== "all" ? 1 : 0;

  const resetFilters = () => {
    onStockStatusChange("all");
  };

  return (
    <>
      <div
        className={cn(
          "shrink-0 rounded-2xl border border-border/60 bg-card p-2 shadow-sm sm:p-2.5",
          className,
        )}
      >
        {/* Phones get two rows — search + filters, then scan + tools — with the
            filter selects moved into a bottom sheet so nothing is cut off. At
            lg the two rows merge and the selects come back inline; at xl the
            wrapper groups become `display: contents` for a single row. */}
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center xl:contents">
            {/* Search + filter sheet trigger */}
            <div className="flex min-w-0 items-center gap-2 lg:flex-1 xl:contents">
              {leading}
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  ref={searchInputRef}
                  placeholder="Search products by name / SKU..."
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="h-11 rounded-xl border border-border/60 bg-card pl-11 pr-11 text-sm placeholder:text-muted-foreground/60 transition-all focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20 xl:h-10"
                />
                {searchQuery ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full hover:bg-muted"
                    onClick={() => onSearchChange("")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>

              <Button
                variant="outline"
                onClick={() => setShowFilterSheet(true)}
                aria-label="Filters"
                className="relative h-11 w-11 shrink-0 gap-1.5 rounded-xl p-0 min-[360px]:w-auto min-[360px]:px-3 lg:hidden"
              >
                <SlidersHorizontal className="h-4 w-4" />
                {/* The tightest phones keep the icon only so the search field
                    does not lose more width than the label is worth. */}
                <span className="hidden text-sm font-medium min-[360px]:inline">
                  Filters
                </span>
                {activeFilterCount > 0 ? (
                  <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                    {activeFilterCount}
                  </span>
                ) : null}
              </Button>
            </div>

            {/* Scan input + tool buttons */}
            <div className="flex min-w-0 items-center gap-2 lg:flex-1 xl:contents">
              <div className="relative min-w-0 flex-1 xl:w-65 xl:flex-none">
                <ScanBarcode className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Input
                      ref={scanInputRef}
                      placeholder="Scan SKU or barcode..."
                      value={scanQuery}
                      onChange={(e) => onScanQueryChange(e.target.value)}
                      onKeyDown={onScanKeyDown}
                      className="h-11 rounded-xl border border-border/60 bg-card pl-11 pr-12 font-mono text-sm tracking-[0.12em] placeholder:font-sans placeholder:tracking-normal placeholder:text-muted-foreground/60 transition-all focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20 lg:pr-14 xl:h-10"
                    />
                  </TooltipTrigger>
                  <TooltipContent>Scan SKU and Barcode</TooltipContent>
                </Tooltip>
                {!scanQuery ? (
                  <>
                    {/* Below lg the standalone status chip is gone, so the scan
                        field itself carries the ready/resolving indicator. */}
                    <span
                      className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 lg:hidden"
                      title={isScanResolving ? "Resolving" : "Ready to scan"}
                    >
                      {isScanResolving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      )}
                      {scanQueueLength > 0 ? (
                        <span className="rounded-full bg-emerald-500/15 px-1 font-mono text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                          +{scanQueueLength}
                        </span>
                      ) : null}
                      <span className="sr-only">
                        {isScanResolving ? "Resolving" : "Ready to scan"}
                      </span>
                    </span>
                    <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-xs lg:inline-block">
                      F8
                    </span>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full hover:bg-muted"
                    onClick={() => onScanQueryChange("")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {/* Camera button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0 rounded-xl xl:h-10 xl:w-10"
                    onClick={onOpenCameraScanner}
                    aria-label="Scan with Camera"
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Scan with Camera</TooltipContent>
              </Tooltip>

              {/* Calculator button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0 rounded-xl xl:h-10 xl:w-10"
                    onClick={() => setShowCalculatorDialog(true)}
                    aria-label="Calculator ALT+C"
                  >
                    <Calculator className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Calculator ALT+C</TooltipContent>
              </Tooltip>

              {/* Fullscreen button — pointless on touch devices, so phone-sized
                  screens get the space back instead. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="hidden h-11 w-11 shrink-0 rounded-xl sm:inline-flex xl:h-10 xl:w-10"
                    onClick={() => void toggleFullscreen()}
                    aria-label={
                      isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
                    }
                  >
                    {isFullscreen ? (
                      <Minimize className="h-4 w-4" />
                    ) : (
                      <Fullscreen className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Scan status + inline filters — lg and up only */}
          <div className="hidden items-center gap-2 lg:flex xl:contents">
            <div className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-700 dark:text-emerald-300 xl:h-10">
              {isScanResolving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ScanBarcode className="h-3.5 w-3.5" />
              )}
              <span>{isScanResolving ? "Resolving" : "Ready to scan"}</span>
              {scanQueueLength > 0 ? (
                <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 font-mono">
                  +{scanQueueLength}
                </span>
              ) : null}
            </div>

            <Select
              value={stockStatus}
              onValueChange={(value) =>
                onStockStatusChange(value as POSStockStatusFilter)
              }
            >
              <SelectTrigger className="h-11 w-37.5 shrink-0 rounded-lg border border-border/60 bg-card text-sm shadow-xs transition-colors hover:bg-muted/40 xl:h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stock</SelectItem>
                <SelectItem value="in_stock">In stock</SelectItem>
                <SelectItem value="out_of_stock">Out of stock</SelectItem>
              </SelectContent>
            </Select>

          </div>
        </div>

        {lastScanFeedback ? (
          <div
            className={cn(
              "mt-2 inline-flex h-8 max-w-full items-center gap-2 rounded-full border px-3 text-xs font-medium",
              lastScanFeedback.status === "success"
                ? "border-primary/25 bg-primary/10 text-primary"
                : "border-destructive/30 bg-destructive/10 text-destructive",
            )}
          >
            <span className="truncate">
              {lastScanFeedback.status === "success"
                ? "Last scanned"
                : "Scan issue"}
              : {lastScanFeedback.message}
            </span>
            <span className="shrink-0 font-mono opacity-70">
              {lastScanFeedback.code}
            </span>
          </div>
        ) : null}
      </div>

      {/* Filter sheet — the phone/tablet stand-in for the inline selects. */}
      <Sheet open={showFilterSheet} onOpenChange={setShowFilterSheet}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] gap-0 rounded-t-2xl lg:hidden"
        >
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>Narrow down the product list</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 overflow-y-auto px-4 pb-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Stock
              </label>
              <Select
                value={stockStatus}
                onValueChange={(value) =>
                  onStockStatusChange(value as POSStockStatusFilter)
                }
              >
                <SelectTrigger className="h-11 w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-100">
                  <SelectItem value="all">All stock</SelectItem>
                  <SelectItem value="in_stock">In stock</SelectItem>
                  <SelectItem value="out_of_stock">Out of stock</SelectItem>
                </SelectContent>
              </Select>
            </div>

          </div>

          <SheetFooter className="flex-row gap-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <Button
              variant="outline"
              className="h-11 flex-1 rounded-xl"
              onClick={resetFilters}
              disabled={activeFilterCount === 0}
            >
              Reset
            </Button>
            <Button
              className="h-11 flex-1 rounded-xl"
              onClick={() => setShowFilterSheet(false)}
            >
              Show results
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <BarcodeCameraDialog
        open={showCameraScanner}
        onOpenChange={onCameraOpenChange}
        onScan={onCameraScan}
        isResolving={isScanResolving}
      />
      <POSCalculatorDialog
        open={showCalculatorDialog}
        onOpenChange={setShowCalculatorDialog}
      />
    </>
  );
}
