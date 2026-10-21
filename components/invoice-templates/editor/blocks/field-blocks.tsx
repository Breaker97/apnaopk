"use client";

/**
 * The four blocks that print a list of fields (§5.7): Business Header,
 * Customer Address, Order Summary and Delivery Method. Each is a `FieldList`
 * plus the few settings only that block has.
 */
import { useLocale, useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { fieldRows, rowsToFields, type FieldRow } from "@/lib/invoice-templates/editor/block-config";
import type { FieldKey } from "@/lib/invoice-templates/field-keys";
import { fieldLabel } from "@/lib/invoice-templates/bindings";
import { getField, isFieldAvailable } from "@/lib/invoice-templates/fields";
import {
  BUSINESS_HEADER_FIELDS,
  CUSTOMER_ADDRESS_FIELDS,
  DELIVERY_METHOD_FIELDS,
  ORDER_SUMMARY_FIELDS,
  type BlockField,
  type TemplateElementOf,
} from "@/lib/invoice-templates/types";
import { useEditor } from "../editor-store";
import { ChoiceSelect, Field, Segmented } from "../panel-fields";
import { ConfigSection, useConfigEdit } from "./config-section";
import { FieldList } from "./field-list";

type FieldBlock = "businessHeader" | "customerAddress" | "orderSummary" | "deliveryMethod";

const SIDES = ["left", "right"] as const;

/** The registry field behind each block field, for its name and default label. */
const REGISTRY_KEY: Record<FieldBlock, (key: string) => FieldKey> = {
  businessHeader: (key) => `store.${key}` as FieldKey,
  customerAddress: (key) => `customer.${key}` as FieldKey,
  orderSummary: (key) => key as FieldKey,
  deliveryMethod: (key) => `delivery.${key}` as FieldKey,
};

/** Wires a block's `fields` list to the store: each change reads the element's latest list. */
function useFieldList<T extends FieldBlock, K extends string>(
  element: TemplateElementOf<T>,
  allKeys: readonly K[],
  block: T,
) {
  const { update } = useConfigEdit<T>(element as never);
  const category = useEditor((state) => state.category);
  const templateLocale = useEditor((state) => state.design.locale);
  const language = useLocale() === "bn" ? "bn" : "en";
  const registryKey = REGISTRY_KEY[block];
  const isAvailable = (key: K) => isFieldAvailable(registryKey(key), category);
  const fields = (element.config as { fields: BlockField<K>[] }).fields;
  return {
    fields,
    allKeys,
    isAvailable,
    nameOf: (key: K) => getField(registryKey(key)).label[language],
    /** What a field prints as its label when the designer gave none (the registry's, in the template's language). */
    registryLabel: (key: K) => fieldLabel(registryKey(key), templateLocale),
    onChange: (change: (rows: FieldRow<K>[]) => FieldRow<K>[], group?: string) =>
      update(
        (config) =>
          ({ fields: rowsToFields(change(fieldRows((config as { fields: BlockField<K>[] }).fields, allKeys, isAvailable))) }) as never,
        group,
      ),
  };
}

export function BusinessHeaderConfig({ element }: { element: TemplateElementOf<"businessHeader"> }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.config");
  const { set } = useConfigEdit<"businessHeader">(element);
  const list = useFieldList(element, BUSINESS_HEADER_FIELDS, "businessHeader");
  return (
    <ConfigSection element={element}>
      <FieldList {...list} label={t("fields.list")} unlabelled={["logo"]} />
      <Field label={t("businessHeader.logoPlacement")}>
        {(id) => (
          <ChoiceSelect
            id={id}
            field="config.logoPlacement"
            value={element.config.logoPlacement}
            options={(["left", "right", "top", "none"] as const).map((value) => ({ value, label: t(`businessHeader.placements.${value}`) }))}
            onChange={(logoPlacement) => set({ logoPlacement })}
          />
        )}
      </Field>
    </ConfigSection>
  );
}

export function CustomerAddressConfig({ element }: { element: TemplateElementOf<"customerAddress"> }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.config");
  const { set } = useConfigEdit<"customerAddress">(element);
  const list = useFieldList(element, CUSTOMER_ADDRESS_FIELDS, "customerAddress");
  return (
    <ConfigSection element={element}>
      <Field label={t("customerAddress.title")}>
        {(id) => (
          <Input
            id={id}
            data-field="config.title"
            className="h-8"
            maxLength={80}
            placeholder={t("customerAddress.titlePlaceholder")}
            value={element.config.title}
            onChange={(event) => set({ title: event.target.value }, "title")}
          />
        )}
      </Field>
      <FieldList {...list} label={t("fields.list")} />
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>{t("customerAddress.multiline")}</span>
        <Switch data-field="config.multiline" checked={element.config.multiline} onCheckedChange={(multiline) => set({ multiline })} aria-label={t("customerAddress.multiline")} />
      </label>
      <Field label={t("customerAddress.longAddress")}>
        {(id) => (
          <ChoiceSelect
            id={id}
            field="config.longAddress"
            value={element.config.longAddress}
            options={(["wrap", "shrink"] as const).map((value) => ({ value, label: t(`customerAddress.longAddresses.${value}`) }))}
            onChange={(longAddress) => set({ longAddress })}
          />
        )}
      </Field>
    </ConfigSection>
  );
}

export function SideChoice({ label, value, onChange, field }: { label: string; value: "left" | "right"; onChange: (value: "left" | "right") => void; field: string }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.config.summary");
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Segmented label={label} field={field} value={value} options={SIDES.map((side) => ({ value: side, label: t(`sides.${side}`) }))} onChange={onChange} />
    </div>
  );
}

export function OrderSummaryConfig({ element }: { element: TemplateElementOf<"orderSummary"> }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.config");
  const { set } = useConfigEdit<"orderSummary">(element);
  const list = useFieldList(element, ORDER_SUMMARY_FIELDS, "orderSummary");
  return (
    <ConfigSection element={element}>
      <FieldList {...list} label={t("fields.list")} defaultLabel={list.registryLabel} />
      <div className="grid grid-cols-2 gap-2">
        <SideChoice label={t("summary.labelAlign")} field="config.labelAlign" value={element.config.labelAlign} onChange={(labelAlign) => set({ labelAlign })} />
        <SideChoice label={t("summary.valueAlign")} field="config.valueAlign" value={element.config.valueAlign} onChange={(valueAlign) => set({ valueAlign })} />
      </div>
    </ConfigSection>
  );
}

export function DeliveryMethodConfig({ element }: { element: TemplateElementOf<"deliveryMethod"> }) {
  const t = useTranslations("admin.invoiceTemplates.editor.props.config");
  const list = useFieldList(element, DELIVERY_METHOD_FIELDS, "deliveryMethod");
  return (
    <ConfigSection element={element}>
      <FieldList {...list} label={t("fields.list")} defaultLabel={list.registryLabel} />
    </ConfigSection>
  );
}
