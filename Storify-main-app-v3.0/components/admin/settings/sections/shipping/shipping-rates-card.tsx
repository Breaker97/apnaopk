"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Globe, Pencil, Plus } from "lucide-react";
import Link from "@/components/language/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { WarningBanner } from "@/components/ui/warning-banner";
import { formatCurrency } from "@/lib/intl/money";
import type { Settings } from "@/components/admin/settings/types";
import { RateDialog } from "./rate-dialog";
import { ItemRow } from "./item-row";
import { ZoneDialog } from "./zone-dialog";
import {
  countryLabel,
  deliveryWindow,
  firstFew,
  rateAppliesToEveryCart,
  rateCondition,
  ratePrice,
  type ShippingRate,
  type ShippingZone,
} from "./rate-summary";

type Editing =
  | { kind: "zone"; zone: ShippingZone; isNew: boolean }
  | { kind: "rate"; zoneId: string; zoneName: string; rate: ShippingRate; isNew: boolean }
  | { kind: "fallback" }
  | null;

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Columns of a zone's rates table, once its card is wide enough for them. */
const RATE_GRID =
  "@xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(5rem,auto)_4rem]";

/**
 * The words a rate's row is made of, in the store's currency and weight unit.
 * The fallback rate's summary under the zones is made of the same ones.
 */
function useRateTexts(currency: string, weightUnit: string) {
  const t = useTranslations("admin.settings.shipping.rates");
  const locale = useLocale();
  const money = (amount: number) => formatCurrency(amount, currency, locale);

  const condition = (rate: ShippingRate) => {
    const c = rateCondition(rate);
    switch (c.kind) {
      case "freeFrom":
        return t("condition.freeFrom", { amount: money(c.amount) });
      case "subtotal":
        if (c.min !== undefined && c.max !== undefined) {
          return t("condition.subtotalBetween", { min: money(c.min), max: money(c.max) });
        }
        return c.min !== undefined
          ? t("condition.subtotalFrom", { min: money(c.min) })
          : t("condition.subtotalUpTo", { max: money(c.max ?? 0) });
      case "weight":
        if (c.min !== undefined && c.max !== undefined) {
          return t("condition.weightBetween", { min: c.min, max: c.max, unit: weightUnit });
        }
        return c.min !== undefined
          ? t("condition.weightFrom", { min: c.min, unit: weightUnit })
          : t("condition.weightUpTo", { max: c.max ?? 0, unit: weightUnit });
      default:
        return t("condition.any");
    }
  };

  const price = (rate: ShippingRate) => {
    const p = ratePrice(rate);
    if (p.kind === "free") return t("price.free");
    if (p.kind === "amount") return money(p.amount);
    return t("price.perWeight", {
      price: money(p.amount),
      perUnit: money(p.perUnit),
      unit: weightUnit,
    });
  };

  const delivery = (minDays: unknown, maxDays: unknown) => {
    const window = deliveryWindow(minDays, maxDays);
    if (window.kind === "none") return "—";
    return window.kind === "days"
      ? t("deliveryDays", { days: window.days })
      : t("deliveryRange", { min: window.min, max: window.max });
  };

  return { condition, price, delivery };
}

/**
 * Settings → Shipping & Delivery → Shipping rates.
 *
 * Each zone is a summary with its rates as a table — name, what the order must
 * meet, how long it takes, what it costs — and every edit happens in a dialog
 * that works on a copy. It used to be every zone and every rate as an open
 * form, so four rates were four walls of inputs and no one could see what
 * anything cost. Below the zones sits what happens to every other address:
 * the catch-all zone, the fallback rate, or — said plainly — no checkout.
 */
export function ShippingRatesCard(props: {
  settings: Settings;
  updateField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.shipping");
  const shipping = props.settings.shipping;
  const zones = Array.isArray(shipping.zones) ? shipping.zones : [];
  const currency = props.settings.general.defaultCurrency || "USD";
  const weightUnit = shipping.weightUnit || "kg";
  const fallbackRate = shipping.fallbackRate || { enabled: false, name: "", price: 0 };
  const fallbackZone = zones.find((zone) => zone.isFallback);
  const texts = useRateTexts(currency, weightUnit);
  // As checkout counts it (lib/shipping/shipping.ts): the longest time is
  // never under the shortest.
  const processingMin = Math.max(0, Number(shipping.delivery?.processingDaysMin) || 0);
  const processingMax = Math.max(
    processingMin,
    Number(shipping.delivery?.processingDaysMax) || 0,
  );
  const processingText =
    processingMax === 0
      ? undefined
      : processingMin === processingMax
        ? t("rates.deliveryDays", { days: processingMax })
        : t("rates.deliveryRange", { min: processingMin, max: processingMax });
  const [editing, setEditing] = useState<Editing>(null);

  const setZones = (next: ShippingZone[]) => props.updateField("shipping.zones", next);
  const close = () => setEditing(null);

  /**
   * Exactly one catch-all, enforced when a zone comes back from its dialog:
   * with two, which of them priced an uncovered address would come down to
   * array order, and the admin would have no way to see which.
   */
  const saveZone = (zone: ShippingZone, isNew: boolean) => {
    const others = zone.isFallback
      ? zones.map((z) => (z.id === zone.id || !z.isFallback ? z : { ...z, isFallback: false }))
      : zones;
    setZones(
      isNew ? [...others, zone] : others.map((z) => (z.id === zone.id ? zone : z)),
    );
    close();
  };

  const saveRate = (zoneId: string, rate: ShippingRate, isNew: boolean) => {
    setZones(
      zones.map((zone) =>
        zone.id !== zoneId
          ? zone
          : {
              ...zone,
              rates: isNew
                ? [...(zone.rates || []), rate]
                : (zone.rates || []).map((r) => (r.id === rate.id ? rate : r)),
            },
      ),
    );
    close();
  };

  const deleteRate = (zoneId: string, rateId: string) => {
    setZones(
      zones.map((zone) =>
        zone.id !== zoneId
          ? zone
          : { ...zone, rates: (zone.rates || []).filter((r) => r.id !== rateId) },
      ),
    );
    close();
  };

  const zoneSummary = (zone: ShippingZone) => {
    if (zone.isFallback) return t("zone.summaryRestOfWorld");
    const countries = zone.countries || [];
    if (countries.length === 0) return t("zone.summaryNoCountries");
    const places = firstFew(countries.map(countryLabel));
    const regions = firstFew(zone.regions || []);
    const join = (list: { shown: string[]; more: number }) =>
      list.more > 0
        ? `${list.shown.join(", ")} ${t("zone.moreCount", { count: list.more })}`
        : list.shown.join(", ");
    return `${join(places)} · ${
      regions.shown.length > 0 ? join(regions) : t("zone.allRegions")
    }`;
  };

  const orderSettingsLink = (chunks: ReactNode) => (
    <Link href="/admin/settings/orders" className="text-primary font-medium hover:underline">
      {chunks}
    </Link>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("rates.cardTitle")}</CardTitle>
        <CardDescription>
          {shipping.enabled
            ? t("rates.cardDescription")
            : t.rich("rates.cardDescriptionOff", { link: orderSettingsLink })}
        </CardDescription>
        <CardAction>
          <Switch
            checked={Boolean(shipping.enabled)}
            aria-label={t("enable.label")}
            onCheckedChange={(checked) => props.updateField("shipping.enabled", checked)}
          />
        </CardAction>
      </CardHeader>

      {shipping.enabled ? (
        <CardContent className="space-y-3">
          {zones.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
              {t("zones.empty")}
            </p>
          ) : null}

          {zones.map((zone) => {
            const rates = zone.rates || [];
            const noCountries =
              !zone.isFallback && (!zone.countries || zone.countries.length === 0);
            const allConditional =
              rates.length > 0 && !rates.some(rateAppliesToEveryCart);
            return (
              <section
                key={zone.id}
                aria-label={zone.name || t("zone.untitled")}
                className="@container overflow-hidden rounded-lg border"
              >
                <ItemRow
                  className="bg-muted/30 py-3"
                  icon={
                    <span
                      aria-hidden
                      className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-md"
                    >
                      <Globe className="size-4" />
                    </span>
                  }
                  title={<span className="font-semibold">{zone.name || t("zone.untitled")}</span>}
                  badges={
                    zone.isFallback ? (
                      <Badge variant="secondary" className="bg-primary/10 text-primary">
                        {t("zone.isFallback")}
                      </Badge>
                    ) : null
                  }
                  description={<span className="text-xs">{zoneSummary(zone)}</span>}
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing({ kind: "zone", zone, isNew: false })}
                    >
                      {t("zone.edit")}
                    </Button>
                  }
                />

                {/* What is wrong with the zone, before the rates it is about. */}
                {noCountries || allConditional ? (
                  <div className="space-y-2 border-t px-4 py-3">
                    {noCountries ? (
                      <WarningBanner>{t("zone.noCountriesWarning")}</WarningBanner>
                    ) : null}
                    {allConditional ? (
                      <WarningBanner>{t("zone.conditionalRatesWarning")}</WarningBanner>
                    ) : null}
                  </div>
                ) : null}

                {rates.length === 0 ? (
                  <p className="text-muted-foreground border-t px-4 py-4 text-sm">
                    {t("rates.empty")}
                  </p>
                ) : (
                  <div role="table" aria-label={t("rates.title")}>
                    <div
                      role="row"
                      className={`text-muted-foreground hidden gap-4 border-t px-4 py-2 text-xs font-semibold tracking-wide uppercase @xl:grid ${RATE_GRID}`}
                    >
                      <span role="columnheader">{t("rates.columns.rate")}</span>
                      <span role="columnheader">{t("rates.columns.condition")}</span>
                      <span role="columnheader">{t("rates.columns.delivery")}</span>
                      <span role="columnheader" className="text-end">
                        {t("rates.columns.price")}
                      </span>
                      <span role="columnheader" className="sr-only">
                        {t("rates.columns.actions")}
                      </span>
                    </div>
                    {rates.map((rate) => {
                      const off = rate.active === false;
                      const name = rate.name || zone.name || t("zone.untitled");
                      return (
                        <div
                          role="row"
                          key={rate.id}
                          className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 border-t px-4 py-2.5 text-sm @xl:gap-4 ${RATE_GRID} ${off ? "text-muted-foreground" : ""}`}
                        >
                          <div role="cell" className="min-w-0">
                            <p className="flex items-center gap-2 font-medium">
                              <span className="min-w-0 break-words @xl:truncate">{name}</span>
                              {off ? (
                                <Badge variant="outline" className="shrink-0">
                                  {t("rates.off")}
                                </Badge>
                              ) : null}
                            </p>
                            <p className="text-muted-foreground text-xs @xl:hidden">
                              {texts.condition(rate)} · {texts.delivery(rate.minDays, rate.maxDays)}
                            </p>
                          </div>
                          <span role="cell" className="text-muted-foreground hidden truncate @xl:block">
                            {texts.condition(rate)}
                          </span>
                          <span role="cell" className="text-muted-foreground hidden @xl:block">
                            {texts.delivery(rate.minDays, rate.maxDays)}
                          </span>
                          <span role="cell" className="text-end font-medium tabular-nums">
                            {texts.price(rate)}
                          </span>
                          <span role="cell" className="text-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-primary"
                              aria-label={t("rates.editRate", { name })}
                              onClick={() =>
                                setEditing({
                                  kind: "rate",
                                  zoneId: zone.id,
                                  zoneName: zone.name || t("zone.untitled"),
                                  rate,
                                  isNew: false,
                                })
                              }
                            >
                              {/* The word is "Bearbeiten" in German: on a phone
                                  it took the room the rate's name needed. */}
                              <Pencil className="size-4 @xl:hidden" aria-hidden />
                              <span className="hidden @xl:inline">{t("rates.edit")}</span>
                            </Button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="border-t px-2 py-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-primary"
                    onClick={() =>
                      setEditing({
                        kind: "rate",
                        zoneId: zone.id,
                        zoneName: zone.name || t("zone.untitled"),
                        rate: { id: newId(), name: "", type: "flat", price: 0, active: true },
                        isNew: true,
                      })
                    }
                  >
                    <Plus className="size-4" />
                    {t("rates.add")}
                  </Button>
                </div>

              </section>
            );
          })}

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-3">
            <span
              aria-hidden
              className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md"
            >
              <Globe className="size-4" />
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <p className="text-sm font-medium">{t("fallback.everywhereElse")}</p>
              <p className="text-muted-foreground text-xs">
                {fallbackZone
                  ? t("fallback.covered", { zone: fallbackZone.name || t("zone.isFallback") })
                  : fallbackRate.enabled
                    ? [
                        fallbackRate.name || t("rate.namePlaceholder"),
                        texts.price({
                          id: "fallback",
                          name: "",
                          type: "flat",
                          price: fallbackRate.price ?? 0,
                          active: true,
                        }),
                        texts.delivery(fallbackRate.minDays, fallbackRate.maxDays),
                      ].join(" · ")
                    : t("fallback.none")}
              </p>
            </div>
            {fallbackZone ? null : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                // "Edit" alone is what every rate's button says.
                aria-label={
                  fallbackRate.enabled
                    ? t("rates.editRate", { name: t("fallback.dialogTitle") })
                    : undefined
                }
                onClick={() => setEditing({ kind: "fallback" })}
              >
                {fallbackRate.enabled ? t("rates.edit") : t("fallback.add")}
              </Button>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setEditing({
                kind: "zone",
                zone: { id: newId(), name: "", countries: [], regions: [], rates: [] },
                isNew: true,
              })
            }
          >
            <Plus className="size-4" />
            {t("zones.add")}
          </Button>
        </CardContent>
      ) : null}

      {editing?.kind === "zone" ? (
        <ZoneDialog
          key={editing.zone.id}
          open
          onOpenChange={(open) => (open ? null : close())}
          isNew={editing.isNew}
          initial={editing.zone}
          onDone={(zone) => saveZone(zone, editing.isNew)}
          onDelete={
            editing.isNew
              ? undefined
              : () => {
                  setZones(zones.filter((z) => z.id !== editing.zone.id));
                  close();
                }
          }
        />
      ) : null}

      {editing?.kind === "rate" ? (
        <RateDialog
          key={editing.rate.id}
          open
          onOpenChange={(open) => (open ? null : close())}
          isNew={editing.isNew}
          initial={editing.rate}
          zoneName={editing.zoneName}
          currency={currency}
          weightUnit={weightUnit}
          processingText={processingText}
          onDone={(rate) => saveRate(editing.zoneId, rate, editing.isNew)}
          onRemove={
            editing.isNew ? undefined : () => deleteRate(editing.zoneId, editing.rate.id)
          }
        />
      ) : null}

      {editing?.kind === "fallback" ? (
        <RateDialog
          key="fallback"
          open
          variant="fallback"
          // Adding the fallback: Done switches it on even with nothing typed.
          isNew={!fallbackRate.enabled}
          onOpenChange={(open) => (open ? null : close())}
          initial={{
            id: "fallback",
            type: "flat",
            name: fallbackRate.name || "",
            price: fallbackRate.price ?? 0,
            minDays: fallbackRate.minDays,
            maxDays: fallbackRate.maxDays,
            active: true,
          }}
          currency={currency}
          weightUnit={weightUnit}
          processingText={processingText}
          onDone={(rate) => {
            props.updateField("shipping.fallbackRate", {
              ...fallbackRate,
              enabled: true,
              name: rate.name ?? "",
              price: rate.price ?? 0,
              minDays: rate.minDays,
              maxDays: rate.maxDays,
            });
            close();
          }}
          onRemove={
            fallbackRate.enabled
              ? () => {
                  props.updateField("shipping.fallbackRate.enabled", false);
                  close();
                }
              : undefined
          }
        />
      ) : null}
    </Card>
  );
}
