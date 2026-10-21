"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, ChevronDown, Percent, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { WarningBanner } from "@/components/ui/warning-banner";
import { SettingList } from "@/components/admin/settings/fields/setting-row";
import { cn } from "@/lib/utils";
import { TaxNote } from "./tax-layout";
import {
  MAX_CUSTOM_TAX_CLASSES,
  MAX_TAX_RATE_COMPONENTS,
  MAX_TAX_RATES_PER_CLASS,
  STANDARD_TAX_CLASS,
  classRateEntries,
  classRatesAt,
  combinedRate,
  currentRateEntry,
  isBuiltInTaxClass,
  isUntaxedClass,
  rateStartTime,
  type TaxClass,
  type TaxRateComponent,
  type TaxRateEntry,
  type TaxRegion,
  type TaxSettings,
} from "@/lib/tax/tax-settings";
import type { TaxUsage } from "@/lib/tax/tax-usage";
import {
  fromDateInput,
  newClassKey,
  toDateInput,
  toPercent,
  tomorrowStart,
  useFormatTaxDate,
  useFormatTaxRate,
  useTaxClassCopy,
} from "./tax-shared";

/**
 * Settings → Tax → Rates: every class and what it is charged, in one list.
 * A class's rate is typed in its row; its parts, scheduled changes and (for a
 * store's own class) name open under the row. A class a store adds starts
 * with its rate in the same form, so nothing is set up in two places.
 */
export function TaxRatesPanel(props: {
  tax: TaxSettings;
  usage: TaxUsage | null;
  onChange: (next: TaxSettings) => void;
}) {
  const t = useTranslations("admin.settings.tax.rates");
  const { tax, usage, onChange } = props;
  // The page's moment, fixed while it is open: "current" and "scheduled" read from it.
  const [now] = useState(() => Date.now());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const region = tax.regions[0];
  if (!region) return null;

  const rates = classRatesAt(tax, now);
  const charging = [...rates.values()].some((rate) => rate > 0);
  const customRates = (usage?.products.customRate ?? 0) + (usage?.categories.customRate ?? 0);
  const untaxedProducts = usage?.products.untaxed ?? 0;
  const taxed = tax.classes.filter((entry) => !isUntaxedClass(entry.key));
  const untaxed = tax.classes.filter((entry) => isUntaxedClass(entry.key));
  // Filed under a class since removed: charged the standard rate (lib/tax/tax-rates.ts).
  const known = new Set(tax.classes.map((entry) => entry.key));
  const onRemoved = (byClass: Record<string, number> | undefined) =>
    Object.entries(byClass ?? {}).reduce((sum, [key, count]) => (known.has(key) ? sum : sum + count), 0);
  const removedProducts = onRemoved(usage?.products.byClass);
  const removedCategories = onRemoved(usage?.categories.byClass);
  const customClasses = tax.classes.filter((entry) => !isBuiltInTaxClass(entry.key)).length;
  const full = customClasses >= MAX_CUSTOM_TAX_CLASSES;

  return (
    <div className="space-y-4">
      <TaxNote icon={Percent}>{t("description")}</TaxNote>
      {!charging ? <WarningBanner title={t("notCharging")}>{t("notChargingHint")}</WarningBanner> : null}
      {removedProducts > 0 || removedCategories > 0 ? (
        <WarningBanner title={t("removedClass")}>
          {t("removedClassHint", { products: removedProducts, categories: removedCategories })}
        </WarningBanner>
      ) : null}

      <SettingList>
        {[...taxed, ...untaxed].map((entry) => (
          <ClassItem
            key={entry.key}
            taxClass={entry}
            tax={tax}
            region={region}
            usage={usage}
            now={now}
            open={openKey === entry.key}
            onToggle={() => setOpenKey(openKey === entry.key ? null : entry.key)}
            onChange={onChange}
            onRemoved={() => setOpenKey(null)}
          />
        ))}
        {adding ? (
          <AddClassForm
            tax={tax}
            region={region}
            onChange={onChange}
            onDone={() => {
              setAdding(false);
              setOpenKey(null);
            }}
          />
        ) : full ? null : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-primary hover:bg-muted/50 flex w-full items-center gap-2 p-4 text-sm font-medium transition-colors"
          >
            <Plus className="size-4" aria-hidden />
            {t("addClass")}
          </button>
        )}
      </SettingList>
      {full ? <p className="text-muted-foreground text-sm">{t("full", { count: MAX_CUSTOM_TAX_CLASSES })}</p> : null}

      {untaxedProducts > 0 ? (
        <TaxNote>{t("untaxedNote", { count: untaxedProducts })}</TaxNote>
      ) : null}
      {customRates > 0 ? (
        <TaxNote>
          {t("customNote", {
            products: usage?.products.customRate ?? 0,
            categories: usage?.categories.customRate ?? 0,
          })}
        </TaxNote>
      ) : null}
    </div>
  );
}

function ClassItem(props: {
  taxClass: TaxClass;
  tax: TaxSettings;
  region: TaxRegion;
  usage: TaxUsage | null;
  now: number;
  open: boolean;
  onToggle: () => void;
  onChange: (next: TaxSettings) => void;
  onRemoved: () => void;
}) {
  const t = useTranslations("admin.settings.tax.rates");
  const classCopy = useTaxClassCopy();
  const formatRate = useFormatTaxRate();
  const formatDate = useFormatTaxDate();
  const { taxClass, tax, region, usage, now, open, onChange } = props;
  const key = taxClass.key;
  const name = classCopy.name(taxClass) || key;
  const untaxed = isUntaxedClass(key);
  const standard = key === STANDARD_TAX_CLASS;
  const custom = !isBuiltInTaxClass(key);
  const panelId = `taxClassPanel-${key}`;

  const entries = classRateEntries(region, key);
  const current = currentRateEntry(region, key, now);
  const scheduled = entries.filter((entry) => rateStartTime(entry.effectiveFrom) > now);
  const earlier = entries.filter((entry) => entry !== current && rateStartTime(entry.effectiveFrom) <= now);
  const next = scheduled[0] ?? null;
  const parts = current?.components ?? [];
  const single = parts.length <= 1;
  const products = usage?.products.byClass[key] ?? 0;
  const categories = usage?.categories.byClass[key] ?? 0;

  // The region's rates with this class's replaced: the others keep their place.
  const replace = (nextEntries: TaxRateEntry[]) =>
    onChange({
      ...tax,
      regions: [
        { ...region, rates: [...region.rates.filter((entry) => entry.classKey !== key), ...nextEntries] },
        ...tax.regions.slice(1),
      ],
    });
  const updateEntry = (target: TaxRateEntry, patch: Partial<TaxRateEntry>) =>
    replace(entries.map((entry) => (entry === target ? { ...entry, ...patch } : entry)));
  const updateClass = (patch: Partial<TaxClass>) =>
    onChange({
      ...tax,
      classes: tax.classes.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)),
    });

  // The first rate stays while later ones depend on it, and the standard
  // class always keeps one: it is the store's rate. A class on its own rate
  // that is cleared falls back to the standard rate.
  const clearable = !standard && entries.length === 1;

  const setCurrentRate = (rate: number | undefined) => {
    if (rate === undefined) {
      if (current && clearable) replace([]);
      return;
    }
    if (!current) {
      replace([{ classKey: key, effectiveFrom: null, components: [{ name: "", rate }] }]);
      return;
    }
    updateEntry(current, { components: [{ ...(parts[0] ?? { name: "" }), rate }] });
  };

  const schedule = () => {
    const latest = entries[entries.length - 1];
    const starts = new Set(entries.map((entry) => toDateInput(entry.effectiveFrom)));
    let start = tomorrowStart();
    const latestStart = rateStartTime(latest?.effectiveFrom ?? null);
    if (Number.isFinite(latestStart) && latestStart >= new Date(start).getTime()) {
      const day = new Date(latestStart);
      day.setDate(day.getDate() + 1);
      start = day.toISOString();
    }
    if (starts.has(toDateInput(start))) return;
    replace([
      ...entries,
      {
        classKey: key,
        effectiveFrom: start,
        components: (latest?.components ?? [{ name: "", rate: 0 }]).map((part) => ({ ...part })),
      },
    ]);
  };

  const removeClass = () => {
    onChange({
      ...tax,
      classes: tax.classes.filter((entry) => entry.key !== key),
      regions: tax.regions.map((other) => ({
        ...other,
        rates: other.rates.filter((rate) => rate.classKey !== key),
      })),
    });
    props.onRemoved();
  };

  const description = classCopy.description(taxClass);
  const usageLine = [
    products > 0 ? t("usageProducts", { count: products }) : null,
    categories > 0 ? t("usageCategories", { count: categories }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const hint = !untaxed && !current ? (
    <span className="text-amber-700 dark:text-amber-400">{t("noRate")}</span>
  ) : (
    description
  );
  const hasPanel = !untaxed && (custom || Boolean(current));
  const canSchedule = Boolean(current) && entries.length < MAX_TAX_RATES_PER_CLASS;

  return (
    <div className={cn(open && "bg-muted/30")}>
      <div className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-x-3 gap-y-3 p-4 @md:grid-cols-[minmax(0,1fr)_auto_2rem] @xl:grid-cols-[minmax(0,1fr)_10rem_2rem] @xl:gap-x-4">
        <div className="col-start-1 row-start-1 min-w-0 space-y-0.5">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {name}
            {standard ? <Badge variant="secondary">{t("default")}</Badge> : null}
            {!single ? <Badge variant="secondary">{t("partsBadge", { count: parts.length })}</Badge> : null}
          </p>
          {hint || usageLine ? (
            <p className="text-muted-foreground text-sm">
              {hint}
              {hint && usageLine ? " · " : null}
              {usageLine}
            </p>
          ) : null}
          {next ? (
            <p className="text-primary flex items-center gap-1.5 text-xs font-medium">
              <CalendarClock className="size-3.5 shrink-0" aria-hidden />
              {t("next", {
                rate: formatRate(combinedRate(next.components)),
                date: formatDate(next.effectiveFrom as string),
              })}
            </p>
          ) : null}
        </div>

        {untaxed ? (
          <span className="text-muted-foreground col-span-2 text-sm @md:col-start-2 @md:text-end">
            {t("neverCharged")}
          </span>
        ) : (
          <>
            <div className="col-span-2 row-start-2 flex items-center gap-2 @md:col-span-1 @md:col-start-2 @md:row-start-1 @md:justify-end">
              {single ? (
                <NumberInput
                  aria-label={t("rateLabel", { name })}
                  className="h-9 w-28 shrink-0 text-end font-semibold tabular-nums"
                  min={0}
                  max={100}
                  step={0.01}
                  placeholder="—"
                  value={current ? (parts[0]?.rate ?? 0) : null}
                  whenEmpty={clearable ? undefined : "keep"}
                  onValueChange={setCurrentRate}
                />
              ) : (
                <Input
                  readOnly
                  aria-label={t("rateTotalLabel", { name })}
                  className="bg-muted/50 h-9 w-28 shrink-0 text-end font-semibold tabular-nums"
                  value={toPercent(combinedRate(parts))}
                />
              )}
              <span className="text-muted-foreground text-sm">%</span>
            </div>
            {hasPanel ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-expanded={open}
                aria-controls={panelId}
                aria-label={t("expandLabel", { name })}
                className={cn(
                  "text-muted-foreground col-start-2 row-start-1 @md:col-start-3",
                  open && "bg-primary/10 text-primary",
                )}
                onClick={props.onToggle}
              >
                <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
              </Button>
            ) : null}
          </>
        )}
      </div>

      {open && hasPanel ? (
        <div id={panelId} className="space-y-5 px-4 pb-5">
          {custom ? (
            <div className="grid gap-4 @xl:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor={`taxClassName-${key}`} className="text-sm font-medium">
                  {t("name")}
                </label>
                <Input
                  id={`taxClassName-${key}`}
                  value={taxClass.name ?? ""}
                  maxLength={60}
                  onChange={(event) => updateClass({ name: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`taxClassNote-${key}`} className="text-sm font-medium">
                  {t("note")}
                  <span className="text-muted-foreground ms-1.5 font-normal">{t("optional")}</span>
                </label>
                <Input
                  id={`taxClassNote-${key}`}
                  value={taxClass.description ?? ""}
                  maxLength={200}
                  placeholder={t("notePlaceholder")}
                  onChange={(event) => updateClass({ description: event.target.value })}
                />
              </div>
            </div>
          ) : null}

          {current && !single ? (
            <section className="space-y-2.5" aria-label={t("partsTitle")}>
              <p className="text-sm font-medium">{t("partsTitle")}</p>
              <PartRows
                parts={parts}
                idBase={`taxParts-${key}`}
                onChange={(components) => updateEntry(current, { components })}
              />
            </section>
          ) : null}

          {/* The two quiet ways to go further, side by side: nothing is shown for them until asked. */}
          {current && (single || (scheduled.length === 0 && canSchedule)) ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {single ? (
                <SplitLink onClick={() => updateEntry(current, { components: [...parts, { name: "", rate: 0 }] })} />
              ) : null}
              {scheduled.length === 0 && canSchedule ? <ScheduleLink onClick={schedule} /> : null}
            </div>
          ) : null}

          {scheduled.length > 0 ? (
            <section className="space-y-3" aria-label={t("scheduleTitle")}>
              <p className="text-sm font-medium">{t("scheduleTitle")}</p>
              {scheduled.map((entry, index) => (
                <ScheduledRate
                  key={index}
                  entry={entry}
                  idBase={`taxScheduled-${key}-${index}`}
                  onChange={(patch) => updateEntry(entry, patch)}
                  onRemove={() => replace(entries.filter((other) => other !== entry))}
                />
              ))}
              {canSchedule ? <ScheduleLink onClick={schedule} /> : null}
            </section>
          ) : null}

          {earlier.length > 0 ? (
            <section className="space-y-2" aria-label={t("earlierTitle")}>
              <p className="text-sm font-medium">{t("earlierTitle")}</p>
              {earlier.map((entry, index) => (
                <div key={`${toDateInput(entry.effectiveFrom)}-${index}`} className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground min-w-0 flex-1">
                    {t("earlierLine", {
                      rate: formatRate(combinedRate(entry.components)),
                      date: entry.effectiveFrom ? formatDate(entry.effectiveFrom) : t("fromStart"),
                    })}
                  </span>
                  {entry.effectiveFrom ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={t("removeEarlier")}
                      onClick={() => replace(entries.filter((other) => other !== entry))}
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}

          {custom ? (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <Button
                type="button"
                variant="link"
                size="sm"
                className="text-destructive h-auto px-0"
                onClick={removeClass}
              >
                {t("removeClass")}
              </Button>
              <p className="text-muted-foreground text-sm">
                {products > 0 || categories > 0
                  ? t("removeClassInUse", { products, categories })
                  : t("removeClassHint")}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ScheduleLink(props: { onClick: () => void }) {
  const t = useTranslations("admin.settings.tax.rates");
  return (
    <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={props.onClick}>
      {t("scheduleAdd")}
    </Button>
  );
}

function SplitLink(props: { onClick: () => void }) {
  const t = useTranslations("admin.settings.tax.rates");
  return (
    <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={props.onClick}>
      {t("splitIntoParts")}
    </Button>
  );
}

/** One scheduled rate: when it starts, and what it is charged from then. */
function ScheduledRate(props: {
  entry: TaxRateEntry;
  idBase: string;
  onChange: (patch: Partial<TaxRateEntry>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("admin.settings.tax.rates");
  const formatRate = useFormatTaxRate();
  const { entry, idBase, onChange } = props;
  const parts = entry.components;
  const single = parts.length <= 1;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor={`${idBase}-date`} className="text-muted-foreground text-sm">
          {t("startsOn")}
        </label>
        <Input
          id={`${idBase}-date`}
          type="date"
          className="h-9 w-40"
          value={toDateInput(entry.effectiveFrom)}
          onChange={(event) => {
            const start = fromDateInput(event.target.value);
            if (start) onChange({ effectiveFrom: start });
          }}
        />
        {single ? (
          <>
            <label htmlFor={`${idBase}-rate`} className="text-muted-foreground text-sm">
              {t("newRate")}
            </label>
            <div className="flex items-center gap-1.5">
              <NumberInput
                id={`${idBase}-rate`}
                className="h-9 w-24 text-end tabular-nums"
                min={0}
                max={100}
                step={0.01}
                value={parts[0]?.rate ?? 0}
                whenEmpty={0}
                onValueChange={(rate) => onChange({ components: [{ ...(parts[0] ?? { name: "" }), rate: rate ?? 0 }] })}
              />
              <span className="text-muted-foreground text-sm">%</span>
            </div>
          </>
        ) : (
          <span className="text-sm font-medium tabular-nums">
            {t("total", { rate: formatRate(combinedRate(parts)) })}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive ms-auto"
          aria-label={t("removeScheduled")}
          onClick={props.onRemove}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      {single ? (
        <SplitLink onClick={() => onChange({ components: [...parts, { name: "", rate: 0 }] })} />
      ) : (
        <PartRows
          parts={parts}
          idBase={`${idBase}-parts`}
          hint={false}
          onChange={(components) => onChange({ components })}
        />
      )}
    </div>
  );
}

/**
 * A rate made of parts — a state, a county, a city sales tax — and the total
 * they come to. Parts add up; one marked "charged on top" is worked out on
 * the price plus the parts above it (`combinedRate`).
 */
function PartRows(props: {
  parts: TaxRateComponent[];
  idBase: string;
  onChange: (parts: TaxRateComponent[]) => void;
  /** The "parts add up" note: once on a class is enough. */
  hint?: boolean;
}) {
  const t = useTranslations("admin.settings.tax.rates");
  const formatRate = useFormatTaxRate();
  const { parts, onChange } = props;
  const placeholders = [t("partPlaceholder1"), t("partPlaceholder2"), t("partPlaceholder3")];
  const updatePart = (index: number, patch: Partial<TaxRateComponent>) =>
    onChange(parts.map((part, at) => (at === index ? { ...part, ...patch } : part)));

  return (
    <div className="space-y-3">
      {parts.map((part, index) => (
        <div key={index} className="space-y-1.5">
          <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_2rem] items-center gap-2">
            <Input
              aria-label={t("partName")}
              className="h-9"
              value={part.name}
              maxLength={30}
              placeholder={placeholders[index] ?? ""}
              onChange={(event) => updatePart(index, { name: event.target.value })}
            />
            <div className="flex items-center gap-1.5">
              <NumberInput
                aria-label={t("partRate")}
                className="h-9 text-end tabular-nums"
                min={0}
                max={100}
                step={0.01}
                value={part.rate}
                whenEmpty={0}
                onValueChange={(rate) => updatePart(index, { rate: rate ?? 0 })}
              />
              <span className="text-muted-foreground text-sm">%</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              aria-label={t("removePart")}
              onClick={() => onChange(parts.filter((_, at) => at !== index))}
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
          {index > 0 ? (
            <label className="text-muted-foreground flex items-center gap-2 text-sm">
              <Checkbox
                checked={part.compound === true}
                onCheckedChange={(checked) => updatePart(index, { compound: checked === true })}
              />
              {t("compound")}
            </label>
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {parts.length < MAX_TAX_RATE_COMPONENTS ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0"
            onClick={() => onChange([...parts, { name: "", rate: 0 }])}
          >
            <Plus className="size-3.5" aria-hidden />
            {t("addPart")}
          </Button>
        ) : (
          <span />
        )}
        <span className="text-sm font-medium tabular-nums">{t("total", { rate: formatRate(combinedRate(parts)) })}</span>
      </div>
      {props.hint !== false ? <p className="text-muted-foreground text-xs">{t("compoundHint")}</p> : null}
    </div>
  );
}

/** A new class and its rate, in the list it joins. */
function AddClassForm(props: {
  tax: TaxSettings;
  region: TaxRegion;
  onChange: (next: TaxSettings) => void;
  onDone: () => void;
}) {
  const t = useTranslations("admin.settings.tax.rates");
  const { tax, region, onChange } = props;
  const [name, setName] = useState("");
  const [rate, setRate] = useState<number | undefined>(undefined);
  const [note, setNote] = useState("");

  const add = () => {
    const label = name.trim();
    if (!label) return;
    const key = newClassKey(label, tax.classes);
    const description = note.trim();
    onChange({
      ...tax,
      classes: [...tax.classes, { key, name: label, ...(description ? { description } : {}) }],
      regions: [
        {
          ...region,
          rates:
            rate === undefined
              ? region.rates
              : [...region.rates, { classKey: key, effectiveFrom: null, components: [{ name: "", rate }] }],
        },
        ...tax.regions.slice(1),
      ],
    });
    props.onDone();
  };

  return (
    <form
      className="bg-muted/30 space-y-4 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <div className="grid gap-4 @xl:grid-cols-[minmax(0,1.2fr)_9rem_minmax(0,1.4fr)]">
        <div className="space-y-1.5">
          <label htmlFor="newTaxClassName" className="text-sm font-medium">
            {t("newName")}
          </label>
          <Input
            id="newTaxClassName"
            autoFocus
            value={name}
            maxLength={60}
            placeholder={t("newNamePlaceholder")}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="newTaxClassRate" className="text-sm font-medium">
            {t("classRate")}
          </label>
          <div className="flex items-center gap-2">
            <NumberInput
              id="newTaxClassRate"
              className="text-end tabular-nums"
              min={0}
              max={100}
              step={0.01}
              value={rate ?? null}
              onValueChange={setRate}
            />
            <span className="text-muted-foreground text-sm">%</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="newTaxClassNote" className="text-sm font-medium">
            {t("note")}
            <span className="text-muted-foreground ms-1.5 font-normal">{t("optional")}</span>
          </label>
          <Input
            id="newTaxClassNote"
            value={note}
            maxLength={200}
            placeholder={t("notePlaceholder")}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={props.onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={!name.trim()}>
          {t("add")}
        </Button>
      </div>
    </form>
  );
}
