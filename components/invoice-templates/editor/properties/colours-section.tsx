"use client";

/**
 * Colours (§5.6): the text colour and the background, as the capability map
 * allows. Picking is one undo step; dragging inside the picker is grouped per
 * field (600 ms), so one sweep is one step.
 */
import { useTranslations } from "next-intl";
import { capabilitiesFor } from "@/lib/invoice-templates/editor/capabilities";
import type { TemplateElement } from "@/lib/invoice-templates/types";
import { Field } from "../panel-fields";
import { ColourField } from "./colour-field";
import { PropertySection } from "./property-section";
import { useElementEdit } from "./use-element-edit";

export function ColoursSection({ element }: { element: TemplateElement }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.colours");
  const tSections = useTranslations("admin.invoiceTemplates.editor.props.sections");
  const { style } = useElementEdit(element.id);
  const controls = capabilitiesFor(element.type).colours;

  return (
    <PropertySection id="colours" title={tSections("colours")}>
      {controls.includes("color") && (
        <Field label={t("text")}>
          {() => <ColourField field="style.color" label={t("text")} value={element.style.color} onChange={(color) => style({ color }, "color")} />}
        </Field>
      )}
      {controls.includes("background") && (
        <Field label={t("background")}>
          {() => (
            <ColourField
              field="style.background"
              label={t("background")}
              allowNone
              value={element.style.background}
              onChange={(background) => style({ background }, "background")}
            />
          )}
        </Field>
      )}
    </PropertySection>
  );
}
