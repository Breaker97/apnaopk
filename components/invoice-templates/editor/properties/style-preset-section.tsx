"use client";

/**
 * Style preset (§5.6): Minimal, Bold COD, Premium, Compact, Courier Label —
 * visual properties only — and "Reset to default style". Choosing a preset or
 * resetting is one undo step and changes the element's `style` and nothing
 * else: the binding, the block's settings, the format and the geometry stay,
 * and so does every other element.
 *
 * "Default style" is where the element started: the preset layout's element
 * of the same id when the template came from a preset, else the type's
 * defaults (the toolbar's Reset → "Reset styles only" does this for all
 * elements at once).
 */
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { resetPresetKey, presetLayout } from "@/lib/invoice-templates/editor/reset";
import { STYLE_PRESET_KEYS, applyStylePreset, resetElementStyle, stylePresetPatch } from "@/lib/invoice-templates/editor/style-presets";
import { fontFamilyFor } from "@/lib/invoice-templates/fonts";
import type { TemplateElement } from "@/lib/invoice-templates/types";
import { useEditor, useEditorApi } from "../editor-store";
import { PropertySection } from "./property-section";
import { useElementEdit } from "./use-element-edit";

export function StylePresetSection({ element }: { element: TemplateElement }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.stylePreset");
  const tSections = useTranslations("admin.invoiceTemplates.editor.props.sections");
  const api = useEditorApi();
  const defaultFont = useEditor((state) => state.design.canvas.defaultFont);
  const { edit } = useElementEdit(element.id);

  const reference = () => {
    const state = api.getState();
    const key = resetPresetKey(state.presetKey);
    return key ? presetLayout(key, state.design).elements.find((each) => each.id === element.id) : null;
  };

  return (
    <PropertySection id="stylePreset" title={tSections("stylePreset")} hint={t("hint")}>
      <div className="grid grid-cols-2 gap-2">
        {STYLE_PRESET_KEYS.map((key) => {
          const look = { ...element.style, ...stylePresetPatch(key, element.type) };
          return (
            <Button
              key={key}
              type="button"
              variant="outline"
              size="sm"
              data-style-preset={key}
              className="h-auto flex-col items-stretch gap-1 px-2 py-1.5 text-start"
              onClick={() => edit((each) => applyStylePreset(each, key))}
            >
              <span
                aria-hidden
                className="block truncate px-1.5 py-0.5 text-center text-xs"
                style={{
                  fontFamily: fontFamilyFor(look.fontFamily ?? defaultFont),
                  fontWeight: look.fontWeight,
                  color: look.color,
                  background: look.background === "transparent" ? undefined : look.background,
                  border: look.borderStyle !== "none" && look.borderWidthPx > 0 ? `1px ${look.borderStyle} ${look.borderColor}` : "1px solid transparent",
                  borderRadius: Math.min(look.radiusPx, 6),
                }}
              >
                {t("specimen")}
              </span>
              <span className="text-xs">{t(`names.${key}`)}</span>
            </Button>
          );
        })}
      </div>
      <Button type="button" variant="ghost" size="sm" className="w-full" data-action="reset-style" onClick={() => edit((each) => resetElementStyle(each, reference()))}>
        {t("reset")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("resetHint")}</p>
    </PropertySection>
  );
}
