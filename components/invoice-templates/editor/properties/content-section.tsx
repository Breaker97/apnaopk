"use client";

/**
 * Content (§5.6): "What should this show?" for an element that reads a
 * binding (v1: text; the blocks take their content from their own settings).
 *
 * - **Fixed text:** one text box. "This block prints the same text on every
 *   order."
 * - **Data field:** a searchable field (filtered by the template's category),
 *   text before and after, and what to print when the field is empty. "Each
 *   printed copy fills this in from the order." Before and after are skipped
 *   when the field is empty (§4.7.2).
 *
 * Under it, a live sample: what this element prints for the clearly-marked
 * sample order in the template's language, through the template's format (or
 * the element's own). Every change is an undo step; typing is grouped.
 */
import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { resolveBinding } from "@/lib/invoice-templates/bindings";
import { defaultBoundField, fieldUsableIn } from "@/lib/invoice-templates/editor/field-picker";
import { withBinding, withBindingMode } from "@/lib/invoice-templates/editor/properties";
import { isFieldKey } from "@/lib/invoice-templates/field-keys";
import { effectiveFormat } from "@/lib/invoice-templates/formats";
import { sampleContext } from "@/lib/invoice-templates/sample-context";
import type { ElementBinding, TemplateElement } from "@/lib/invoice-templates/types";
import { useEditor } from "../editor-store";
import { Field, Segmented } from "../panel-fields";
import { FieldPicker } from "./field-picker";
import { PropertySection } from "./property-section";
import { useElementEdit } from "./use-element-edit";

const TEXT_MAX = 2000;
const AROUND_MAX = 200;

export function ContentSection({ element }: { element: TemplateElement }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.content");
  const tSections = useTranslations("admin.invoiceTemplates.editor.props.sections");
  const tCategories = useTranslations("admin.invoiceTemplates.editor.props.content.categories");
  const adminLocale = useLocale() === "bn" ? "bn" : "en";
  const category = useEditor((state) => state.category);
  const design = useEditor((state) => state.design);
  const { edit } = useElementEdit(element.id);
  const binding: ElementBinding = element.binding ?? { mode: "fixed", text: "" };
  const mode = binding.mode;
  const set = (patch: Partial<ElementBinding>, group?: string) => edit((each) => withBinding(each, patch), group && `binding.${group}`);

  const sample = useMemo(() => sampleContext(category, design.locale), [category, design.locale]);
  const preview = resolveBinding(element.binding, sample, {
    format: effectiveFormat(design.format, element.format),
    locale: design.locale,
  });
  const unavailable = mode === "field" && binding.field && isFieldKey(binding.field) && !fieldUsableIn(binding.field, category);

  return (
    <PropertySection id="content" title={tSections("content")}>
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">{t("question")}</p>
        <Segmented
          label={t("question")}
          field="binding.mode"
          value={mode}
          options={[
            { value: "fixed", label: t("fixed") },
            { value: "field", label: t("field") },
          ]}
          onChange={(next) => edit((each) => withBindingMode(each, next, defaultBoundField(category)))}
        />
        <p className="text-xs text-muted-foreground" data-content-help={mode}>
          {mode === "fixed" ? t("fixedHelp") : t("fieldHelp")}
        </p>
      </div>

      {mode === "fixed" ? (
        <Field label={t("text")}>
          {(id) => (
            <Textarea
              id={id}
              data-field="binding.text"
              className="min-h-16 text-sm"
              maxLength={TEXT_MAX}
              value={binding.text ?? ""}
              onChange={(event) => set({ text: event.target.value }, "text")}
            />
          )}
        </Field>
      ) : (
        <>
          <Field label={t("dataField")}>
            {(id) => (
              <FieldPicker
                id={id}
                value={binding.field}
                category={category}
                scope="value"
                locale={adminLocale}
                onChange={(field) => set({ field: field as ElementBinding["field"] })}
              />
            )}
          </Field>
          {unavailable && (
            <p role="note" data-warning="field-unavailable" className="text-xs text-amber-700 dark:text-amber-400">
              {t("notHere", { category: tCategories(category) })}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("before")}>
              {(id) => (
                <Input id={id} data-field="binding.before" className="h-8" maxLength={AROUND_MAX} value={binding.before ?? ""} onChange={(event) => set({ before: event.target.value }, "before")} />
              )}
            </Field>
            <Field label={t("after")}>
              {(id) => (
                <Input id={id} data-field="binding.after" className="h-8" maxLength={AROUND_MAX} value={binding.after ?? ""} onChange={(event) => set({ after: event.target.value }, "after")} />
              )}
            </Field>
          </div>
          <Field label={t("fallback")}>
            {(id) => (
              <Input
                id={id}
                data-field="binding.fallback"
                className="h-8"
                maxLength={AROUND_MAX}
                placeholder={t("fallbackPlaceholder")}
                value={binding.fallback ?? ""}
                onChange={(event) => set({ fallback: event.target.value }, "fallback")}
              />
            )}
          </Field>
        </>
      )}

      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2" data-binding-sample="">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("sample")}</p>
        {preview === null ? (
          <p className="mt-0.5 text-xs italic text-muted-foreground">{t("sampleEmpty")}</p>
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm" data-binding-sample-text="">
            {preview}
          </p>
        )}
      </div>
    </PropertySection>
  );
}
