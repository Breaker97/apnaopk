"use client";

/**
 * The Design tab with nothing selected (§5.5): the page itself — size,
 * height mode and shortest print, margins, snap grid, background, default
 * font — and the template's formats (amounts, suffix, dates, digits).
 *
 * Each field is one undo step: typing into a number or the suffix is grouped
 * per field (`canvas:<field>`, 600 ms, as everywhere in the editor), a pick
 * from a list or a colour is a step of its own. A size change never moves
 * elements (§4.4).
 */
import { useId, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ColorSwatchPicker } from "@/components/admin/color-swatch-picker";
import { Input } from "@/components/ui/input";
import { CANVAS_SIZE_KEYS, CUSTOM_SIZE_LIMITS, isCanvasSizeKey } from "@/lib/invoice-templates/canvas-sizes";
import { marginLimit, withHeightMode, withMargin, type MarginSide } from "@/lib/invoice-templates/editor/operations";
import { FONT_LABELS } from "@/lib/invoice-templates/fonts";
import { formatDate } from "@/lib/invoice-templates/formats";
import {
  AMOUNT_FORMATS,
  DATE_FORMATS,
  DIGIT_SETS,
  FONT_KEYS,
  GRID_SIZES_MM,
  HEIGHT_MODES,
  type TemplateCanvas,
  type TemplateFormat,
} from "@/lib/invoice-templates/types";
import { useEditor, useEditorApi } from "./editor-store";
import { ChoiceSelect, Field, PanelSection, UnitInput } from "./panel-fields";
import { useSizeLabels } from "./size-menu";

const MARGINS: { side: MarginSide; key: "marginTop" | "marginRight" | "marginBottom" | "marginLeft" }[] = [
  { side: "top", key: "marginTop" },
  { side: "right", key: "marginRight" },
  { side: "bottom", key: "marginBottom" },
  { side: "left", key: "marginLeft" },
];

/** A fixed day for the date examples: 11 October 2026. */
const EXAMPLE_DATE = "2026-10-11T12:00:00.000Z";

export function CanvasSettings() {
  const t = useTranslations("admin.invoiceTemplates.editor.panel");
  const locale = useLocale();
  const api = useEditorApi();
  const canvas = useEditor((state) => state.design.canvas);
  const format = useEditor((state) => state.design.format);
  const templateLocale = useEditor((state) => state.design.locale);
  const labels = useSizeLabels();
  const suffixId = useId();
  const fontLanguage = locale === "bn" ? "bn" : "en";
  const store = () => api.getState();
  const setFormat = (patch: Partial<TemplateFormat>, group?: string) =>
    store().commit((design) => ({ ...design, format: { ...design.format, ...patch } }), { group });
  const isRoll = canvas.heightMode === "auto";
  // The margins as they were before the width or height box was typed into.
  // The box sends every in-range keystroke, so "200" arrives as "20" first,
  // and fitting the margins to that passing 20 mm would keep them shrunk on
  // 200 mm. Each keystroke fits these instead; leaving the box lets them go.
  const sizeMargins = useRef<TemplateCanvas["marginMm"] | null>(null);
  const typeSize = (widthMm: number, heightMm: number) => {
    sizeMargins.current ??= store().design.canvas.marginMm;
    store().setCustomSize(widthMm, heightMm, { group: "canvas:size", marginMm: sizeMargins.current });
  };
  const sizeKey = isCanvasSizeKey(canvas.preset) ? canvas.preset : "custom";

  return (
    <div className="space-y-2" data-canvas-settings="">
      <PanelSection title={t("page")}>
        <Field label={t("size")}>
          {(id) => (
            <ChoiceSelect
              id={id}
              field="canvas.size"
              value={sizeKey}
              options={[
                ...CANVAS_SIZE_KEYS.map((key) => ({ value: key, label: labels.option(key) })),
                { value: "custom" as const, label: labels.name("custom") },
              ]}
              onChange={(key) => {
                if (isCanvasSizeKey(key)) store().setCanvasSize(key);
                else store().setCustomSize(canvas.widthMm, canvas.heightMm);
              }}
            />
          )}
        </Field>
        <div
          className="grid grid-cols-2 gap-2"
          onBlur={() => {
            sizeMargins.current = null;
          }}
        >
          <Field label={t("width")}>
            {(id) => (
              <UnitInput
                id={id}
                field="canvas.width"
                unit={t("unitMm")}
                value={canvas.widthMm}
                min={CUSTOM_SIZE_LIMITS.minWidthMm}
                max={CUSTOM_SIZE_LIMITS.maxWidthMm}
                onChange={(widthMm) => typeSize(widthMm, canvas.heightMm)}
              />
            )}
          </Field>
          <Field label={isRoll ? t("designHeight") : t("height")}>
            {(id) => (
              <UnitInput
                id={id}
                field="canvas.height"
                unit={t("unitMm")}
                value={canvas.heightMm}
                min={CUSTOM_SIZE_LIMITS.minHeightMm}
                max={CUSTOM_SIZE_LIMITS.maxHeightMm}
                onChange={(heightMm) => typeSize(canvas.widthMm, heightMm)}
              />
            )}
          </Field>
        </div>
        <Field label={t("heightMode")}>
          {(id) => (
            <ChoiceSelect
              id={id}
              field="canvas.heightMode"
              value={canvas.heightMode}
              options={HEIGHT_MODES.map((mode) => ({ value: mode, label: t(`heightModes.${mode}`) }))}
              onChange={(mode) => store().commit((design) => withHeightMode(design, mode))}
            />
          )}
        </Field>
        {isRoll && (
          <Field label={t("minHeight")}>
            {(id) => (
              <UnitInput
                id={id}
                field="canvas.minHeight"
                unit={t("unitMm")}
                value={canvas.minHeightMm ?? canvas.heightMm}
                min={CUSTOM_SIZE_LIMITS.minHeightMm}
                max={CUSTOM_SIZE_LIMITS.maxHeightMm}
                onChange={(minHeightMm) => store().updateCanvas({ minHeightMm }, { group: "canvas:minHeight" })}
              />
            )}
          </Field>
        )}
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold text-muted-foreground">{t("margins")}</legend>
          <div className="grid grid-cols-2 gap-2">
            {MARGINS.map(({ side, key }) => (
              <Field key={side} label={t(key)}>
                {(id) => (
                  <UnitInput
                    id={id}
                    field={`canvas.margin.${side}`}
                    unit={t("unitMm")}
                    value={canvas.marginMm[side]}
                    min={0}
                    max={marginLimit(canvas, side)}
                    onChange={(value) => store().commit((design) => withMargin(design, side, value), { group: `canvas:margin:${side}` })}
                  />
                )}
              </Field>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("grid")}>
            {(id) => (
              <ChoiceSelect
                id={id}
                field="canvas.grid"
                value={String(canvas.gridMm)}
                options={GRID_SIZES_MM.map((size) => ({ value: String(size), label: t("gridValue", { value: size }) }))}
                onChange={(value) => store().updateCanvas({ gridMm: Number(value) as TemplateCanvas["gridMm"] })}
              />
            )}
          </Field>
          <Field label={t("background")}>
            {() => (
              <ColorSwatchPicker
                value={canvas.background === "transparent" ? "#ffffff" : canvas.background}
                onChange={(background) => store().updateCanvas({ background }, { group: "canvas:background" })}
                ariaLabel={t("background")}
                alpha={false}
                className="h-8 w-full"
              />
            )}
          </Field>
        </div>
        <Field label={t("defaultFont")}>
          {(id) => (
            <ChoiceSelect
              id={id}
              field="canvas.defaultFont"
              value={canvas.defaultFont}
              options={FONT_KEYS.map((key) => ({ value: key, label: FONT_LABELS[key][fontLanguage] }))}
              onChange={(defaultFont) => store().updateCanvas({ defaultFont })}
            />
          )}
        </Field>
      </PanelSection>

      <PanelSection title={t("formats")} hint={t("formatsHint")}>
        <Field label={t("amount")}>
          {(id) => (
            <ChoiceSelect
              id={id}
              field="format.amount"
              value={format.amount}
              options={AMOUNT_FORMATS.map((amount) => ({ value: amount, label: t(`amounts.${amount}`) }))}
              onChange={(amount) => setFormat({ amount })}
            />
          )}
        </Field>
        <div className="space-y-1">
          <label htmlFor={suffixId} className="text-xs font-medium text-foreground">
            {t("amountSuffix")}
          </label>
          <Input
            id={suffixId}
            data-field="format.amountSuffix"
            className="h-8"
            maxLength={8}
            placeholder={t("amountSuffixPlaceholder")}
            value={format.amountSuffix ?? ""}
            onChange={(event) => {
              const amountSuffix = event.target.value;
              store().commit(
                (design) => {
                  const { amountSuffix: _old, ...rest } = design.format;
                  return { ...design, format: amountSuffix ? { ...rest, amountSuffix } : rest };
                },
                { group: "format:amountSuffix" },
              );
            }}
          />
        </div>
        <div className="space-y-3">
          <Field label={t("date")}>
            {(id) => (
              <ChoiceSelect
                id={id}
                field="format.date"
                value={format.date}
                options={DATE_FORMATS.map((date) => ({
                  value: date,
                  label: formatDate(EXAMPLE_DATE, { format: { ...format, date }, locale: templateLocale, timeZone: "UTC" }) ?? date,
                }))}
                onChange={(date) => setFormat({ date })}
              />
            )}
          </Field>
          <Field label={t("digits")}>
            {(id) => (
              <ChoiceSelect
                id={id}
                field="format.digits"
                value={format.digits}
                options={DIGIT_SETS.map((digits) => ({ value: digits, label: t(`digitSets.${digits}`) }))}
                onChange={(digits) => setFormat({ digits })}
              />
            )}
          </Field>
        </div>
      </PanelSection>
    </div>
  );
}
