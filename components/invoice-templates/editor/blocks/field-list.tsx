"use client";

/**
 * A block's field list (§5.7): the header, the customer address, the order
 * summary and the delivery block each print a list of fields in an order the
 * designer chooses. Every field the block could print is a row — shown or
 * hidden with a switch, reordered by dragging its handle (or Up / Down on the
 * handle), and given a label of its own. A field this category has no data
 * for is marked, not hidden, when the config already lists it.
 *
 * Each change is one undo step; typing a label is grouped per field.
 */
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { fieldRows, moveRow, rowsToFields, setRowLabel, setRowVisible, type FieldRow } from "@/lib/invoice-templates/editor/block-config";
import type { BlockField } from "@/lib/invoice-templates/types";
import { SortableList, SortableRow } from "./sortable-list";

export interface FieldListProps<K extends string> {
  /** The block's current fields (its config's list). */
  fields: readonly BlockField<K>[];
  /** Every key the block can show. */
  allKeys: readonly K[];
  /** The field's name in the admin's language. */
  nameOf: (key: K) => string;
  /** What the field prints as its label when none is given, or undefined for "no label". */
  defaultLabel?: (key: K) => string | undefined;
  /** Keys that take no label of their own (a logo). */
  unlabelled?: readonly K[];
  /** Whether this category has data for the field. */
  isAvailable?: (key: K) => boolean;
  /** Applies a change of the rows to the element (one undo step; `group` for typing). */
  onChange: (change: (rows: FieldRow<K>[]) => FieldRow<K>[], group?: string) => void;
  label: string;
}

export function FieldList<K extends string>({ fields, allKeys, nameOf, defaultLabel, unlabelled = [], isAvailable, onChange, label }: FieldListProps<K>) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.config.fields");
  const rows = fieldRows(fields, allKeys, isAvailable);
  const ids = rows.map((row) => row.key);
  const names = Object.fromEntries(rows.map((row) => [row.key, nameOf(row.key)]));

  return (
    <SortableList ids={ids} names={names} label={label} onMove={(id, to) => onChange((current) => moveRow(current, id as K, to))}>
      {rows.map((row, index) => (
        <SortableRow
          key={row.key}
          id={row.key}
          name={nameOf(row.key)}
          index={index}
          count={rows.length}
          dim={!row.visible}
          onMoveBy={(delta) => onChange((current) => moveRow(current, row.key, index + delta))}
        >
          <div className="flex items-center justify-between gap-2" data-field-row={row.key}>
            <span className="min-w-0 flex-1 truncate text-sm" title={nameOf(row.key)}>
              {nameOf(row.key)}
            </span>
            {!row.available && <span className="shrink-0 text-[11px] text-amber-700 dark:text-amber-400">{t("notHere")}</span>}
            <Switch
              data-field={`fields.${row.key}.visible`}
              checked={row.visible}
              onCheckedChange={(visible) => onChange((current) => setRowVisible(current, row.key, visible))}
              aria-label={t("show", { name: nameOf(row.key) })}
            />
          </div>
          {row.visible && !unlabelled.includes(row.key) && (
            <Input
              data-field={`fields.${row.key}.label`}
              aria-label={t("labelFor", { name: nameOf(row.key) })}
              className="mt-1 h-7 text-xs"
              maxLength={80}
              placeholder={defaultLabel?.(row.key) ?? t("noLabel")}
              value={row.label ?? ""}
              onChange={(event) => onChange((current) => setRowLabel(current, row.key, event.target.value), `fields.${row.key}.label`)}
            />
          )}
        </SortableRow>
      ))}
    </SortableList>
  );
}
