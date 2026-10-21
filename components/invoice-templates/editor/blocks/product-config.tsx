"use client";

/**
 * The settings of the two repeating blocks (§5.7): the Product Table
 * (sortable columns with a heading, a width and an alignment each; heading
 * row, lines, fills, cells) and Product Rows (sortable fields, quantity
 * format, "+ N more"). Their page flow is the Page flow section.
 *
 * Column widths never add up to more than 100 % (the schema's rule): a
 * width box tops out at what the other columns leave, and when they leave
 * nothing it takes no value and says why. Each change is one undo step;
 * typing a heading or a width is grouped per field.
 */
import { AlignCenter, AlignLeft, AlignRight, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { itemFieldLabel } from "@/lib/invoice-templates/bindings";
import {
  addColumn,
  addRowsField,
  arrayMove,
  canSetColumnWidth,
  columnWidthTotal,
  maxColumnWidth,
  MIN_COLUMN_WIDTH,
  patchColumn,
  removeColumn,
  removeRowsField,
  setColumnWidth,
} from "@/lib/invoice-templates/editor/block-config";
import { ITEM_FIELD_KEYS, type ItemFieldKey } from "@/lib/invoice-templates/field-keys";
import { getItemField } from "@/lib/invoice-templates/fields";
import type { TemplateElementOf } from "@/lib/invoice-templates/types";
import { useEditor } from "../editor-store";
import { ChoiceSelect, Field, OptionalNumber, Segmented } from "../panel-fields";
import { ColourField } from "../properties/colour-field";
import { AddPicker } from "./add-picker";
import { ConfigSection, useConfigEdit } from "./config-section";
import { SortableList, SortableRow } from "./sortable-list";

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;

function useItemNames() {
  const language = useLocale() === "bn" ? "bn" : "en";
  const templateLocale = useEditor((state) => state.design.locale);
  return {
    nameOf: (key: ItemFieldKey) => getItemField(key).label[language],
    defaultHeading: (key: ItemFieldKey) => itemFieldLabel(key, templateLocale),
  };
}

export function ProductTableConfig({ element }: { element: TemplateElementOf<"productTable"> }) {
  const tt = useTranslations("admin.invoiceTemplates.editor.props.config.table");
  const { set, update } = useConfigEdit<"productTable">(element);
  const { nameOf, defaultHeading } = useItemNames();
  const { columns, showHeader, lines, headerFill, headerColor, stripeColor, cells } = element.config;
  const used = new Set(columns.map((column) => column.key));
  const unused = ITEM_FIELD_KEYS.filter((key) => !used.has(key));
  const ids = columns.map((column) => column.key);
  const total = columnWidthTotal(columns);
  const names = Object.fromEntries(ids.map((key) => [key, nameOf(key)]));
  const indexOf = (config: { columns: { key: string }[] }, key: string) => config.columns.findIndex((each) => each.key === key);
  const move = (key: string, to: number) => update((config) => ({ columns: arrayMove(config.columns, indexOf(config, key), to) }));
  // The others already take 100 %: a width here would pass it, so the box takes none until one of theirs is cleared.
  const widthFull = (index: number) => columns[index]!.widthPct === undefined && !canSetColumnWidth(columns, index);

  return (
    <ConfigSection element={element}>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{tt("columns")}</p>
        <SortableList ids={ids} names={names} label={tt("columns")} onMove={move}>
          {columns.map((column, index) => (
            <SortableRow key={column.key} id={column.key} name={nameOf(column.key)} index={index} count={columns.length} onMoveBy={(delta) => move(column.key, index + delta)}>
              <div className="flex items-center justify-between gap-2" data-column-row={column.key}>
                <span className="min-w-0 flex-1 truncate text-sm" title={nameOf(column.key)}>
                  {nameOf(column.key)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  data-action={`remove-column-${column.key}`}
                  disabled={columns.length <= 1}
                  title={columns.length <= 1 ? tt("last") : undefined}
                  aria-label={tt("remove", { name: nameOf(column.key) })}
                  onClick={() => update((config) => ({ columns: removeColumn(config.columns, indexOf(config, column.key)) }))}
                >
                  <X aria-hidden className="size-3.5" />
                </Button>
              </div>
              {/* 6rem: the box's padding and "%" take 48 px, and "100" or "99.5" (or the "Auto" placeholder) must still show whole. */}
              <div className="mt-1 grid grid-cols-[1fr_6rem] gap-1.5">
                <Input
                  data-field={`columns.${column.key}.label`}
                  aria-label={tt("headingFor", { name: nameOf(column.key) })}
                  className="h-7 text-xs"
                  maxLength={60}
                  placeholder={defaultHeading(column.key)}
                  value={column.label ?? ""}
                  onChange={(event) =>
                    update((config) => ({ columns: patchColumn(config.columns, indexOf(config, column.key), { label: event.target.value }) }), `columns.${column.key}.label`)
                  }
                />
                <OptionalNumber
                  id={`width-${column.key}`}
                  field={`columns.${column.key}.width`}
                  placeholder={tt("widthAuto")}
                  unit="%"
                  min={MIN_COLUMN_WIDTH}
                  max={Math.max(MIN_COLUMN_WIDTH, maxColumnWidth(columns, index))}
                  step={1}
                  normalize={(value) => Math.round(value * 10) / 10}
                  disabled={widthFull(index)}
                  value={column.widthPct}
                  onChange={(widthPct) =>
                    update((config) => ({ columns: setColumnWidth(config.columns, indexOf(config, column.key), widthPct) }), `columns.${column.key}.width`)
                  }
                />
              </div>
              {widthFull(index) && (
                <p className="mt-1 text-xs text-muted-foreground" data-width-full={column.key}>
                  {tt("widthFull")}
                </p>
              )}
              <Segmented
                label={tt("alignFor", { name: nameOf(column.key) })}
                field={`columns.${column.key}.align`}
                className="mt-1"
                value={column.align}
                options={(["left", "center", "right"] as const).map((value) => {
                  const Icon = ALIGN_ICONS[value];
                  return { value, title: tt(`aligns.${value}`), label: <Icon aria-hidden className="size-3.5" /> };
                })}
                onChange={(align) => update((config) => ({ columns: patchColumn(config.columns, indexOf(config, column.key), { align }) }))}
              />
            </SortableRow>
          ))}
        </SortableList>
        <p className="text-xs text-muted-foreground" data-width-total={total}>
          {tt("widthTotal", { total })}
        </p>
        <AddPicker
          field="add-column"
          label={tt("add")}
          emptyLabel={tt("addNone")}
          options={unused.map((key) => ({ value: key, label: nameOf(key), keywords: key }))}
          onAdd={(key) => update((config) => ({ columns: addColumn(config.columns, key as ItemFieldKey) }))}
        />
      </div>

      <label className="flex items-center justify-between gap-3 text-sm">
        <span>{tt("showHeader")}</span>
        <Switch data-field="config.showHeader" checked={showHeader} onCheckedChange={(next) => set({ showHeader: next })} aria-label={tt("showHeader")} />
      </label>
      <Field label={tt("lines")}>
        {(id) => (
          <ChoiceSelect
            id={id}
            field="config.lines"
            value={lines}
            options={(["grid", "rows", "none"] as const).map((value) => ({ value, label: tt(`lineModes.${value}`) }))}
            onChange={(next) => set({ lines: next })}
          />
        )}
      </Field>
      <Field label={tt("cells")}>
        {(id) => (
          <ChoiceSelect
            id={id}
            field="config.cells"
            value={cells}
            options={(["wrap", "oneLine"] as const).map((value) => ({ value, label: tt(`cellModes.${value}`) }))}
            onChange={(next) => set({ cells: next })}
          />
        )}
      </Field>
      {showHeader && (
        <>
          <Field label={tt("headerFill")}>
            {() => <ColourField field="config.headerFill" label={tt("headerFill")} allowNone noneValue="" value={headerFill} onChange={(value) => set({ headerFill: value }, "headerFill")} />}
          </Field>
          <Field label={tt("headerColor")}>
            {() => <ColourField field="config.headerColor" label={tt("headerColor")} value={headerColor} onChange={(value) => set({ headerColor: value }, "headerColor")} />}
          </Field>
        </>
      )}
      <Field label={tt("stripe")}>
        {() => <ColourField field="config.stripeColor" label={tt("stripe")} allowNone noneValue="" value={stripeColor} onChange={(value) => set({ stripeColor: value }, "stripeColor")} />}
      </Field>
    </ConfigSection>
  );
}

export function ProductRowsConfig({ element }: { element: TemplateElementOf<"productRows"> }) {
  const tt = useTranslations("admin.invoiceTemplates.editor.props.config.rows");
  const { set, update } = useConfigEdit<"productRows">(element);
  const { nameOf } = useItemNames();
  const { fields, quantityFormat, showMore } = element.config;
  const offered = ITEM_FIELD_KEYS.filter((key) => key !== "item.image" && !fields.includes(key));
  const names = Object.fromEntries(fields.map((key) => [key, nameOf(key)]));
  const move = (key: string, to: number) => update((config) => ({ fields: arrayMove(config.fields, config.fields.indexOf(key as ItemFieldKey), to) }));

  return (
    <ConfigSection element={element}>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{tt("fields")}</p>
        <SortableList ids={fields} names={names} label={tt("fields")} onMove={move}>
          {fields.map((key, index) => (
            <SortableRow key={key} id={key} name={nameOf(key)} index={index} count={fields.length} onMoveBy={(delta) => move(key, index + delta)}>
              <div className="flex items-center justify-between gap-2" data-rows-field={key}>
                <span className="min-w-0 flex-1 truncate text-sm">{nameOf(key)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  data-action={`remove-field-${key}`}
                  disabled={fields.length <= 1}
                  title={fields.length <= 1 ? tt("last") : undefined}
                  aria-label={tt("remove", { name: nameOf(key) })}
                  onClick={() => update((config) => ({ fields: removeRowsField(config.fields, key) }))}
                >
                  <X aria-hidden className="size-3.5" />
                </Button>
              </div>
            </SortableRow>
          ))}
        </SortableList>
        <AddPicker
          field="add-field"
          label={tt("add")}
          emptyLabel={tt("addNone")}
          options={offered.map((key) => ({ value: key, label: nameOf(key), keywords: key }))}
          onAdd={(key) => update((config) => ({ fields: addRowsField(config.fields, key as ItemFieldKey) }))}
        />
      </div>
      {fields.includes("item.qty") && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{tt("quantity")}</p>
          <Segmented
            label={tt("quantity")}
            field="config.quantityFormat"
            value={quantityFormat}
            options={(["times", "pcs"] as const).map((value) => ({ value, label: tt(`quantityFormats.${value}`) }))}
            onChange={(next) => set({ quantityFormat: next })}
          />
        </div>
      )}
      <div className="space-y-1">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>{tt("showMore")}</span>
          <Switch data-field="config.showMore" checked={showMore} onCheckedChange={(next) => set({ showMore: next })} aria-label={tt("showMore")} />
        </label>
        <p className="text-xs text-muted-foreground">{tt("showMoreHint")}</p>
      </div>
    </ConfigSection>
  );
}
