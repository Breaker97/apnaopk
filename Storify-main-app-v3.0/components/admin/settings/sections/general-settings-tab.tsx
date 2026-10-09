"use client";

import { usePathname, useRouter } from "@/hooks/use-locale-navigation";
import { useLocale, useTranslations } from "next-intl";
import { Store, Globe, Languages, MapPinned, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CountryMultiSelect } from "@/components/common/country-multi-select";
import { toast } from "@/components/ui/toast-notification";
import { WarningBanner } from "@/components/ui/warning-banner";
import type { Settings } from "@/components/admin/settings/types";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import {
  LANGUAGE_OPTIONS,
  storeCurrencyOptions,
} from "@/components/admin/settings/general/constants";
import { isValidLocale } from "@/config/i18n.config";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import {
  COUNTRY_AVAILABILITY_MODES,
  sanitizeCountryCodes,
} from "@/lib/intl/country-availability";
import { COUNTRIES } from "@/lib/intl/country-options";

export function GeneralSettingsTab(props: {
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  updateNestedField: (path: string, value: unknown) => void;
  onSave: () => Promise<boolean> | boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const tSafe = useFallbackTranslator(t);
  const router = useRouter();
  const pathname = usePathname();

  // A store installed without demo data before 2.4.1 has no house profile,
  // and saving this page is what creates it — so the page says so, and offers
  // Save even though nothing on it was edited.
  const storeProfileMissing = props.settings._meta?.storeProfileMissing === true;
  // Why, when Save cannot make it: every admin owns a store, or an older
  // profile probably exists. Save is not offered for those — it would only
  // repeat the refusal.
  const storeProfileProblem = props.settings._meta?.storeProfileProblem;
  const storeProfileSaveFixes =
    storeProfileMissing &&
    storeProfileProblem !== "no_owner" &&
    storeProfileProblem !== "needs_review";
  const defaultLanguage = props.settings.general.defaultLanguage || "en";
  const storeCurrency = props.settings.general.defaultCurrency || "USD";
  const countryAvailabilityMode =
    props.settings.general.countryAvailability?.mode ===
    COUNTRY_AVAILABILITY_MODES.SELECTED
      ? COUNTRY_AVAILABILITY_MODES.SELECTED
      : COUNTRY_AVAILABILITY_MODES.ALL;
  const selectedCountryCodes = sanitizeCountryCodes(
    props.settings.general.countryAvailability?.countryCodes,
  );

  // A code with no translation (older lists offered Korean) is dropped here,
  // so it can be neither ticked nor picked as the default.
  const supportedLanguages = Array.from(
    new Set([
      ...(props.settings.general.supportedLanguages?.length
        ? props.settings.general.supportedLanguages
        : ["en"]),
      defaultLanguage,
    ]),
  ).filter(isValidLocale);

  const handleDefaultLanguageChange = (code: string) => {
    if (!isValidLocale(code)) return;
    if (!supportedLanguages.includes(code)) {
      props.updateNestedField("general.supportedLanguages", [
        ...supportedLanguages,
        code,
      ]);
    }
    props.updateNestedField("general.defaultLanguage", code);
  };

  const handleToggleLanguage = (code: string, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...supportedLanguages, code]))
      : supportedLanguages.filter((v) => v !== code);
    if (next.length === 0) return;

    props.updateNestedField("general.supportedLanguages", next);
    if (!next.includes(defaultLanguage)) {
      props.updateNestedField("general.defaultLanguage", next[0]);
    }
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

        {storeProfileMissing ? (
          <WarningBanner
            title={tSafe(
              "admin.settings.general.storeProfileMissingTitle",
              "Your store profile is missing",
            )}
          >
            {storeProfileProblem === "no_owner"
              ? tSafe(
                  "admin.storeProfile.noOwner",
                  "It can't be created because every admin account already owns a seller store, and a store has one owner. Add an admin account that owns no store.",
                )
              : storeProfileProblem === "needs_review"
                ? tSafe(
                    "admin.storeProfile.needsReview",
                    "An older store profile probably exists under an admin's own store, so a new one wasn't created. A developer can review it with pnpm db:migrate house-profile --dry-run.",
                  )
                : tSafe(
                    "admin.settings.general.storeProfileMissingBody",
                    "Products, inventory and the POS belong to it. Check the store name, language and currency below, then save to create it.",
                  )}
          </WarningBanner>
        ) : null}

        {/* Section 1 -- Store Information */}
        <div className="rounded-lg border bg-card text-card-foreground">
          <div className="flex items-center gap-3 border-b px-6 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Store className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">
                {t("admin.settings.general.storeInfoTitle")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.general.storeInfoDescription")}
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

        {/* Section 2 -- Language and currency */}
        <div className="rounded-lg border bg-card text-card-foreground">
          <div className="flex items-center gap-3 border-b px-6 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Globe className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">
                {t("admin.settings.general.languageCurrencyTitle")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.general.languageCurrencyDescription")}
              </p>
            </div>
          </div>
          <div className="px-6 py-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="defaultLanguage">
                  {t("admin.settings.general.defaultLanguage")}
                </Label>
                <SearchableSelect
                  id="defaultLanguage"
                  value={defaultLanguage}
                  onValueChange={handleDefaultLanguageChange}
                  options={LANGUAGE_OPTIONS.map((language) => ({
                    value: language.code,
                    label: language.name,
                    keywords: language.englishName,
                  }))}
                  searchPlaceholder={t("admin.settings.general.searchLanguage")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultCurrency">
                  {t("admin.settings.general.defaultCurrency")}
                </Label>
                <SearchableSelect
                  id="defaultCurrency"
                  value={storeCurrency}
                  onValueChange={(v) =>
                    props.updateNestedField("general.defaultCurrency", v)
                  }
                  options={storeCurrencyOptions(storeCurrency, locale)}
                  searchPlaceholder={t("admin.settings.general.searchCurrency")}
                />
                <p className="text-xs text-muted-foreground">
                  {tSafe(
                    "admin.settings.general.storeCurrencyHint",
                    "Every price, order and payout is in this currency. Changing it relabels prices; it does not convert them.",
                  )}
                </p>
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
              <h3 className="text-sm font-semibold">
                {t("admin.settings.general.countries.title")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.general.countries.description")}
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
                    {t("admin.settings.general.countries.all")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("admin.settings.general.countries.allHint", {
                      count: COUNTRIES.length,
                    })}
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
                    {t("admin.settings.general.countries.specific")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("admin.settings.general.countries.specificHint")}
                  </span>
                </span>
              </label>
            </RadioGroup>

            {countryAvailabilityMode ===
            COUNTRY_AVAILABILITY_MODES.SELECTED ? (
              <div className="space-y-2">
                <Label>{t("admin.settings.general.countries.label")}</Label>
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
                  placeholder={t("admin.settings.general.countries.placeholder")}
                  searchPlaceholder={t("admin.settings.general.countries.search")}
                  emptyText={t("admin.settings.general.countries.empty")}
                />
                {selectedCountryCodes.length === 0 ? (
                  <p className="text-xs text-destructive">
                    {t("admin.settings.general.countries.required")}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("admin.settings.general.countries.selected", {
                      count: selectedCountryCodes.length,
                    })}
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
                  <div
                    key={l.code}
                    className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-muted/50 ${
                      isChecked
                        ? "border-primary/30 bg-primary/5"
                        : "border-border"
                    }`}
                  >
                    <label
                      htmlFor={`supported-language-${l.code}`}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
                    >
                      <Checkbox
                        id={`supported-language-${l.code}`}
                        checked={isChecked}
                        onCheckedChange={(v) =>
                          handleToggleLanguage(l.code, Boolean(v))
                        }
                      />
                      <span className="font-medium truncate">{l.name}</span>
                    </label>
                    {isDefault ? (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {t("admin.settings.general.defaultBadge")}
                      </Badge>
                    ) : (
                      // Icon only: a text button took the row's width in the
                      // longer languages and cut every language name to two
                      // letters ("Setha njengokuzenzakalelayo" in Zulu).
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0 text-muted-foreground hover:text-primary"
                        title={t("admin.settings.general.setDefault")}
                        aria-label={`${t("admin.settings.general.setDefault")}: ${l.name}`}
                        onClick={() => handleDefaultLanguageChange(l.code)}
                      >
                        <Star className="size-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>

      <StickySaveFooter
        label={t("admin.settings.general.save")}
        isSaving={props.isSaving}
        isDirty={props.isDirty || storeProfileSaveFixes}
        onSave={handleSave}
      />
    </div>
  );
}
