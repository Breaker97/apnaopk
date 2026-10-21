"use client";

/**
 * Typography (§5.6): font, size (CSS px), weight, style, alignment, line
 * height, vertical alignment and "Shrink text to fit" (down to 6 px; past that
 * the text wraps and is cut off, and Review says so). Which of these an
 * element type has comes from the capability map. Typing a number is one undo
 * step per field; a pick or a switch is a step of its own.
 */
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { capabilitiesFor } from "@/lib/invoice-templates/editor/capabilities";
import { FONT_LABELS, fontFamilyFor } from "@/lib/invoice-templates/fonts";
import {
  FONT_KEYS,
  FONT_STYLES,
  FONT_WEIGHTS,
  TEXT_ALIGNS,
  VERTICAL_ALIGNS,
  type ElementStyle,
  type FontKey,
  type TemplateElement,
} from "@/lib/invoice-templates/types";
import { useEditor } from "../editor-store";
import { ChoiceSelect, Field, Segmented, UnitInput } from "../panel-fields";
import { PropertySection } from "./property-section";
import { useElementEdit } from "./use-element-edit";

const INHERIT = "inherit";
const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;

export function TypographySection({ element }: { element: TemplateElement }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.typography");
  const tSections = useTranslations("admin.invoiceTemplates.editor.props.sections");
  const language = useLocale() === "bn" ? "bn" : "en";
  const defaultFont = useEditor((state) => state.design.canvas.defaultFont);
  const { style } = useElementEdit(element.id);
  const controls = capabilitiesFor(element.type).typography;
  const has = (name: (typeof controls)[number]) => controls.includes(name);
  const s = element.style;

  const number = (field: "fontSizePx" | "lineHeight", label: string, config: { min: number; max: number; step: number; unit: string; round: (value: number) => number }) => (
    <Field label={label}>
      {(id) => (
        <UnitInput
          id={id}
          field={`style.${field}`}
          unit={config.unit}
          value={s[field]}
          min={config.min}
          max={config.max}
          step={config.step}
          normalize={config.round}
          onChange={(value) => style({ [field]: config.round(value) } as Partial<ElementStyle>, field)}
        />
      )}
    </Field>
  );

  return (
    <PropertySection id="typography" title={tSections("typography")}>
      {has("fontFamily") && (
        <Field label={t("font")}>
          {(id) => (
            <ChoiceSelect
              id={id}
              field="style.fontFamily"
              value={s.fontFamily ?? INHERIT}
              options={[
                { value: INHERIT, label: t("fontDefault", { font: FONT_LABELS[defaultFont][language] }) },
                ...FONT_KEYS.map((key) => ({ value: key, label: FONT_LABELS[key][language] })),
              ]}
              onChange={(value) => style({ fontFamily: value === INHERIT ? undefined : (value as FontKey) })}
            />
          )}
        </Field>
      )}
      {(has("fontSizePx") || has("lineHeight")) && (
        <div className="grid grid-cols-2 gap-2">
          {has("fontSizePx") && number("fontSizePx", t("size"), { min: 4, max: 200, step: 0.5, unit: t("unitPx"), round: (value) => Math.round(value * 10) / 10 })}
          {has("lineHeight") && number("lineHeight", t("lineHeight"), { min: 0.8, max: 3, step: 0.05, unit: t("unitTimes"), round: (value) => Math.round(value * 100) / 100 })}
        </div>
      )}
      {(has("fontWeight") || has("fontStyle")) && (
        <div className="grid grid-cols-2 gap-2">
          {has("fontWeight") && (
            <Field label={t("weight")}>
              {(id) => (
                <ChoiceSelect
                  id={id}
                  field="style.fontWeight"
                  value={String(s.fontWeight)}
                  options={FONT_WEIGHTS.map((weight) => ({ value: String(weight), label: t(`weights.${weight}`) }))}
                  onChange={(value) => style({ fontWeight: Number(value) as ElementStyle["fontWeight"] })}
                />
              )}
            </Field>
          )}
          {has("fontStyle") && (
            <Field label={t("fontStyle")}>
              {(id) => (
                <ChoiceSelect
                  id={id}
                  field="style.fontStyle"
                  value={s.fontStyle}
                  options={FONT_STYLES.map((value) => ({ value, label: t(`fontStyles.${value}`) }))}
                  onChange={(fontStyle) => style({ fontStyle })}
                />
              )}
            </Field>
          )}
        </div>
      )}
      {has("textAlign") && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("align")}</p>
          <Segmented
            label={t("align")}
            field="style.textAlign"
            value={s.textAlign}
            options={TEXT_ALIGNS.map((value) => {
              const Icon = ALIGN_ICONS[value];
              return { value, title: t(`aligns.${value}`), label: <Icon aria-hidden className="size-4" /> };
            })}
            onChange={(textAlign) => style({ textAlign })}
          />
        </div>
      )}
      {has("verticalAlign") && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("verticalAlign")}</p>
          <Segmented
            label={t("verticalAlign")}
            field="style.verticalAlign"
            value={s.verticalAlign}
            options={VERTICAL_ALIGNS.map((value) => ({ value, label: t(`verticals.${value}`) }))}
            onChange={(verticalAlign) => style({ verticalAlign })}
          />
        </div>
      )}
      {has("shrinkToFit") && (
        <div className="space-y-1">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{t("shrink")}</span>
            <Switch data-field="style.shrinkToFit" checked={s.shrinkToFit} onCheckedChange={(shrinkToFit) => style({ shrinkToFit })} aria-label={t("shrink")} />
          </label>
          <p className="text-xs text-muted-foreground">{t("shrinkHelp")}</p>
        </div>
      )}
      <p aria-hidden className="truncate rounded border bg-muted/30 px-2 py-1 text-center text-sm" style={{ fontFamily: fontFamilyFor(s.fontFamily ?? defaultFont), fontWeight: s.fontWeight, fontStyle: s.fontStyle }}>
        {t("specimen")}
      </p>
    </PropertySection>
  );
}
