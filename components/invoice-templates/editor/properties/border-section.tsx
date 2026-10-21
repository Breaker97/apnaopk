"use client";

/**
 * Border & spacing (§5.6): width (px), style, colour, corner radius (px),
 * padding and gap (mm), as the capability map allows. A rule's thickness,
 * style and colour are this section (P1 seam), and a rule has no "None": the
 * renderer draws a rule as solid when its style is none, so it isn't offered.
 */
import { useTranslations } from "next-intl";
import { capabilitiesFor } from "@/lib/invoice-templates/editor/capabilities";
import { roundMm } from "@/lib/invoice-templates/units";
import { BORDER_STYLES, type TemplateElement } from "@/lib/invoice-templates/types";
import { ChoiceSelect, Field, UnitInput } from "../panel-fields";
import { ColourField } from "./colour-field";
import { PropertySection } from "./property-section";
import { useElementEdit } from "./use-element-edit";

const round1 = (value: number) => Math.round(value * 10) / 10;

export function BorderSection({ element }: { element: TemplateElement }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.border");
  const tSections = useTranslations("admin.invoiceTemplates.editor.props.sections");
  const { style } = useElementEdit(element.id);
  const controls = capabilitiesFor(element.type).border;
  const has = (name: (typeof controls)[number]) => controls.includes(name);
  const s = element.style;
  const isLine = element.type === "line";
  const styles = BORDER_STYLES.filter((value) => !(isLine && value === "none"));

  return (
    <PropertySection id="border" title={tSections("border")}>
      {(has("borderWidthPx") || has("borderStyle")) && (
        <div className="grid grid-cols-2 gap-2">
          {has("borderWidthPx") && (
            <Field label={isLine ? t("thickness") : t("width")}>
              {(id) => (
                <UnitInput id={id} field="style.borderWidthPx" unit={t("unitPx")} value={s.borderWidthPx} min={0} max={20} step={0.5} normalize={round1} onChange={(borderWidthPx) => style({ borderWidthPx }, "borderWidthPx")} />
              )}
            </Field>
          )}
          {has("borderStyle") && (
            <Field label={t("style")}>
              {(id) => (
                <ChoiceSelect
                  id={id}
                  field="style.borderStyle"
                  value={isLine && s.borderStyle === "none" ? "solid" : s.borderStyle}
                  options={styles.map((value) => ({ value, label: t(`styles.${value}`) }))}
                  onChange={(borderStyle) => style({ borderStyle })}
                />
              )}
            </Field>
          )}
        </div>
      )}
      {has("borderColor") && (
        <Field label={t("color")}>
          {() => <ColourField field="style.borderColor" label={t("color")} value={s.borderColor} onChange={(borderColor) => style({ borderColor }, "borderColor")} />}
        </Field>
      )}
      {(has("radiusPx") || has("paddingMm") || has("gapMm")) && (
        <div className="grid grid-cols-2 gap-2">
          {has("radiusPx") && (
            <Field label={t("radius")}>
              {(id) => <UnitInput id={id} field="style.radiusPx" unit={t("unitPx")} value={s.radiusPx} min={0} max={200} step={1} normalize={round1} onChange={(radiusPx) => style({ radiusPx }, "radiusPx")} />}
            </Field>
          )}
          {has("paddingMm") && (
            <Field label={t("padding")}>
              {(id) => <UnitInput id={id} field="style.paddingMm" unit={t("unitMm")} value={s.paddingMm} min={0} max={50} onChange={(paddingMm) => style({ paddingMm: roundMm(paddingMm) }, "paddingMm")} />}
            </Field>
          )}
          {has("gapMm") && (
            <Field label={t("gap")}>
              {(id) => <UnitInput id={id} field="style.gapMm" unit={t("unitMm")} value={s.gapMm} min={0} max={50} onChange={(gapMm) => style({ gapMm: roundMm(gapMm) }, "gapMm")} />}
            </Field>
          )}
        </div>
      )}
    </PropertySection>
  );
}
