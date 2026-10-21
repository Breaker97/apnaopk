"use client";

/**
 * Position & size (§5.6) for the selected element: X, Y, W, H in mm at
 * 0.1 mm, rotation in degrees, and which pages it prints on. Typing into a
 * field is one undo step per field (`prop:<id>:<field>`, grouped at 600 ms);
 * Prints on is a step of its own. A locked element shows its numbers but
 * can't be moved or resized from here either.
 */
import { useTranslations } from "next-intl";
import { normalizeDeg } from "@/lib/invoice-templates/editor/geometry";
import { SHOW_ON, type TemplateElement } from "@/lib/invoice-templates/types";
import { roundMm } from "@/lib/invoice-templates/units";
import { useEditorApi } from "./editor-store";
import { ChoiceSelect, Field, UnitInput } from "./panel-fields";
import { PropertySection } from "./properties/property-section";

/** Wide enough for anything on the largest page and well past it (the schema's bound). */
const POSITION_LIMIT_MM = 2000;
const MIN_SIDE_MM = 0.1;

type GeometryField = "xMm" | "yMm" | "widthMm" | "heightMm" | "rotationDeg";

export function PositionSize({ element }: { element: TemplateElement }) {
  const t = useTranslations("admin.invoiceTemplates.editor.panel");
  const tShowOn = useTranslations("admin.invoiceTemplates.editor.showOn");
  const api = useEditorApi();
  const locked = Boolean(element.locked);
  const set = (field: GeometryField, value: number) =>
    api.getState().updateElement(element.id, { [field]: value } as Partial<TemplateElement>, { group: `prop:${element.id}:${field}` });

  const mm = (field: GeometryField, label: string, min: number) => (
    <Field label={label}>
      {(id) => (
        <UnitInput
          id={id}
          field={field}
          unit={t("unitMm")}
          value={element[field]}
          min={min}
          max={POSITION_LIMIT_MM}
          disabled={locked}
          onChange={(value) => set(field, roundMm(value))}
        />
      )}
    </Field>
  );

  return (
    <PropertySection id="position" title={t("position")} data-position-size="">
      {locked && <p className="text-xs text-muted-foreground">{t("locked")}</p>}
      <div className="grid grid-cols-2 gap-2">
        {mm("xMm", t("x"), -POSITION_LIMIT_MM)}
        {mm("yMm", t("y"), -POSITION_LIMIT_MM)}
        {mm("widthMm", t("width"), MIN_SIDE_MM)}
        {mm("heightMm", t("height"), MIN_SIDE_MM)}
        <Field label={t("rotation")}>
          {(id) => (
            <UnitInput
              id={id}
              field="rotationDeg"
              unit={t("unitDeg")}
              value={element.rotationDeg}
              min={-360}
              max={360}
              step={1}
              normalize={(value) => Math.round(value * 10) / 10}
              disabled={locked}
              onChange={(value) => set("rotationDeg", normalizeDeg(value))}
            />
          )}
        </Field>
      </div>
      <Field label={t("showOn")}>
        {(id) => (
          <ChoiceSelect
            id={id}
            field="showOn"
            value={element.showOn}
            options={SHOW_ON.map((value) => ({ value, label: tShowOn(value) }))}
            onChange={(showOn) => api.getState().updateElement(element.id, { showOn })}
          />
        )}
      </Field>
    </PropertySection>
  );
}
