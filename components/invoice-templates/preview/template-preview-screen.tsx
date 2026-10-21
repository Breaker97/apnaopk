"use client";

/**
 * The preview route's screen (`/admin/invoice-templates/preview`, and a
 * vendor owner's `/vendor/invoice-templates/preview` on the vendor scope): a saved
 * template (`?id=`) or a built-in preset (`?preset=&lang=`), at real size,
 * with sample data of any length (`?items=`) or a real order (`?order=`),
 * plus Print and Test Print. The choices are mirrored into the URL so a
 * preview can be linked to. Read-only: nothing here saves or changes data.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Printer, ScanSearch } from "lucide-react";
import type { RenderMeasure } from "@/components/invoice-templates/renderer/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast-notification";
import { designUsesInternalNote } from "@/lib/invoice-templates/fields";
import { printTemplate, type PrintFailure } from "@/lib/invoice-templates/print";
import { buildPresetDesign, PRESET_KEYS, presetName, TEMPLATE_PRESETS, type PresetKey } from "@/lib/invoice-templates/presets";
import { sampleContext } from "@/lib/invoice-templates/sample-context";
import { TEMPLATE_LOCALES, type TemplateCategory, type TemplateDesign, type TemplateLocale } from "@/lib/invoice-templates/types";
import { measureReady, TemplatePreview } from "./template-preview";
import { OrderPicker, SAMPLE_ITEM_COUNTS, TestPrintDialog } from "./test-print-dialog";
import { useOrderContext } from "./use-order-context";

export type PreviewSource =
  | { kind: "template"; design: TemplateDesign; category: TemplateCategory; name: string; id: string }
  | { kind: "preset"; preset: PresetKey; lang: TemplateLocale };

export interface TemplatePreviewScreenProps {
  source: PreviewSource;
  items: number;
  order: string | null;
}

export function TemplatePreviewScreen({ source: initialSource, items: initialItems, order: initialOrder }: TemplatePreviewScreenProps) {
  const t = useTranslations("admin.invoiceTemplates.preview");
  const uiLocale: TemplateLocale = useLocale() === "bn" ? "bn" : "en";
  const [source, setSource] = useState(initialSource);
  const [items, setItems] = useState(initialItems);
  const [orderRef, setOrderRef] = useState(initialOrder ?? "");
  const [measure, setMeasure] = useState<RenderMeasure | null>(null);
  const [printing, setPrinting] = useState(false);
  const [testOpen, setTestOpen] = useState(false);

  const design = useMemo(
    () => (source.kind === "template" ? source.design : buildPresetDesign(source.preset, source.lang)),
    [source],
  );
  const category = source.kind === "template" ? source.category : TEMPLATE_PRESETS[source.preset].category;
  const name = source.kind === "template" ? source.name : presetName(source.preset, uiLocale);

  // The order asked for; it is fetched again when the category or language changes.
  const [requested, setRequested] = useState({ ref: initialOrder?.trim() ?? "", attempt: 0 });
  const order = useOrderContext(category, design.locale, designUsesInternalNote(design));
  const { load: loadOrder, clear: clearOrder } = order;
  useEffect(() => {
    if (requested.ref) void loadOrder(requested.ref);
    else clearOrder();
  }, [requested, loadOrder, clearOrder]);
  const picker = useMemo(
    () => ({ ...order, load: async (ref: string) => setRequested((previous) => ({ ref: ref.trim(), attempt: previous.attempt + 1 })) }),
    [order],
  );

  const sample = useMemo(() => sampleContext(category, design.locale, { items }), [category, design.locale, items]);
  const context = order.state.status === "loaded" ? order.state.context : sample;
  const ready = measureReady(design, context, measure);

  // Mirror the choices into the URL (no navigation; Next keeps its router in step with replaceState).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete("id");
    params.delete("preset");
    params.delete("lang");
    if (source.kind === "template") params.set("id", source.id);
    else {
      params.set("preset", source.preset);
      params.set("lang", source.lang);
    }
    params.set("items", String(items));
    if (order.state.status === "loaded") params.set("order", order.state.ref);
    else if (order.state.status === "idle") params.delete("order");
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params}`);
  }, [source, items, order.state]);

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
    <div className="mx-auto max-w-6xl space-y-6" data-template-preview-screen="">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        {source.kind === "preset" ? (
          <>
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t("preset")}</span>
              <Select value={source.preset} onValueChange={(value) => setSource({ ...source, preset: value as PresetKey })}>
                <SelectTrigger className="w-64" aria-label={t("preset")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {t(`categories.${TEMPLATE_PRESETS[key].category}`)} · {presetName(key, uiLocale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t("language")}</span>
              <Select value={source.lang} onValueChange={(value) => setSource({ ...source, lang: value as TemplateLocale })}>
                <SelectTrigger className="w-36" aria-label={t("language")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_LOCALES.map((lang) => (
                    <SelectItem key={lang} value={lang}>
                      {t(`languages.${lang}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : (
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t(`categories.${category}`)}</span>
            <p className="flex h-9 items-center font-medium">{name}</p>
          </div>
        )}

        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("sampleSize")}</span>
          <Select value={String(items)} onValueChange={(value) => setItems(Number(value))}>
            <SelectTrigger className="w-36" aria-label={t("sampleSize")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from(new Set([...SAMPLE_ITEM_COUNTS, items])).sort((a, b) => a - b).map((count) => (
                <SelectItem key={count} value={String(count)}>
                  {t("itemCount", { count })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <OrderPicker
          value={orderRef}
          onChange={(value) => {
            setOrderRef(value);
            if (!value.trim()) setRequested((previous) => ({ ref: "", attempt: previous.attempt + 1 }));
          }}
          order={picker}
        />

        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" onClick={() => setTestOpen(true)}>
            <ScanSearch className="h-4 w-4" aria-hidden />
            {t("testPrint.button")}
          </Button>
          <Button type="button" onClick={print} disabled={printing || !ready} data-action="print-page">
            {printing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Printer className="h-4 w-4" aria-hidden />}
            {printing ? t("printing") : t("print")}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t("printHint")}</p>

      <TemplatePreview design={design} context={context} onMeasure={setMeasure} />

      {testOpen && <TestPrintDialog open={testOpen} onOpenChange={setTestOpen} design={design} category={category} name={name} />}
    </div>
  );
}
