"use client";

/**
 * The data-field picker (§5.6 Content): a searchable list of the fields valid
 * for this template's category and scope (lib/invoice-templates/editor/
 * field-picker.ts), grouped by prefix ("Customer · Phone") and matched by
 * label, group and key. A bound field the category never has data for is kept
 * at the end, marked, so it can be seen and changed. A vendor's editor isn't
 * offered the internal note (their papers never print it); a bound one is
 * kept, marked.
 */
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useTemplateScope } from "@/components/invoice-templates/template-scope";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { pickerFields, type PickerScope } from "@/lib/invoice-templates/editor/field-picker";
import type { TemplateCategory, TemplateLocale } from "@/lib/invoice-templates/types";

export interface FieldPickerProps {
  id: string;
  value: string | undefined;
  onChange: (key: string) => void;
  category: TemplateCategory;
  scope: PickerScope;
  /** The language the labels are shown in (the admin's). */
  locale: TemplateLocale;
  disabled?: boolean;
}

export function FieldPicker({ id, value, onChange, category, scope, locale, disabled }: FieldPickerProps) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.content");
  const vendor = useTemplateScope().kind === "vendor";
  const options = useMemo(
    () =>
      pickerFields({ category, scope, locale, keep: value, vendor }).map((field) => {
        const group = t(`groups.${field.group}`);
        const flags = [
          field.notPrinted ? t("notPrintedTag") : field.internal ? t("internalTag") : null,
          field.available ? null : t("notHereTag"),
        ].filter(Boolean);
        return {
          value: field.key,
          label: `${group} · ${field.label}${flags.length ? ` (${flags.join(", ")})` : ""}`,
          keywords: `${group} ${field.label} ${field.key}`,
        };
      }),
    [category, scope, locale, value, vendor, t],
  );

  return (
    <SearchableSelect
      id={id}
      options={options}
      value={value}
      onValueChange={onChange}
      placeholder={t("pickerPlaceholder")}
      searchPlaceholder={t("pickerSearch")}
      emptyText={t("pickerEmpty")}
      disabled={disabled}
      className="h-8 text-xs"
      contentClassName="z-[100]"
      // The panel is a drawer (a dialog) below 1280 px: a modal list keeps its own scroll there.
      modal
    />
  );
}
