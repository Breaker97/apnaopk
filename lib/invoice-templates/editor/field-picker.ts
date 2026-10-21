/**
 * What the property panel's field picker offers (§5.6 Content, §4.7.2): the
 * registry filtered by the template's category and by scope.
 *
 * - **value** scope: the single-value fields any text-like element can print,
 *   only those valid in the template's category (a POS tender is never offered
 *   on an online invoice; a tracking number is never offered on a receipt that
 *   has none). Picture fields (the store logo) are left out: a text element
 *   would print the picture's address, not the picture (the Image block shows
 *   the logo).
 * - **item** scope: the per-line columns of a product table or product rows.
 *   They are never offered as a single value: a line has no meaning outside a
 *   repeating block.
 *
 * A field already bound but not valid in this category stays visible to the
 * element that has it (flagged), so a design that carries one can see it and
 * change it rather than meeting a blank picker; the Review tab warns too. A
 * picture field already bound stays the same way, its label marked.
 *
 * A vendor's editor (`vendor`) is not offered the internal fields: the vendor
 * print route never sends the staff-only internal note (review H1), so it
 * would print nothing. One already bound stays, flagged `notPrinted`.
 *
 * Pure and client-safe.
 */
import type { FieldKey, ItemFieldKey } from "../field-keys";
import {
  FIELDS,
  ITEM_FIELDS,
  fieldsForCategory,
  getField,
  isFieldAvailable,
  type FieldDefinition,
  type FieldGroup,
  type FieldValueType,
} from "../fields";
import type { TemplateCategory, TemplateLocale } from "../types";

export type PickerScope = "value" | "item";

/** Registry order of the groups, as the picker lists them. */
export const FIELD_GROUP_ORDER: readonly FieldGroup[] = ["order", "customer", "money", "delivery", "items", "store", "pos", "page"];

/** Pseudo-group of the item columns. */
export const ITEM_GROUP = "item" as const;
export type PickerGroup = FieldGroup | typeof ITEM_GROUP;

export interface PickerField<K extends string = string> {
  key: K;
  label: string;
  group: PickerGroup;
  valueType: FieldValueType;
  /** False for a bound field that this category never has data for. */
  available: boolean;
  /** Fields the owner flagged as internal (never printed to a customer by default). */
  internal: boolean;
  /** A picture field (only ever listed when already bound): as text it prints the picture's address. */
  image: boolean;
  /** An internal field in a vendor's editor (only ever listed when already bound): their papers never print it. */
  notPrinted: boolean;
}

const INTERNAL_FIELDS: readonly string[] = ["order.internalNote"];

/** How a kept picture field's label is marked (the picker shows the label as it is). */
const IMAGE_MARK: Record<TemplateLocale, string> = { en: "picture: prints its address", bn: "ছবি: এর ঠিকানা প্রিন্ট হয়" };

const isImage = (definition: FieldDefinition) => definition.valueType === "image";
const isInternal = (definition: FieldDefinition) => INTERNAL_FIELDS.includes(definition.key);

function toPicker(definition: FieldDefinition, locale: TemplateLocale, available: boolean, vendor: boolean): PickerField<FieldKey> {
  const image = isImage(definition);
  return {
    key: definition.key,
    label: image ? `${definition.label[locale]} (${IMAGE_MARK[locale]})` : definition.label[locale],
    group: definition.group,
    valueType: definition.valueType,
    available,
    internal: isInternal(definition),
    image,
    notPrinted: vendor && isInternal(definition),
  };
}

/**
 * The fields to offer. `keep` names a field that must stay in the list even
 * when this category has no data for it (the one the element is bound to).
 */
export function pickerFields(options: {
  category: TemplateCategory;
  scope: PickerScope;
  locale: TemplateLocale;
  keep?: string | null;
  /** A vendor owner's editor: internal fields are not offered. */
  vendor?: boolean;
}): PickerField[] {
  const { category, scope, locale, keep, vendor = false } = options;
  if (scope === "item") {
    return ITEM_FIELDS.map((definition) => ({
      key: definition.key as ItemFieldKey,
      label: definition.label[locale],
      group: ITEM_GROUP,
      valueType: definition.valueType,
      available: true,
      internal: false,
      image: definition.valueType === "image",
      notPrinted: false,
    }));
  }
  const offered = fieldsForCategory(category)
    .filter((definition) => !isImage(definition) && !(vendor && isInternal(definition)))
    .map((definition) => toPicker(definition, locale, true, vendor));
  const kept = keep && !offered.some((field) => field.key === keep) ? FIELDS.find((definition) => definition.key === keep) : undefined;
  return kept ? [...offered, toPicker(kept, locale, isFieldAvailable(kept.key, category), vendor)] : offered;
}

/** Whether a bound field has data in this category (the Review tab uses the same rule). */
export function fieldUsableIn(key: FieldKey, category: TemplateCategory): boolean {
  return isFieldAvailable(key, category);
}

/** The group a key sits in, for labelling. */
export function groupOf(key: FieldKey): FieldGroup {
  return getField(key).group;
}

/** A sensible first field when an element is switched to "Data field". */
export function defaultBoundField(category: TemplateCategory): FieldKey {
  return fieldsForCategory(category).some((field) => field.key === "order.number") ? "order.number" : fieldsForCategory(category)[0]!.key;
}
