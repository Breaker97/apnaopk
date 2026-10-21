"use client";

/**
 * The Barcode and QR settings (§5.7). Each shows, under its settings, what
 * the code would encode for the sample order, the reason when it can't be
 * drawn (an inline error, in words), and the scan-size warnings: a barcode
 * whose narrowest bar is under 0.25 mm at print size, a QR code under 15 mm.
 * The checks draw the code the renderer draws (lib/invoice-templates/editor/
 * code-checks.ts), so the panel and the page can't disagree.
 *
 * D-12: a bound value (order number, tracking number) is Code 128; EAN-13 and
 * UPC-A are offered only for fixed text, and choosing a bound source puts the
 * format back to Code 128 in the same step.
 */
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { MIN_MODULE_WIDTH_MM, allowedBarcodeFormats } from "@/lib/invoice-templates/barcode";
import { barcodeCheck, qrCheck, qrUrlProblem } from "@/lib/invoice-templates/editor/code-checks";
import { MIN_QR_SIZE_MM } from "@/lib/invoice-templates/qr";
import { sampleContext } from "@/lib/invoice-templates/sample-context";
import type { BarcodeConfig, QrConfig, TemplateElementOf } from "@/lib/invoice-templates/types";
import { useEditor } from "../editor-store";
import { ChoiceSelect, Field, UnitInput } from "../panel-fields";
import { ConfigSection, useConfigEdit } from "./config-section";

function useSample() {
  const category = useEditor((state) => state.category);
  const locale = useEditor((state) => state.design.locale);
  return useMemo(() => sampleContext(category, locale), [category, locale]);
}

/** The red line for something that stops the code from printing. */
function Problem({ children, code }: { children: string; code: string }) {
  return (
    <p role="alert" data-issue={code} className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
      {children}
    </p>
  );
}

/** The amber line for something that prints but may not scan. */
function Caution({ children, code }: { children: string; code: string }) {
  return (
    <p role="note" data-warning={code} className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-300">
      {children}
    </p>
  );
}

const FORMATS = ["code128", "ean13", "upca"] as const;

export function BarcodeConfigPanel({ element }: { element: TemplateElementOf<"barcode"> }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.config.barcode");
  const { set, update } = useConfigEdit<"barcode">(element);
  const sample = useSample();
  const { source, value, format, showText, textSizePx } = element.config;
  const check = useMemo(() => barcodeCheck(element, sample), [element, sample]);
  const formatName = t(`formats.${format}`);
  const allowed = allowedBarcodeFormats(source);

  return (
    <ConfigSection element={element} hint={t("sizeHint")}>
      <Field label={t("source")}>
        {(id) => (
          <ChoiceSelect
            id={id}
            field="config.source"
            value={source}
            options={(["orderNumber", "trackingNumber", "fixed"] as const).map((each) => ({ value: each, label: t(`sources.${each}`) }))}
            // A bound value is always Code 128 (D-12): the format goes back with the source, in one step.
            onChange={(next) => update(() => ({ source: next, ...(next === "fixed" ? {} : { format: "code128" as const }) }) satisfies Partial<BarcodeConfig>)}
          />
        )}
      </Field>
      {source === "fixed" && (
        <Field label={t("value")}>
          {(id) => (
            <Input id={id} data-field="config.value" className="h-8 font-mono text-xs" maxLength={80} value={value ?? ""} onChange={(event) => set({ value: event.target.value }, "value")} />
          )}
        </Field>
      )}
      <Field label={t("format")}>
        {(id) => (
          <ChoiceSelect
            id={id}
            field="config.format"
            value={format}
            disabled={allowed.length === 1}
            options={FORMATS.filter((each) => allowed.includes(each)).map((each) => ({ value: each, label: t(`formats.${each}`) }))}
            onChange={(next) => set({ format: next })}
          />
        )}
      </Field>
      {allowed.length === 1 && <p className="text-xs text-muted-foreground">{t("boundHint")}</p>}
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>{t("showText")}</span>
        <Switch data-field="config.showText" checked={showText} onCheckedChange={(next) => set({ showText: next })} aria-label={t("showText")} />
      </label>
      {showText && (
        <Field label={t("textSize")}>
          {(id) => <UnitInput id={id} field="config.textSizePx" unit="px" value={textSizePx} min={4} max={48} step={0.5} normalize={(each) => Math.round(each * 10) / 10} onChange={(next) => set({ textSizePx: next }, "textSizePx")} />}
        </Field>
      )}

      <div className="space-y-1.5" data-code-check="barcode">
        {check.issue ? (
          <Problem code={check.issue.code}>
            {check.issue.code === "empty"
              ? source === "fixed"
                ? t("issues.emptyFixed")
                : t("issues.emptyBound", { source: t(`nouns.${source}`) })
              : check.issue.code === "invalid"
                ? t("issues.invalid", { format: formatName, hint: t(`formatHints.${format}`) })
                : check.issue.code === "formatNotAllowed"
                  ? t("issues.formatNotAllowed", { format: formatName })
                  : t("issues.renderFailed")}
          </Problem>
        ) : (
          <>
            <p className="text-xs text-muted-foreground" data-code-value={check.value ?? ""}>
              {source === "fixed" ? t("encodes", { value: check.value ?? "" }) : t("encodesSample", { value: check.value ?? "" })}
            </p>
            {check.moduleWidthMm !== null && <p className="text-xs text-muted-foreground">{t("narrowest", { width: check.moduleWidthMm.toFixed(2) })}</p>}
          </>
        )}
        {check.warnings.map((warning) => (
          <Caution key={warning.code} code={warning.code}>
            {t("issues.tooSmall", { width: (check.moduleWidthMm ?? 0).toFixed(2), min: MIN_MODULE_WIDTH_MM })}
          </Caution>
        ))}
      </div>
    </ConfigSection>
  );
}

export function QrConfigPanel({ element }: { element: TemplateElementOf<"qr"> }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.config.qr");
  const { set } = useConfigEdit<"qr">(element);
  const sample = useSample();
  const { source, url, errorCorrection, quietZone } = element.config;
  const check = useMemo(() => qrCheck(element, sample), [element, sample]);
  const urlProblem = source === "fixed" ? qrUrlProblem(url) : null;

  return (
    <ConfigSection element={element} hint={t("sizeHint", { min: MIN_QR_SIZE_MM })}>
      <Field label={t("source")}>
        {(id) => (
          <ChoiceSelect
            id={id}
            field="config.source"
            value={source}
            options={(["trackingLink", "orderTrackingPage", "storeWebsite", "fixed"] as const).map((each) => ({ value: each, label: t(`sources.${each}`) }))}
            onChange={(next) => set({ source: next as QrConfig["source"] })}
          />
        )}
      </Field>
      {source === "fixed" && (
        <Field label={t("url")}>
          {(id) => (
            <Input
              id={id}
              data-field="config.url"
              className="h-8 font-mono text-xs"
              maxLength={1000}
              inputMode="url"
              placeholder="https://"
              aria-invalid={urlProblem ? true : undefined}
              value={url ?? ""}
              onChange={(event) => set({ url: event.target.value }, "url")}
            />
          )}
        </Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("errorCorrection")}>
          {(id) => (
            <ChoiceSelect
              id={id}
              field="config.errorCorrection"
              value={errorCorrection}
              options={(["L", "M", "Q", "H"] as const).map((each) => ({ value: each, label: t(`levels.${each}`) }))}
              onChange={(next) => set({ errorCorrection: next })}
            />
          )}
        </Field>
        <Field label={t("quietZone")}>
          {(id) => <UnitInput id={id} field="config.quietZone" unit={t("unitModules")} value={quietZone} min={0} max={10} step={1} normalize={Math.round} onChange={(next) => set({ quietZone: next }, "quietZone")} />}
        </Field>
      </div>

      <div className="space-y-1.5" data-code-check="qr">
        {urlProblem ? (
          <Problem code="badUrl">{t("issues.badUrl")}</Problem>
        ) : check.issue ? (
          <Problem code={check.issue.code}>
            {check.issue.code === "empty"
              ? source === "fixed"
                ? t("issues.emptyFixed")
                : t("issues.emptyBound", { source: t(`nouns.${source}`) })
              : t("issues.invalid")}
          </Problem>
        ) : (
          <p className="break-all text-xs text-muted-foreground" data-code-value={check.value ?? ""}>
            {source === "fixed" ? t("encodes", { value: check.value ?? "" }) : t("encodesSample", { value: check.value ?? "" })}
          </p>
        )}
        {!urlProblem &&
          check.warnings.map((warning) => (
            <Caution key={warning.code} code={warning.code}>
              {t("issues.tooSmall", { size: check.sizeMm.toFixed(1), min: MIN_QR_SIZE_MM })}
            </Caution>
          ))}
      </div>
    </ConfigSection>
  );
}
