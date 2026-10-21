"use client";

/**
 * Format (§5.6): how this element prints amounts, dates and digits, when it
 * should differ from the template's (Design tab with nothing selected). Each
 * control starts at "Same as template"; choosing it again removes the
 * override, and an element with no override has no `format` at all. An empty
 * suffix means "the template's", so one element can't print no suffix where
 * the template has one (known limit, notes/P5.md).
 */
import { useId } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { withElementFormat } from "@/lib/invoice-templates/editor/properties";
import { formatDate } from "@/lib/invoice-templates/formats";
import { AMOUNT_FORMATS, DATE_FORMATS, DIGIT_SETS, type TemplateElement, type TemplateFormat } from "@/lib/invoice-templates/types";
import { useEditor } from "../editor-store";
import { ChoiceSelect, Field } from "../panel-fields";
import { PropertySection } from "./property-section";
import { useElementEdit } from "./use-element-edit";

const INHERIT = "inherit";
/** Short, language-free examples, so "Same as template (…)" fits the narrow panel. */
const AMOUNT_EXAMPLES: Record<TemplateFormat["amount"], string> = { symbol: "$3,150", plain: "3150", fixed2: "3150.00" };
/** A fixed day for the date examples: 11 October 2026. */
const EXAMPLE_DATE = "2026-10-11T12:00:00.000Z";

export function FormatSection({ element }: { element: TemplateElement }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.format");
  const tPanel = useTranslations("admin.invoiceTemplates.editor.panel");
  const tSections = useTranslations("admin.invoiceTemplates.editor.props.sections");
  const template = useEditor((state) => state.design.format);
  const designLocale = useEditor((state) => state.design.locale);
  const { edit } = useElementEdit(element.id);
  const suffixId = useId();
  const own = element.format ?? {};
  const set = (patch: Parameters<typeof withElementFormat>[1], group?: string) => edit((each) => withElementFormat(each, patch), group && `format.${group}`);
  const same = (shown: string) => t("sameAsTemplate", { value: shown });
  const dateLabel = (date: TemplateFormat["date"]) => formatDate(EXAMPLE_DATE, { format: { ...template, date }, locale: designLocale, timeZone: "UTC" }) ?? date;

  return (
    <PropertySection id="format" title={tSections("format")} hint={t("hint")}>
      <Field label={tPanel("amount")}>
        {(id) => (
          <ChoiceSelect
            id={id}
            field="format.amount"
            value={own.amount ?? INHERIT}
            options={[
              { value: INHERIT, label: same(AMOUNT_EXAMPLES[template.amount]) },
              ...AMOUNT_FORMATS.map((amount) => ({ value: amount, label: tPanel(`amounts.${amount}`) })),
            ]}
            onChange={(value) => set({ amount: value === INHERIT ? undefined : (value as TemplateFormat["amount"]) })}
          />
        )}
      </Field>
      <div className="space-y-1">
        <label htmlFor={suffixId} className="text-xs text-muted-foreground">
          {tPanel("amountSuffix")}
        </label>
        <Input
          id={suffixId}
          data-field="format.amountSuffix"
          className="h-8"
          maxLength={8}
          placeholder={template.amountSuffix ? same(template.amountSuffix) : tPanel("amountSuffixPlaceholder")}
          value={own.amountSuffix ?? ""}
          onChange={(event) => set({ amountSuffix: event.target.value || undefined }, "amountSuffix")}
        />
      </div>
      <Field label={tPanel("date")}>
        {(id) => (
          <ChoiceSelect
            id={id}
            field="format.date"
            value={own.date ?? INHERIT}
            options={[{ value: INHERIT, label: same(dateLabel(template.date)) }, ...DATE_FORMATS.map((date) => ({ value: date, label: dateLabel(date) }))]}
            onChange={(value) => set({ date: value === INHERIT ? undefined : (value as TemplateFormat["date"]) })}
          />
        )}
      </Field>
      <Field label={tPanel("digits")}>
        {(id) => (
          <ChoiceSelect
            id={id}
            field="format.digits"
            value={own.digits ?? INHERIT}
            options={[
              { value: INHERIT, label: same(tPanel(`digitSets.${template.digits}`)) },
              ...DIGIT_SETS.map((digits) => ({ value: digits, label: tPanel(`digitSets.${digits}`) })),
            ]}
            onChange={(value) => set({ digits: value === INHERIT ? undefined : (value as TemplateFormat["digits"]) })}
          />
        )}
      </Field>
    </PropertySection>
  );
}
