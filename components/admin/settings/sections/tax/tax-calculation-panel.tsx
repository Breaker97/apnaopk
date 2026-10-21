"use client";

import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { SettingList, SettingSwitchItem } from "@/components/admin/settings/fields/setting-row";
import type { TaxSettings } from "@/lib/tax/tax-settings";
import { TaxSection } from "./tax-layout";

/**
 * How tax is worked out. The till's shelf-price switch moved here from
 * Settings → POS; the rest is how every sale is taxed today, written down so
 * a merchant need not work it out from receipts. Nothing below the switch is
 * a setting, and the page says so.
 */
export function TaxCalculationPanel(props: { tax: TaxSettings; onChange: (next: TaxSettings) => void }) {
  const t = useTranslations("admin.settings.tax.calculation");
  const { tax, onChange } = props;
  const chain = [t("chain.own"), t("chain.class"), t("chain.category"), t("chain.standard")];
  const facts = [
    { label: t("facts.online.label"), text: t("facts.online.text") },
    { label: t("facts.discounts.label"), text: t("facts.discounts.text") },
    { label: t("facts.shipping.label"), text: t("facts.shipping.text") },
    { label: t("facts.region.label"), text: t("facts.region.text") },
  ];

  return (
    <div className="space-y-6">
      <TaxSection title={t("posTitle")} description={t("posDescription")}>
        <SettingList>
          <SettingSwitchItem
            title={t("posPricesIncludeTax")}
            description={t("posPricesIncludeTaxDesc")}
            checked={tax.calculation.posPricesIncludeTax}
            onCheckedChange={(on) =>
              onChange({ ...tax, calculation: { ...tax.calculation, posPricesIncludeTax: on } })
            }
          />
        </SettingList>
      </TaxSection>

      <TaxSection className="space-y-5 border-t pt-6" title={t("rulesTitle")} description={t("rulesDescription")}>
        <div className="space-y-2.5">
          <p className="text-sm font-medium">{t("chainTitle")}</p>
          <ol className="flex flex-wrap items-center gap-2">
            {chain.map((step, index) => (
              <Fragment key={step}>
                {index > 0 ? (
                  <li aria-hidden className="text-muted-foreground">
                    <ChevronRight className="size-4 rtl:rotate-180" />
                  </li>
                ) : null}
                <li
                  className={
                    index === chain.length - 1
                      ? "bg-primary/10 text-primary flex h-9 items-center gap-2 rounded-lg px-3 ps-2 text-sm font-medium"
                      : "bg-card flex h-9 items-center gap-2 rounded-lg border px-3 ps-2 text-sm font-medium"
                  }
                >
                  <span
                    aria-hidden
                    className="bg-primary/10 text-primary flex size-5 items-center justify-center rounded-full text-xs"
                  >
                    {index + 1}
                  </span>
                  {step}
                </li>
              </Fragment>
            ))}
          </ol>
        </div>
        <SettingList>
          {facts.map((fact) => (
            <div key={fact.label} className="flex flex-col gap-1 p-4 @xl:flex-row @xl:gap-6">
              <p className="text-sm font-medium @xl:w-48 @xl:shrink-0">{fact.label}</p>
              <p className="text-muted-foreground text-sm">{fact.text}</p>
            </div>
          ))}
        </SettingList>
      </TaxSection>
    </div>
  );
}
