"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Store,
  Globe,
  Languages,
  CircleDollarSign,
  MapPinned,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CountryMultiSelect } from "@/components/common/country-multi-select";
import { toast } from "@/components/ui/toast-notification";
import type { Settings } from "@/components/admin/settings/types";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import {
  currencyLabel,
  currencyOptionsFor,
} from "@/components/admin/settings/general/constants";
import { AddCurrencyField } from "@/components/admin/settings/general/add-currency-field";
import { isValidLocale } from "@/config/i18n.config";
import {
  COUNTRY_AVAILABILITY_MODES,
  sanitizeCountryCodes,
} from "@/lib/intl/country-availability";
import { COUNTRIES } from "@/lib/intl/country-options";

const LANGUAGE_OPTIONS = [
  { code: "en", name: "English" },
  { code: "bn", name: "Bengali" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "de", name: "German" },
  { code: "zu", name: "Zulu" },
  { code: "xh", name: "Xhosa" },
  { code: "af", name: "Afrikaans" },
  { code: "sw", name: "Swahili" },
  { code: "ha", name: "Hausa" },
  { code: "yo", name: "Yoruba" },
  { code: "ig", name: "Igbo" },
];

export function GeneralSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => Promise<boolean> | boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  // Custom codes added in this session stay on screen after being unchecked,
  // so an accidental uncheck doesn't make the row vanish before saving.
  const [addedCurrencies, setAddedCurrencies] = useState<string[]>([]);

  const defaultLanguage = props.settings.general.defaultLanguage || "en";
  const defaultCurrency = props.settings.general.defaultCurrency || "USD";
  const countryAvailabilityMode =
    props.settings.general.countryAvailability?.mode ===
    COUNTRY_AVAILABILITY_MODES.SELECTED
      ? COUNTRY_AVAILABILITY_MODES.SELECTED
      : COUNTRY_AVAILABILITY_MODES.ALL;
  const selectedCountryCodes = sanitizeCountryCodes(
    props.settings.general.countryAvailability?.countryCodes,
  );

  const supportedLanguages = Array.from(
    new Set([
      ...(props.settings.general.supportedLanguages?.length
        ? props.settings.general.supportedLanguages
        : ["en"]),
      defaultLanguage,
    ]),
  );
  const supportedCurrencies = Array.from(
    new Set([
      ...(props.settings.general.supportedCurrencies?.length
        ? props.settings.general.supportedCurrencies
        : ["USD"]),
      defaultCurrency,
    ]),
  );
  const currencyOptions = currencyOptionsFor([
    ...supportedCurrencies,
    ...addedCurrencies,
  ]);

  const handleToggleInList = (
    path: "general.supportedLanguages" | "general.supportedCurrencies",
    current: string[],
    value: string,
    checked: boolean,
  ) => {
    const next = checked
      ? Array.from(new Set([...current, value]))
      : current.filter((v) => v !== value);
    if (next.length === 0) return;

    props.updateNestedField(path, next);

    if (path === "general.supportedLanguages") {
      const defaultLang = props.settings.general.defaultLanguage || "en";
      if (!next.includes(defaultLang)) {
        props.updateNestedField("general.defaultLanguage", next[0]);
      }
    }

    if (path === "general.supportedCurrencies") {
      const defaultCurr = props.settings.general.defaultCurrency || "USD";
      if (!next.includes(defaultCurr)) {
        props.updateNestedField("general.defaultCurrency", next[0]);
      }
    }
  };

  const handleAddCurrency = (code: string) => {
    setAddedCurrencies((prev) => (prev.includes(code) ? prev : [...prev, code]));
    props.updateNestedField("general.supportedCurrencies", [
      ...supportedCurrencies,
      code,
    ]);
  };

  const handleSetDefaultCurrency = (code: string) => {
    if (!supportedCurrencies.includes(code)) {
      props.updateNestedField("general.supportedCurrencies", [
        ...supportedCurrencies,
        code,
      ]);
    }
    props.updateNestedField("general.defaultCurrency", code);
  };

  const handleSave = async () => {
    if (
      countryAvailabilityMode === COUNTRY_AVAILABILITY_MODES.SELECTED &&
      selectedCountryCodes.length === 0
    ) {
      toast.error(t("admin.settings.general.countryRequired"));
      return;
    }

    const didSave = await props.onSave();
    if (!didSave || !pathname) return;

    const nextLocale = props.settings.general.defaultLanguage || "en";
    const currentLocale = pathname.split("/").filter(Boolean)[0];

    if (!isValidLocale(nextLocale) || currentLocale === nextLocale) {
      return;
    }

    const currentPrefix = `/${currentLocale}`;
    const nextPathname = pathname.startsWith(currentPrefix)
      ? pathname.replace(currentPrefix, `/${nextLocale}`)
      : `/${nextLocale}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;

    router.push(nextPathname);
  };

  return (
    <div className="relative">
      <div className="space-y-6">
        <SettingsTabHeader
          title={t("admin.settings.general.title")}
          description={t("admin.settings.general.description")}
        />

        {/* Section 1 -- Store Information */}
        <div className="rounded-lg border bg-card text-card-foreground">
          <div className="flex items-center gap-3 border-b px-6 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Store className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Store Information</h3>
              <p className="text-xs text-muted-foreground">
                Basic details about your store
              </p>
            </div>
          </div>
          <div className="px-6 py-5 space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="storeName">
                  {t("admin.settings.general.storeName")}
                </Label>
                <Input
                  id="storeName"
                  value={props.settings.general.storeName || ""}
                  onChange={(e) =>
                    props.updateNestedField("general.storeName", e.target.value)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="storeEmail">
                  {t("admin.settings.general.storeEmail")}
                </Label>
                <Input
                  id="storeEmail"
                  type="email"
                  value={props.settings.general.storeEmail || ""}
                  onChange={(e) =>
                    props.updateNestedField(
                      "general.storeEmail",
                      e.target.value,
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="storePhone">
                  {t("admin.settings.general.phone")}
                </Label>
                <Input
                  id="storePhone"
                  type="tel"
                  value={props.settings.general.storePhone || ""}
                  onChange={(e) =>
                    props.updateNestedField(
                      "general.storePhone",
                      e.target.value,
                    )
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="storeDomain">
                {t("admin.settings.general.storeDomain")}
              </Label>
              <Input
                id="storeDomain"
                inputMode="url"
                value={props.settings.general.storeDomain || ""}
                onChange={(e) =>
                  props.updateNestedField("general.storeDomain", e.target.value)
                }
                placeholder="https://example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="storeDescription">
                {t("admin.settings.general.storeDescription")}
              </Label>
              <Textarea
                id="storeDescription"
                value={props.settings.general.storeDescription || ""}
                onChange={(e) =>
                  props.updateNestedField(
                    "general.storeDescription",
                    e.target.value,
                  )
                }
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="storeAddress">
                {t("admin.settings.general.address")}
              </Label>
              <Textarea
                id="storeAddress"
                value={props.settings.general.storeAddress || ""}
                onChange={(e) =>
                  props.updateNestedField(
                    "general.storeAddress",
                    e.target.value,
                  )
                }
                rows={2}
              />
            </div>
          </div>
        </div>

        {/* Brand assets (logos + favicon) now live on the Branding tab. */}

        {/* Section 2 -- Regional Defaults */}
        <div className="rounded-lg border bg-card text-card-foreground">
          <div className="flex items-center gap-3 border-b px-6 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Globe className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Regional Defaults</h3>
              <p className="text-xs text-muted-foreground">
                Timezone, language, and currency preferences
              </p>
            </div>
          </div>
          <div className="px-6 py-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="timezone">
                  {t("admin.settings.general.timezone")}
                </Label>
                <Input
                  id="timezone"
                  value={props.settings.general.timezone || "UTC"}
                  onChange={(e) =>
                    props.updateNestedField("general.timezone", e.target.value)
                  }
                  placeholder={t("admin.settings.general.timezonePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="productSearchMode">
                  {t("admin.settings.general.productSearch")}
                </Label>
                <SearchableSelect
                  id="productSearchMode"
                  value={props.settings.general.productSearchMode || "regex"}
                  onValueChange={(v) =>
                    props.updateNestedField("general.productSearchMode", v)
                  }
                  options={[
                    {
                      value: "regex",
                      label: t("admin.settings.general.productSearchRegex"),
                    },
                    {
                      value: "text",
                      label: t("admin.settings.general.productSearchText"),
                    },
                  ]}
                  searchPlaceholder={t("admin.settings.general.productSearch")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("admin.settings.general.productSearchDesc")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.settings.general.defaultLanguage")}</Label>
                <SearchableSelect
                  value={props.settings.general.defaultLanguage || "en"}
                  onValueChange={(v) =>
                    props.updateNestedField("general.defaultLanguage", v)
                  }
                  options={supportedLanguages.map((code) => ({
                    value: code,
                    label:
                      LANGUAGE_OPTIONS.find((x) => x.code === code)?.name ||
                      code,
                  }))}
                  searchPlaceholder="Search language..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultCurrency">
                  {t("admin.settings.general.defaultCurrency")}
                </Label>
                <SearchableSelect
                  id="defaultCurrency"
                  value={props.settings.general.defaultCurrency || "USD"}
                  onValueChange={(v) =>
                    props.updateNestedField("general.defaultCurrency", v)
                  }
                  options={supportedCurrencies.map((code) => ({
                    value: code,
                    label: currencyLabel(code),
                  }))}
                  // The trigger keeps showing just the code; the name is only
                  // there to make the list searchable.
                  renderValue={(option) => option.value}
                  searchPlaceholder="Search currency..."
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 3 -- Country Availability */}
        <div className="rounded-lg border bg-card text-card-foreground">
          <div className="flex items-center gap-3 border-b px-6 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <MapPinned className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Available countries</h3>
              <p className="text-xs text-muted-foreground">
                Control the country lists used across checkout, vendor
                onboarding, addresses, shipping, and product forms.
              </p>
            </div>
          </div>
          <div className="space-y-5 px-6 py-5">
            <RadioGroup
              value={countryAvailabilityMode}
              onValueChange={(mode) =>
                props.updateNestedField("general.countryAvailability", {
                  mode,
                  countryCodes:
                    mode === COUNTRY_AVAILABILITY_MODES.ALL
                      ? []
                      : selectedCountryCodes,
                })
              }
              className="grid gap-3 md:grid-cols-2"
            >
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 hover:bg-muted/40">
                <RadioGroupItem
                  value={COUNTRY_AVAILABILITY_MODES.ALL}
                  className="mt-0.5"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">
                    All countries
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Show every supported country ({COUNTRIES.length}) in all
                    country pickers.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 hover:bg-muted/40">
                <RadioGroupItem
                  value={COUNTRY_AVAILABILITY_MODES.SELECTED}
                  className="mt-0.5"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">
                    Specific countries
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Only show the countries you select below.
                  </span>
                </span>
              </label>
            </RadioGroup>

            {countryAvailabilityMode ===
            COUNTRY_AVAILABILITY_MODES.SELECTED ? (
              <div className="space-y-2">
                <Label>Countries</Label>
                <CountryMultiSelect
                  value={selectedCountryCodes}
                  onChange={(countryCodes) =>
                    props.updateNestedField("general.countryAvailability", {
                      mode: COUNTRY_AVAILABILITY_MODES.SELECTED,
                      countryCodes,
                    })
                  }
                  valueFormat="code"
                  restrictToAvailableCountries={false}
                  placeholder="Select countries"
                  searchPlaceholder="Search countries or ISO codes..."
                  emptyText="No countries found."
                />
                {selectedCountryCodes.length === 0 ? (
                  <p className="text-xs text-destructive">
                    Select at least one country before saving.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {selectedCountryCodes.length}{" "}
                    {selectedCountryCodes.length === 1 ? "country" : "countries"}{" "}
                    selected.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Section 4 -- Supported Languages */}
        <div className="rounded-lg border bg-card text-card-foreground">
          <div className="flex items-center gap-3 border-b px-6 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Languages className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">
                {t("admin.settings.general.supportedLanguages")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.general.supportedLanguagesDesc")}
              </p>
            </div>
          </div>
          <div className="px-6 py-5">
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {LANGUAGE_OPTIONS.map((l) => {
                const isDefault = l.code === defaultLanguage;
                const isChecked = supportedLanguages.includes(l.code);
                return (
                  <label
                    key={l.code}
                    className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors cursor-pointer hover:bg-muted/50 ${
                      isChecked
                        ? "border-primary/30 bg-primary/5"
                        : "border-border"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(v) =>
                          handleToggleInList(
                            "general.supportedLanguages",
                            supportedLanguages,
                            l.code,
                            Boolean(v),
                          )
                        }
                      />
                      <span className="font-medium">{l.name}</span>
                    </span>
                    {isDefault && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                      >
                        Default
                      </Badge>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* Section 5 -- Supported Currencies */}
        <div className="rounded-lg border bg-card text-card-foreground">
          <div className="flex items-center gap-3 border-b px-6 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <CircleDollarSign className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">
                {t("admin.settings.general.supportedCurrencies")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.general.supportedCurrenciesDesc")}
              </p>
            </div>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {currencyOptions.map((c) => {
                const isDefault = c.code === defaultCurrency;
                const isChecked = supportedCurrencies.includes(c.code);
                return (
                  <div
                    key={c.code}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-muted/50 ${
                      isChecked
                        ? "border-primary/30 bg-primary/5"
                        : "border-border"
                    }`}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(v) =>
                          handleToggleInList(
                            "general.supportedCurrencies",
                            supportedCurrencies,
                            c.code,
                            Boolean(v),
                          )
                        }
                      />
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="font-medium">{c.code}</span>
                        {c.name ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {c.name}
                          </span>
                        ) : null}
                      </span>
                    </label>
                    {isDefault ? (
                      <Badge
                        variant="secondary"
                        className="shrink-0 text-[10px] px-1.5 py-0"
                      >
                        Default
                      </Badge>
                    ) : isChecked ? (
                      <button
                        type="button"
                        onClick={() => handleSetDefaultCurrency(c.code)}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        Set default
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <AddCurrencyField
              existing={supportedCurrencies}
              onAdd={handleAddCurrency}
            />
          </div>
        </div>
      </div>

      <StickySaveFooter
        label={t("admin.settings.general.save")}
        isSaving={props.isSaving}
        isDirty={props.isDirty}
        onSave={handleSave}
      />
    </div>
  );
}
