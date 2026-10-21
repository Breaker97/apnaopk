"use client";

import { useTranslations } from "next-intl";
import type { TaxClass } from "@/lib/tax/tax-settings";
import type { ProductTax } from "@/lib/tax/vendor-tax";
import { useTaxClassCopy } from "@/components/admin/settings/sections/tax/tax-shared";

/**
 * A product's tax in a few words — "Exempt", "Custom rate 7.5%", "Same as its
 * category", "Not charged" — for the vendor's locked tax row and the tax
 * change requests on both sides.
 */
export function useProductTaxLabel(classes: TaxClass[] | undefined) {
  const t = useTranslations("admin.settings.tax.request");
  const classCopy = useTaxClassCopy();
  return (tax: Pick<ProductTax, "chargeTax" | "taxClass" | "taxRate">) => {
    if (tax.chargeTax === false) return t("notCharged");
    if (typeof tax.taxRate === "number") return t("customRate", { rate: tax.taxRate });
    if (!tax.taxClass) return t("inherit");
    const known = classes?.find((entry) => entry.key === tax.taxClass);
    return classCopy.name(known ?? { key: tax.taxClass });
  };
}
