"use client";

/**
 * Test Print (§5.2): the template as it stands, saved or not, at real size
 * with clearly marked sample data, or with a real order picked by number
 * (read through `print-context`), then the browser's print dialog through
 * `printTemplate`. Nothing is saved and nothing about the order changes.
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Printer } from "lucide-react";
import type { RenderMeasure } from "@/components/invoice-templates/renderer/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast-notification";
import { designUsesInternalNote } from "@/lib/invoice-templates/fields";
import { printTemplate, type PrintFailure } from "@/lib/invoice-templates/print";
import { sampleContext } from "@/lib/invoice-templates/sample-context";
import type { TemplateCategory, TemplateDesign } from "@/lib/invoice-templates/types";
import { measureReady, TemplatePreview } from "./template-preview";
import { useOrderContext } from "./use-order-context";

/** Sample sizes on offer: one page, a few rows, a long order that flows over pages. */
export const SAMPLE_ITEM_COUNTS = [3, 12, 60] as const;

export interface TestPrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The template as it stands in the editor; it need not be saved. */
  design: TemplateDesign;
  category: TemplateCategory;
  name?: string;
}

export function TestPrintDialog({ open, onOpenChange, design, category, name }: TestPrintDialogProps) {
  const t = useTranslations("admin.invoiceTemplates.preview");
  const [source, setSource] = useState<"sample" | "order">("sample");
  const [items, setItems] = useState<number>(SAMPLE_ITEM_COUNTS[0]);
  const [orderRef, setOrderRef] = useState("");
  const [measure, setMeasure] = useState<RenderMeasure | null>(null);
  const [printing, setPrinting] = useState(false);
  const order = useOrderContext(category, design.locale, designUsesInternalNote(design));

  const sample = useMemo(() => sampleContext(category, design.locale, { items }), [category, design.locale, items]);
  const context = source === "order" && order.state.status === "loaded" ? order.state.context : sample;
  const ready = measureReady(design, context, measure);

  const print = useCallback(async () => {
    setPrinting(true);
    try {
      await printTemplate({
        design,
        context,
        measure,
        title: name,
        onFallback: (reason: PrintFailure) => toast.error(t(`printFailed.${reason}`)),
      });
    } finally {
      setPrinting(false);
    }
  }, [design, context, measure, name, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-4 sm:max-w-5xl" data-test-print-dialog="">
        <DialogHeader>
          <DialogTitle>{name ? t("testPrint.titleNamed", { name }) : t("testPrint.title")}</DialogTitle>
          <DialogDescription>{t("testPrint.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t("source")}</span>
            <Select value={source} onValueChange={(value) => setSource(value as "sample" | "order")}>
              <SelectTrigger className="w-44" aria-label={t("source")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sample">{t("sampleData")}</SelectItem>
                <SelectItem value="order">{t("realOrder")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {source === "sample" ? (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t("sampleSize")}</span>
              <Select value={String(items)} onValueChange={(value) => setItems(Number(value))}>
                <SelectTrigger className="w-36" aria-label={t("sampleSize")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SAMPLE_ITEM_COUNTS.map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {t("itemCount", { count })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <OrderPicker value={orderRef} onChange={setOrderRef} order={order} />
          )}
        </div>

        <p className="text-xs text-muted-foreground">{t("printHint")}</p>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <TemplatePreview design={design} context={context} onMeasure={setMeasure} />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
          <Button type="button" onClick={print} disabled={printing || !ready} data-action="print">
            {printing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Printer className="h-4 w-4" aria-hidden />}
            {printing ? t("printing") : t("print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Order number → Load"; shows what loaded or why it didn't. */
export function OrderPicker({
  value,
  onChange,
  order,
}: {
  value: string;
  onChange: (value: string) => void;
  order: ReturnType<typeof useOrderContext>;
}) {
  const t = useTranslations("admin.invoiceTemplates.preview");
  const { state } = order;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        // React bubbles a portal's submit to the editor's own form; keep it here.
        event.preventDefault();
        event.stopPropagation();
        void order.load(value);
      }}
    >
      <label className="space-y-1">
        <span className="block text-xs font-medium text-muted-foreground">{t("orderNumber")}</span>
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("orderPlaceholder")}
          className="w-48"
          autoComplete="off"
        />
      </label>
      <Button type="submit" variant="secondary" disabled={!value.trim() || state.status === "loading"}>
        {state.status === "loading" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {t("load")}
      </Button>
      <span className="pb-2 text-xs" role="status">
        {state.status === "loaded" && <span className="text-muted-foreground">{t("orderLoaded", { number: state.context.order.number })}</span>}
        {state.status === "error" && <span className="text-destructive">{t(`orderError.${state.error}`)}</span>}
      </span>
    </form>
  );
}
