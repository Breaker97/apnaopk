"use client";

/**
 * "Add a column / field / row": a button that opens a searchable list of what
 * can still be added. With nothing left to add, the button says so and is
 * disabled.
 */
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";

export function AddPicker({
  label,
  emptyLabel,
  options,
  onAdd,
  field,
}: {
  label: string;
  emptyLabel: string;
  options: readonly { value: string; label: string; keywords?: string }[];
  onAdd: (value: string) => void;
  field: string;
}) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.config.fields");
  if (options.length === 0) {
    return (
      <Button type="button" variant="outline" size="sm" disabled className="w-full" data-action={field}>
        {emptyLabel}
      </Button>
    );
  }
  return (
    <SearchableSelect
      options={[...options]}
      onValueChange={onAdd}
      searchPlaceholder={t("search")}
      emptyText={t("searchEmpty")}
      contentClassName="z-[100]"
      modal
      trigger={
        <Button type="button" variant="outline" size="sm" className="w-full" data-action={field}>
          <Plus aria-hidden className="size-4" />
          {label}
        </Button>
      }
    />
  );
}
