"use client";

import { useTranslations } from "next-intl";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { WarningBanner } from "@/components/ui/warning-banner";
import { CountrySelect } from "@/components/common/country-multi-select";
import { classRatesAt, type TaxRegion, type TaxSettings } from "@/lib/tax/tax-settings";
import { TaxNote } from "./tax-layout";

/** Whether the store charges tax but has no registration number on file. */
export function registrationMissing(tax: TaxSettings, now: number): boolean {
  const region = tax.regions[0];
  if (!region || region.registrationNumber) return false;
  return [...classRatesAt(tax, now).values()].some((rate) => rate > 0);
}

/**
 * Where the store is registered for tax, and under what number. Every sale is
 * taxed at this region's rates, whatever the shopper's address.
 */
export function TaxRegistrationPanel(props: {
  tax: TaxSettings;
  now: number;
  onChange: (next: TaxSettings) => void;
}) {
  const t = useTranslations("admin.settings.tax.registration");
  const { tax, onChange } = props;
  const region = tax.regions[0];
  if (!region) return null;

  const setRegion = (patch: Partial<TaxRegion>) =>
    onChange({ ...tax, regions: [{ ...region, ...patch }, ...tax.regions.slice(1)] });

  return (
    <div className="@container space-y-5">
      <TaxNote icon={MapPin}>{t("description")}</TaxNote>
      {registrationMissing(tax, props.now) ? (
        <WarningBanner title={t("missing")}>{t("missingHint")}</WarningBanner>
      ) : null}
      <div className="grid gap-5 @xl:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="taxRegionCountry" className="text-sm font-medium">
            {t("country")}
          </label>
          <CountrySelect
            id="taxRegionCountry"
            value={region.country}
            onChange={(country) => setRegion({ country })}
            restrictToAvailableCountries={false}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="taxRegionName" className="text-sm font-medium">
            {t("name")}
            <span className="text-muted-foreground ms-1.5 font-normal">{t("optional")}</span>
          </label>
          <Input
            id="taxRegionName"
            value={region.name}
            maxLength={80}
            onChange={(event) => setRegion({ name: event.target.value })}
          />
          <p className="text-muted-foreground text-sm">{t("nameHint")}</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="taxRegistrationLabel" className="text-sm font-medium">
            {t("registrationLabel")}
          </label>
          <Input
            id="taxRegistrationLabel"
            value={region.registrationLabel}
            maxLength={30}
            placeholder={t("registrationLabelPlaceholder")}
            onChange={(event) => setRegion({ registrationLabel: event.target.value })}
          />
          <p className="text-muted-foreground text-sm">{t("registrationLabelHint")}</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="taxRegistrationNumber" className="text-sm font-medium">
            {t("registrationNumber")}
          </label>
          <Input
            id="taxRegistrationNumber"
            value={region.registrationNumber}
            maxLength={60}
            onChange={(event) => setRegion({ registrationNumber: event.target.value })}
          />
          <p className="text-muted-foreground text-sm">{t("registrationNumberHint")}</p>
        </div>
      </div>
    </div>
  );
}
