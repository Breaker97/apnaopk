"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { taxClassOptions, type TaxClass } from "@/lib/tax/tax-settings";
import { useTaxClassCopy } from "@/components/admin/settings/sections/tax/tax-shared";

const INHERIT = "__inherit";
const CUSTOM = "__custom";

/**
 * How a product or category is taxed: as its parent is, under one of the
 * store's classes (Settings → Tax), or at a custom rate of its own — which
 * wins over any class (lib/tax/tax-rates.ts).
 */
export function TaxClassPicker(props: {
  id: string;
  /** Settings → Tax's classes; without them, the built-in ones. */
  classes?: TaxClass[];
  taxClass: string | null | undefined;
  taxRate: number | null | undefined;
  /** What "inherit" means here: the category's, or the parent category's. */
  inheritLabel: string;
  onChange: (next: { taxClass: string | null; taxRate: number | null }) => void;
}) {
  const t = useTranslations("admin.settings.tax.picker");
  const classCopy = useTaxClassCopy();
  const classes = props.classes?.length ? props.classes : taxClassOptions(null);
  // A stored rate shows as custom once the form has it (it loads after the
  // first paint); picking Custom keeps the input open while it is empty.
  const [pickedCustom, setPickedCustom] = useState(false);
  const custom = pickedCustom || typeof props.taxRate === "number";
  const known = props.taxClass ? classes.some((entry) => entry.key === props.taxClass) : true;
  const value = custom ? CUSTOM : props.taxClass || INHERIT;

  const choose = (next: string) => {
    if (next === CUSTOM) {
      setPickedCustom(true);
      props.onChange({ taxClass: null, taxRate: props.taxRate ?? null });
      return;
    }
    setPickedCustom(false);
    props.onChange({ taxClass: next === INHERIT ? null : next, taxRate: null });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor={props.id} className="text-muted-foreground">
        {t("label")}
      </label>
      <Select value={value} onValueChange={choose}>
        <SelectTrigger id={props.id} className="h-8 w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={INHERIT}>{props.inheritLabel}</SelectItem>
          {classes.map((entry) => (
            <SelectItem key={entry.key} value={entry.key}>
              {classCopy.name(entry)}
            </SelectItem>
          ))}
          {!known && props.taxClass ? (
            <SelectItem value={props.taxClass}>{t("removedClass", { key: props.taxClass })}</SelectItem>
          ) : null}
          <SelectItem value={CUSTOM}>{t("custom")}</SelectItem>
        </SelectContent>
      </Select>
      {custom ? (
        <div className="flex items-center gap-1 rounded-md border px-3 py-1">
          <NumberInput
            step="0.01"
            min={0}
            max={100}
            placeholder="0"
            value={props.taxRate ?? undefined}
            onValueChange={(next) => props.onChange({ taxClass: null, taxRate: next ?? null })}
            className="h-5 w-20 border-0 bg-transparent p-0 text-foreground shadow-none focus-visible:ring-0"
            aria-label={t("customRate")}
          />
          <span className="text-muted-foreground">%</span>
        </div>
      ) : null}
      <span className="text-muted-foreground basis-full text-xs">{custom ? t("customHint") : t("hint")}</span>
    </div>
  );
}
