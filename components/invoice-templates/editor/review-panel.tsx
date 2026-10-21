"use client";

/**
 * The Review tab (§5.5): every warning about the design by element name — an
 * element outside the printable area, two that overlap, a bound field the
 * category never has, a barcode that can't be drawn or is too small to scan,
 * a QR code under 15 mm or with an address Save would refuse, text that still
 * overflows after shrink-to-fit — and a live preview of the template with
 * sample data, or with a real order loaded by its number (read-only, through
 * `print-context`; nothing about the order changes).
 *
 * The rules live in lib/invoice-templates/editor/review.ts; this file words
 * them and draws the list. A click on a warning selects the element(s) it is
 * about. The toolbar's chip shows the same count.
 */
import { useDeferredValue, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CircleCheck, Loader2, OctagonAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TemplatePreview } from "@/components/invoice-templates/preview/template-preview";
import { useOrderContext } from "@/components/invoice-templates/preview/use-order-context";
import { MIN_MODULE_WIDTH_MM } from "@/lib/invoice-templates/barcode";
import { reviewWarnings, type ReviewWarning } from "@/lib/invoice-templates/editor/review";
import { designUsesInternalNote, getField } from "@/lib/invoice-templates/fields";
import type { FieldKey } from "@/lib/invoice-templates/field-keys";
import { MIN_QR_SIZE_MM } from "@/lib/invoice-templates/qr";
import { sampleContext } from "@/lib/invoice-templates/sample-context";
import { cn } from "@/lib/utils";
import { useEditor, useEditorApi } from "./editor-store";
import { EDITOR_CARD_CLASS, EDITOR_HINT_CLASS, EDITOR_TITLE_CLASS } from "./editor-styles";
import { ChoiceSelect, Field, Segmented } from "./panel-fields";

/** The warnings for the design as it stands (the chip and the tab read the same list). */
export function useReviewWarnings(): ReviewWarning[] {
  const design = useEditor((state) => state.design);
  const category = useEditor((state) => state.category);
  const fits = useEditor((state) => state.fits);
  // A drag repaints every frame; the list can follow a beat later.
  const deferred = useDeferredValue(design);
  const sample = useMemo(() => sampleContext(category, deferred.locale), [category, deferred.locale]);
  return useMemo(() => reviewWarnings({ design: deferred, category, sample, fits }), [deferred, category, sample, fits]);
}

/** One warning in words, in the admin's language. */
export function useWarningText(): (warning: ReviewWarning) => string {
  const t = useTranslations("admin.invoiceTemplates.editor.review.rules");
  const tCategory = useTranslations("admin.invoiceTemplates.editor.review.categories");
  const tSource = useTranslations("admin.invoiceTemplates.editor.review.sources");
  const tHint = useTranslations("admin.invoiceTemplates.editor.props.config.barcode.formatHints");
  const tFormat = useTranslations("admin.invoiceTemplates.editor.props.config.barcode.formats");
  const language = useLocale() === "bn" ? "bn" : "en";
  const category = useEditor((state) => state.category);
  const name = (warning: ReviewWarning) => warning.names[0] ?? "";

  return (warning) => {
    const detail = warning.detail;
    switch (warning.rule) {
      case "outOfBounds":
        return t("outOfBounds", { name: name(warning) });
      case "overlap":
        return t("overlap", { name: warning.names[0] ?? "", other: warning.names[1] ?? "" });
      case "fieldUnavailable":
        return t("fieldUnavailable", { name: name(warning), field: getField(detail.field as FieldKey).label[language], category: tCategory(category) });
      case "sourceUnavailable":
        return t("sourceUnavailable", { name: name(warning), source: tSource(String(detail.source)), category: tCategory(category) });
      case "barcodeError": {
        const format = String(detail.format) as "code128" | "ean13" | "upca";
        switch (detail.code) {
          case "empty":
            return t("barcodeEmpty", { name: name(warning) });
          case "invalid":
            return t("barcodeInvalid", { name: name(warning), format: tFormat(format), hint: tHint(format) });
          case "formatNotAllowed":
            return t("barcodeFormat", { name: name(warning), format: tFormat(format) });
          default:
            return t("barcodeRender", { name: name(warning) });
        }
      }
      case "barcodeTooSmall":
        return t("barcodeTooSmall", { name: name(warning), width: Number(detail.widthMm).toFixed(2), min: MIN_MODULE_WIDTH_MM });
      case "qrError":
        return t(detail.code === "badUrl" ? "qrBadUrl" : detail.code === "empty" ? "qrEmpty" : "qrInvalid", { name: name(warning) });
      case "qrTooSmall":
        return t("qrTooSmall", { name: name(warning), size: Number(detail.sizeMm).toFixed(1), min: MIN_QR_SIZE_MM });
      case "textOverflow":
        return t("textOverflow", { name: name(warning) });
    }
  };
}

const ITEM_COUNTS = [3, 12, 60] as const;

export function ReviewPanel() {
  const t = useTranslations("admin.invoiceTemplates.editor.review");
  const api = useEditorApi();
  const warnings = useReviewWarnings();
  const wording = useWarningText();
  const selection = useEditor((state) => state.selection);
  const design = useEditor((state) => state.design);
  const category = useEditor((state) => state.category);
  const deferredDesign = useDeferredValue(design);

  const [source, setSource] = useState<"sample" | "order">("sample");
  const [items, setItems] = useState<number>(ITEM_COUNTS[0]);
  const [orderRef, setOrderRef] = useState("");
  const order = useOrderContext(category, design.locale, designUsesInternalNote(design));
  const sample = useMemo(() => sampleContext(category, design.locale, { items }), [category, design.locale, items]);
  const context = source === "order" && order.state.status === "loaded" ? order.state.context : sample;

  return (
    <div className="space-y-2 p-3" data-review-panel="" data-warning-count={warnings.length}>
      <section aria-label={t("warnings")} className={EDITOR_CARD_CLASS}>
        <h3 className={cn("px-3 py-2.5", EDITOR_TITLE_CLASS)}>{t("warnings")}</h3>
        <div className="space-y-2 border-t border-border px-3 py-3">
          {warnings.length === 0 ? (
            <p className="flex items-center gap-2 rounded-[8px] border border-dashed border-border px-3 py-4 text-xs text-muted-foreground" data-review-empty="">
              <CircleCheck aria-hidden className="size-4 shrink-0 text-emerald-600" />
              {t("none")}
            </p>
          ) : (
            <>
              <p className={EDITOR_HINT_CLASS}>{t("summary", { count: warnings.length })}</p>
              <ul className="space-y-1.5">
                {warnings.map((warning) => {
                  const selected = warning.elementIds.every((id) => selection.includes(id)) && selection.length === warning.elementIds.length;
                  const Icon = warning.severity === "problem" ? OctagonAlert : TriangleAlert;
                  return (
                    <li key={warning.key}>
                      <button
                        type="button"
                        data-review-rule={warning.rule}
                        data-review-severity={warning.severity}
                        data-review-elements={warning.elementIds.join(" ")}
                        aria-pressed={selected}
                        title={t("select")}
                        onClick={() => api.getState().select(warning.elementIds)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-[8px] border px-2.5 py-2 text-start text-xs leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          warning.severity === "problem"
                            ? "border-destructive/40 bg-destructive/5 hover:bg-destructive/10"
                            : "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10",
                          selected && "ring-2 ring-primary/40",
                        )}
                      >
                        <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", warning.severity === "problem" ? "text-destructive" : "text-amber-600")} />
                        <span>{wording(warning)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </section>

      <section aria-label={t("preview.title")} className={EDITOR_CARD_CLASS} data-review-preview="">
        <h3 className={cn("px-3 py-2.5", EDITOR_TITLE_CLASS)}>{t("preview.title")}</h3>
        <div className="space-y-3 border-t border-border px-3 py-3">
          <Segmented
            label={t("preview.source")}
            field="review.source"
            value={source}
            options={[
              { value: "sample", label: t("preview.sample") },
              { value: "order", label: t("preview.order") },
            ]}
            onChange={setSource}
          />
          {source === "sample" ? (
            <Field label={t("preview.items")}>
              {(id) => (
                <ChoiceSelect
                  id={id}
                  field="review.items"
                  value={String(items)}
                  options={ITEM_COUNTS.map((count) => ({ value: String(count), label: t("preview.itemCount", { count }) }))}
                  onChange={(value) => setItems(Number(value))}
                />
              )}
            </Field>
          ) : (
            <form
              className="space-y-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                void order.load(orderRef);
              }}
            >
              <Field label={t("preview.orderNumber")}>
                {(id) => (
                  <div className="flex gap-1.5">
                    <Input id={id} data-field="review.order" className="h-8" value={orderRef} placeholder={t("preview.orderPlaceholder")} onChange={(event) => setOrderRef(event.target.value)} />
                    <Button type="submit" size="sm" className="h-8 shrink-0 rounded-[8px] px-3 text-xs" data-action="review-load" disabled={!orderRef.trim() || order.state.status === "loading"}>
                      {order.state.status === "loading" && <Loader2 aria-hidden className="size-4 animate-spin" />}
                      {t("preview.load")}
                    </Button>
                  </div>
                )}
              </Field>
              <p className="text-xs text-muted-foreground" role="status" data-review-order-status={order.state.status}>
                {order.state.status === "loaded"
                  ? t("preview.loaded", { number: order.state.context.order.number })
                  : order.state.status === "error"
                    ? order.state.error === "notFound"
                      ? t("preview.notFound", { ref: order.state.ref })
                      : t("preview.failed")
                    : order.state.status === "loading"
                      ? t("preview.loading")
                      : t("preview.readOnly")}
              </p>
              {source === "order" && order.state.status !== "loaded" && <p className="text-xs text-muted-foreground">{t("preview.showingSample")}</p>}
            </form>
          )}
          <div className="max-h-[28rem] overflow-y-auto rounded-[8px] bg-muted/50" data-review-preview-box="">
            <TemplatePreview design={deferredDesign} context={context} />
          </div>
        </div>
      </section>
    </div>
  );
}
