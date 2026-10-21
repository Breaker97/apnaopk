"use client";

/**
 * The Price Summary's settings (§5.7): its rows (Subtotal … Due) in an order
 * the designer chooses, each with a label of its own, "hide when zero",
 * "show as a deduction" and bold; rows can be removed (one stays) and added
 * back; and the label / value alignment. Each change is one undo step; typing
 * a label is grouped per row.
 */
import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PRICE_ROW_FIELD, priceRowLabel } from "@/lib/invoice-templates/bindings";
import { addPriceRow, arrayMove, missingPriceRows, patchPriceRow, removePriceRow } from "@/lib/invoice-templates/editor/block-config";
import { getField } from "@/lib/invoice-templates/fields";
import type { PriceSummaryRow, TemplateElementOf } from "@/lib/invoice-templates/types";
import { useEditor } from "../editor-store";
import { AddPicker } from "./add-picker";
import { ConfigSection, useConfigEdit } from "./config-section";
import { SideChoice } from "./field-blocks";
import { SortableList, SortableRow } from "./sortable-list";

type RowKey = PriceSummaryRow["key"];

export function PriceSummaryConfig({ element }: { element: TemplateElementOf<"priceSummary"> }) {
  const tt = useTranslations("admin.invoiceTemplates.editor.props.config.priceRows");
  const tSummary = useTranslations("admin.invoiceTemplates.editor.props.config.summary");
  const { set, update } = useConfigEdit<"priceSummary">(element);
  const language = useLocale() === "bn" ? "bn" : "en";
  const templateLocale = useEditor((state) => state.design.locale);
  const nameOf = (key: RowKey) => getField(PRICE_ROW_FIELD[key]).label[language];
  const { rows, labelAlign, valueAlign } = element.config;
  const ids = rows.map((row) => row.key);
  const names = Object.fromEntries(ids.map((key) => [key, nameOf(key)]));
  const move = (key: string, to: number) => update((config) => ({ rows: arrayMove(config.rows, config.rows.findIndex((row) => row.key === key), to) }));
  const patch = (key: RowKey, change: Parameters<typeof patchPriceRow>[2], group?: string) => update((config) => ({ rows: patchPriceRow(config.rows, key, change) }), group);

  const flag = (row: PriceSummaryRow, name: "hideWhenZero" | "asDeduction" | "bold") => (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span>{tt(`flags.${name}`)}</span>
      <Switch
        data-field={`rows.${row.key}.${name}`}
        checked={row[name]}
        onCheckedChange={(value) => patch(row.key, { [name]: value })}
        aria-label={tt(`flagFor.${name}`, { name: nameOf(row.key) })}
        className="scale-90"
      />
    </label>
  );

  return (
    <ConfigSection element={element}>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{tt("rows")}</p>
        <SortableList ids={ids} names={names} label={tt("rows")} onMove={move}>
          {rows.map((row, index) => (
            <SortableRow key={row.key} id={row.key} name={nameOf(row.key)} index={index} count={rows.length} onMoveBy={(delta) => move(row.key, index + delta)}>
              <div className="flex items-center justify-between gap-2" data-price-row={row.key}>
                <span className="min-w-0 flex-1 truncate text-sm">{nameOf(row.key)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  data-action={`remove-row-${row.key}`}
                  disabled={rows.length <= 1}
                  title={rows.length <= 1 ? tt("last") : undefined}
                  aria-label={tt("remove", { name: nameOf(row.key) })}
                  onClick={() => update((config) => ({ rows: removePriceRow(config.rows, row.key) }))}
                >
                  <X aria-hidden className="size-3.5" />
                </Button>
              </div>
              <Input
                data-field={`rows.${row.key}.label`}
                aria-label={tt("labelFor", { name: nameOf(row.key) })}
                className="mt-1 h-7 text-xs"
                maxLength={60}
                placeholder={priceRowLabel(row.key, templateLocale)}
                value={row.label ?? ""}
                onChange={(event) => patch(row.key, { label: event.target.value }, `rows.${row.key}.label`)}
              />
              <div className="mt-1.5 space-y-1">
                {flag(row, "hideWhenZero")}
                {flag(row, "asDeduction")}
                {flag(row, "bold")}
              </div>
            </SortableRow>
          ))}
        </SortableList>
        <AddPicker
          field="add-row"
          label={tt("add")}
          emptyLabel={tt("addNone")}
          options={missingPriceRows(rows).map((key) => ({ value: key, label: nameOf(key), keywords: key }))}
          onAdd={(key) => update((config) => ({ rows: addPriceRow(config.rows, key as RowKey) }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SideChoice label={tSummary("labelAlign")} field="config.labelAlign" value={labelAlign} onChange={(next) => set({ labelAlign: next })} />
        <SideChoice label={tSummary("valueAlign")} field="config.valueAlign" value={valueAlign} onChange={(next) => set({ valueAlign: next })} />
      </div>
    </ConfigSection>
  );
}
