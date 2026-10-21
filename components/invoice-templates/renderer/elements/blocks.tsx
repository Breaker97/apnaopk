import type { CSSProperties, ReactNode } from "react";
import {
  BLOCK_WORDS,
  fieldLabel,
  fieldText,
  priceRowLabel,
  priceRowValue,
  priceTaxRow,
  type BindingOptions,
} from "@/lib/invoice-templates/bindings";
import { formatAmount, formatDigits } from "@/lib/invoice-templates/formats";
import type { FieldKey } from "@/lib/invoice-templates/field-keys";
import { bindingOptions } from "../render-context";
import { mm } from "../styles";
import type { ElementRenderProps } from "../types";

/** Label-and-value rows, each on its own line, with the block's alignments. */
function KeyValueRows({
  rows,
  labelAlign,
  valueAlign,
  gapMm,
}: {
  rows: Array<{ key: string; label: string; value: string; bold?: boolean }>;
  labelAlign: "left" | "right";
  valueAlign: "left" | "right";
  gapMm: number;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="it-kv" style={{ display: "flex", flexDirection: "column", rowGap: mm(gapMm * 0.5) }}>
      {rows.map((row) => (
        <div key={row.key} className="it-kv-row" style={{ display: "flex", columnGap: mm(gapMm), fontWeight: row.bold ? 700 : undefined }}>
          <span className="it-kv-label" style={{ flex: "1 1 0", minWidth: 0, textAlign: labelAlign }}>
            {row.label}
          </span>
          <span className="it-kv-value" style={{ flex: "1 1 0", minWidth: 0, textAlign: valueAlign, whiteSpace: "pre-wrap" }}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Title({ text, className }: { text: string; className: string }) {
  if (!text) return null;
  return (
    <div className={className} style={{ fontWeight: 700, fontSize: "0.85em", letterSpacing: "0.02em", marginBottom: "0.2em" }}>
      {text}
    </div>
  );
}

const LINE: CSSProperties = { whiteSpace: "pre-wrap", overflowWrap: "anywhere" };

// ---------------------------------------------------------------------------
// Business header
// ---------------------------------------------------------------------------

const STORE_FIELD: Record<"name" | "phone" | "email" | "address" | "website" | "facebook" | "taxId", FieldKey> = {
  name: "store.name",
  phone: "store.phone",
  email: "store.email",
  address: "store.address",
  website: "store.website",
  facebook: "store.facebook",
  taxId: "store.taxId",
};

/** Store name, contact lines and the logo, placed left, right, above or not at all. */
export function BusinessHeaderElement({ element, context, design }: ElementRenderProps<"businessHeader">) {
  const options = bindingOptions(element, design);
  const { fields, logoPlacement } = element.config;
  const showLogo = logoPlacement !== "none" && fields.some((field) => field.key === "logo" && field.visible) && Boolean(context.store.logo);
  const lines: ReactNode[] = [];
  for (const field of fields) {
    if (!field.visible || field.key === "logo") continue;
    const value = fieldText(STORE_FIELD[field.key], context, options);
    if (value === null) continue;
    const label = field.label ? `${field.label}: ` : "";
    lines.push(
      <div key={field.key} className={`it-bh-${field.key}`} style={field.key === "name" ? { ...LINE, fontWeight: 700, fontSize: "1.3em" } : LINE}>
        {label}
        {value}
      </div>,
    );
  }
  const logo = showLogo ? (
    // eslint-disable-next-line @next/next/no-img-element -- printed markup
    <img
      className="it-bh-logo"
      src={context.store.logo!}
      alt=""
      draggable={false}
      style={
        logoPlacement === "top"
          ? { display: "block", height: "40%", maxWidth: "100%", objectFit: "contain", objectPosition: element.style.textAlign === "center" ? "center" : "left", marginBottom: mm(element.style.gapMm) }
          : { display: "block", height: "100%", maxWidth: "35%", objectFit: "contain", flex: "0 0 auto" }
      }
    />
  ) : null;
  const text = (
    <div className="it-bh-text" style={{ minWidth: 0, flex: "1 1 auto" }}>
      {lines}
    </div>
  );
  if (!logo) return text;
  if (logoPlacement === "top") {
    return (
      <div className="it-bh" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {logo}
        {text}
      </div>
    );
  }
  return (
    <div className="it-bh" style={{ display: "flex", flexDirection: logoPlacement === "right" ? "row-reverse" : "row", columnGap: mm(element.style.gapMm * 2), height: "100%", minHeight: 0 }}>
      {logo}
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customer address
// ---------------------------------------------------------------------------

/** A heading, then the recipient's name, phone, email and address lines (§5.7). */
export function CustomerAddressElement({ element, context, design }: ElementRenderProps<"customerAddress">) {
  const options = bindingOptions(element, design);
  const { fields, multiline, title } = element.config;
  const lines: ReactNode[] = [];
  for (const field of fields) {
    if (!field.visible) continue;
    if (field.key === "address") {
      const address = context.customer.addressLines.filter((line) => line.trim());
      if (address.length === 0) continue;
      const text = multiline ? address.join("\n") : address.join(", ");
      lines.push(
        <div key="address" className="it-ca-address" style={LINE}>
          {field.label ? `${field.label}: ` : ""}
          {formatDigits(text, options.format.digits)}
        </div>,
      );
      continue;
    }
    const value = fieldText(`customer.${field.key}` as FieldKey, context, options);
    if (value === null) continue;
    lines.push(
      <div key={field.key} className={`it-ca-${field.key}`} style={field.key === "name" ? { ...LINE, fontWeight: 700 } : LINE}>
        {field.label ? `${field.label}: ` : ""}
        {value}
      </div>,
    );
  }
  if (lines.length === 0) return null;
  return (
    <div className="it-ca">
      <Title text={title} className="it-ca-title" />
      {lines}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Order summary, delivery method
// ---------------------------------------------------------------------------

function labelledRows(
  fields: ReadonlyArray<{ key: string; visible: boolean; label?: string }>,
  keyOf: (key: string) => FieldKey,
  context: ElementRenderProps["context"],
  options: BindingOptions,
) {
  const rows: Array<{ key: string; label: string; value: string }> = [];
  for (const field of fields) {
    if (!field.visible) continue;
    const key = keyOf(field.key);
    const value = fieldText(key, context, options);
    if (value === null) continue;
    rows.push({ key: field.key, label: field.label ?? fieldLabel(key, options.locale), value });
  }
  return rows;
}

/** Order number, date and the other header facts as label: value rows. */
export function OrderSummaryElement({ element, context, design }: ElementRenderProps<"orderSummary">) {
  const options = bindingOptions(element, design);
  const rows = labelledRows(element.config.fields, (key) => key as FieldKey, context, options);
  return <KeyValueRows rows={rows} labelAlign={element.config.labelAlign} valueAlign={element.config.valueAlign} gapMm={element.style.gapMm} />;
}

/** Method, courier, service, tracking number and link, seller; missing values hidden (§5.7). */
export function DeliveryMethodElement({ element, context, design }: ElementRenderProps<"deliveryMethod">) {
  const options = bindingOptions(element, design);
  const rows = labelledRows(element.config.fields, (key) => `delivery.${key}` as FieldKey, context, options);
  return <KeyValueRows rows={rows} labelAlign="left" valueAlign="right" gapMm={element.style.gapMm} />;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/** The customer's note, the internal note or fixed text, under an optional heading. */
export function NotesElement({ element, context }: ElementRenderProps<"notes">) {
  const { source, text, title } = element.config;
  const body = source === "fixed" ? text?.trim() || null : source === "internalNote" ? context.order.internalNote : context.order.customerNote;
  if (!body) return null;
  return (
    <div className="it-notes">
      <Title text={title} className="it-notes-title" />
      <div className="it-notes-body" style={LINE}>
        {body}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// COD badge
// ---------------------------------------------------------------------------

/** Cash to collect (or due / total), or a PAID stamp when nothing is left (§5.7). */
export function CodBadgeElement({ element, context, design }: ElementRenderProps<"codBadge">) {
  const options = bindingOptions(element, design);
  const { amountSource, label, whenPaid, paidLabel } = element.config;
  const amount = context.money[amountSource];
  const inner: CSSProperties = { display: "flex", flexDirection: "column", justifyContent: "center", alignItems: element.style.textAlign === "center" ? "center" : element.style.textAlign === "right" ? "flex-end" : "flex-start", height: "100%" };
  if (amount > 0) {
    return (
      <div className="it-cod" style={inner}>
        <div className="it-cod-label" style={{ fontSize: "0.5em", fontWeight: 600, lineHeight: 1.2 }}>
          {label || fieldLabel(`money.${amountSource}` as FieldKey, options.locale)}
        </div>
        <div className="it-cod-amount" style={{ lineHeight: 1.15 }}>
          {formatAmount(amount, { currency: context.money.currency, format: options.format })}
        </div>
      </div>
    );
  }
  if (whenPaid === "hide") return null;
  return (
    <div className="it-cod it-cod-paid" style={inner}>
      <div className="it-cod-amount" style={{ lineHeight: 1.15 }}>
        {paidLabel || BLOCK_WORDS.paidStamp[options.locale]}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Price summary
// ---------------------------------------------------------------------------

/** Subtotal … due as label: amount rows, zero rows hidden on request (§5.7). */
export function PriceSummaryElement({ element, context, design }: ElementRenderProps<"priceSummary">) {
  const options = bindingOptions(element, design);
  const rows: Array<{ key: string; label: string; value: string; bold?: boolean }> = [];
  for (const row of element.config.rows) {
    const amount = priceRowValue(row.key, context);
    const label = row.label ?? priceRowLabel(row.key, options.locale);
    // The tax row follows how the sale was taxed (added, included, exempt), as the till's receipt does.
    const tax = row.key === "tax" ? priceTaxRow(label, context, options.locale) : null;
    if (row.hideWhenZero && amount === 0 && !tax?.keepAtZero) continue;
    rows.push({
      key: row.key,
      label: tax?.label ?? label,
      value: formatAmount(amount, {
        currency: context.money.currency,
        format: options.format,
        deduction: (row.asDeduction || Boolean(tax?.deduction)) && amount !== 0,
      }),
      bold: row.bold,
    });
  }
  return <KeyValueRows rows={rows} labelAlign={element.config.labelAlign} valueAlign={element.config.valueAlign} gapMm={element.style.gapMm} />;
}
