"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  CountryMultiSelect,
  CountrySelect,
} from "@/components/common/country-multi-select";
import { RegionMultiSelect } from "@/components/common/region-multi-select";
import type { Settings } from "@/components/admin/settings/types";
import type { CarrierProvider } from "@/lib/shipping/carrier-config";
import { SettingsTabHeader } from "./settings-tab-header";
import { StickySaveFooter } from "./sticky-save-footer";
import { CarriersCard } from "./shipping/carriers-card";
import { PackagesCard } from "./shipping/packages-card";
import { CourierLinksCard } from "./shipping/courier-links-card";
import { AutomationCard } from "./shipping/automation-card";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

type ShippingSettings = Settings["shipping"];
type ShippingRate = ShippingSettings["zones"][number]["rates"][number];

/**
 * True when a rate is quoted for every cart that reaches its zone.
 *
 * `free_over` is only emitted at or above its threshold, and range rates only
 * inside their bounds (`lib/shipping.ts`). A zone built entirely from those
 * quotes nothing at all for a cart that misses them — the shopper drops to the
 * fallback rate or is told shipping is unavailable, with nothing in this editor
 * to suggest the zone was the reason.
 */
function rateAppliesToEveryCart(rate: ShippingRate): boolean {
  if (rate.active === false) return false;

  const hasLowerBound = (value: unknown) => Number(value) > 0;
  const hasUpperBound = (value: unknown) =>
    value !== undefined && value !== null && Number.isFinite(Number(value));

  switch (rate.type ?? "flat") {
    case "flat":
      return true;
    case "subtotal_range":
      return (
        !hasLowerBound(rate.minSubtotal) && !hasUpperBound(rate.maxSubtotal)
      );
    case "weight_range":
      return !hasLowerBound(rate.minWeight) && !hasUpperBound(rate.maxWeight);
    default:
      return false;
  }
}

function newId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ShippingSettingsTab(props: {
  /** The whole document — the carrier cards read `_meta` for credential state. */
  settings: Settings;
  isSaving: boolean;
  isDirty: boolean;
  isCarrierBusy: boolean;
  updateField: (path: string, value: unknown) => void;
  onSave: () => void | Promise<unknown>;
  onTestCarrier: (provider: CarrierProvider) => void | Promise<unknown>;
  onRegisterCarrierWebhook: (provider: CarrierProvider) => void | Promise<unknown>;
  onDisconnectCarrier: (provider: CarrierProvider) => void | Promise<unknown>;
  onLoadPickupLocations: () => Promise<string[]>;
}) {
  const t = useTranslations();
  const tSafe = useFallbackTranslator(t);

  const shipping = props.settings.shipping;
  const zones = Array.isArray(shipping.zones) ? shipping.zones : [];
  const packages = Array.isArray(shipping.packages) ? shipping.packages : [];
  const courierTrackingLinks = Array.isArray(shipping.courierTrackingLinks)
    ? shipping.courierTrackingLinks
    : [];
  const automation = shipping.automation || {
    enabled: false,
    includeCod: false,
    rateChoice: "cheapest" as const,
    buyLabel: true,
    markOrderShipped: true,
  };

  const origin = shipping.origin || {
    country: "",
    state: "",
    city: "",
    postalCode: "",
    address1: "",
    address2: "",
  };

  const delivery = shipping.delivery || {
    processingDaysMin: 0,
    processingDaysMax: 0,
    showEstimatedDelivery: true,
  };

  const fallbackRate = shipping.fallbackRate || {
    enabled: false,
    name: "Standard",
    price: 0,
  };


  const customs = shipping.customs || {
    enabled: false,
    dutyMode: "DDU" as const,
  };

  const vendorShipping = shipping.vendorShipping || { enabled: false };

  const weightUnit = shipping.weightUnit || "kg";

  const setZones = (nextZones: ShippingSettings["zones"]) => {
    props.updateField("shipping.zones", nextZones);
  };

  const updateZone = (
    zoneId: string,
    patch: Partial<(typeof zones)[number]>,
  ) => {
    setZones(zones.map((z) => (z.id === zoneId ? { ...z, ...patch } : z)));
  };

  const removeZone = (zoneId: string) => {
    setZones(zones.filter((z) => z.id !== zoneId));
  };

  /**
   * Exactly one catch-all, enforced here rather than at rating time: with two,
   * which of them priced an uncovered address would come down to array order,
   * and the admin would have no way to see which.
   */
  const setFallbackZone = (zoneId: string, isFallback: boolean) => {
    setZones(
      zones.map((z) =>
        z.id === zoneId
          ? { ...z, isFallback }
          : isFallback
            ? { ...z, isFallback: false }
            : z,
      ),
    );
  };

  const fallbackZone = zones.find((z) => z.isFallback);

  const addZone = () => {
    setZones([
      ...zones,
      { id: newId(), name: "", countries: [], regions: [], rates: [] },
    ]);
  };

  const addRate = (zoneId: string) => {
    updateZone(zoneId, {
      rates: [
        ...(zones.find((z) => z.id === zoneId)?.rates || []),
        {
          id: newId(),
          name: "Standard",
          type: "flat",
          price: 0,
          active: true,
        },
      ],
    });
  };

  const updateRate = (
    zoneId: string,
    rateId: string,
    patch: Partial<(typeof zones)[number]["rates"][number]>,
  ) => {
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return;
    updateZone(zoneId, {
      rates: (zone.rates || []).map((r) =>
        r.id === rateId ? { ...r, ...patch } : r,
      ),
    });
  };

  const removeRate = (zoneId: string, rateId: string) => {
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return;
    updateZone(zoneId, {
      rates: (zone.rates || []).filter((r) => r.id !== rateId),
    });
  };

  return (
    <div className="space-y-4">
      <SettingsTabHeader
        title={tSafe("admin.settings.shipping.title", "Shipping & Delivery")}
        description={tSafe(
          "admin.settings.shipping.description",
          "Configure shipping zones, rates, and delivery estimates like Shopify.",
        )}
      />
      <Card>
        <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="font-medium">
              {tSafe(
                "admin.settings.shipping.enable.label",
                "Enable shipping rates",
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {tSafe(
                "admin.settings.shipping.enable.help",
                "When enabled, checkout uses your shipping zones and rates. Otherwise it falls back to flat shipping in Order Settings.",
              )}
            </p>
          </div>
          <Switch
            checked={Boolean(shipping.enabled)}
            onCheckedChange={(v) => props.updateField("shipping.enabled", v)}
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="font-medium">
              {tSafe("admin.settings.shipping.weightUnit.label", "Weight unit")}
            </p>
            <p className="text-sm text-muted-foreground">
              {tSafe(
                "admin.settings.shipping.weightUnit.help",
                "Unit used for product weights and weight-based shipping rates.",
              )}
            </p>
          </div>
          <Select
            value={weightUnit}
            onValueChange={(v) => props.updateField("shipping.weightUnit", v)}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="kg">
                {tSafe("admin.settings.shipping.weightUnit.kg", "Kilograms (kg)")}
              </SelectItem>
              <SelectItem value="lb">
                {tSafe("admin.settings.shipping.weightUnit.lb", "Pounds (lb)")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="space-y-4">
          <div>
            <p className="font-medium">
              {tSafe("admin.settings.shipping.origin.title", "Shipping origin")}
            </p>
            <p className="text-sm text-muted-foreground">
              {tSafe(
                "admin.settings.shipping.origin.description",
                "Used for operational reference and future carrier integrations.",
              )}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="shippingOriginCountry">
                {tSafe("admin.settings.shipping.origin.country", "Country")}
              </Label>
              <CountrySelect
                id="shippingOriginCountry"
                value={origin.country || ""}
                onChange={(country) =>
                  props.updateField("shipping.origin.country", country)
                }
                placeholder={tSafe(
                  "admin.settings.shipping.origin.countryPlaceholder",
                  "Select country",
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shippingOriginState">
                {tSafe(
                  "admin.settings.shipping.origin.state",
                  "State / Province",
                )}
              </Label>
              <Input
                id="shippingOriginState"
                value={origin.state || ""}
                onChange={(e) =>
                  props.updateField("shipping.origin.state", e.target.value)
                }
                placeholder={tSafe(
                  "admin.settings.shipping.origin.statePlaceholder",
                  "CA",
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shippingOriginCity">
                {tSafe("admin.settings.shipping.origin.city", "City")}
              </Label>
              <Input
                id="shippingOriginCity"
                value={origin.city || ""}
                onChange={(e) =>
                  props.updateField("shipping.origin.city", e.target.value)
                }
                placeholder={tSafe(
                  "admin.settings.shipping.origin.cityPlaceholder",
                  "San Francisco",
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shippingOriginPostalCode">
                {tSafe(
                  "admin.settings.shipping.origin.postalCode",
                  "Postal code",
                )}
              </Label>
              <Input
                id="shippingOriginPostalCode"
                value={origin.postalCode || ""}
                onChange={(e) =>
                  props.updateField(
                    "shipping.origin.postalCode",
                    e.target.value,
                  )
                }
                placeholder={tSafe(
                  "admin.settings.shipping.origin.postalCodePlaceholder",
                  "94105",
                )}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="shippingOriginAddress1">
                {tSafe(
                  "admin.settings.shipping.origin.address1",
                  "Address line 1",
                )}
              </Label>
              <Input
                id="shippingOriginAddress1"
                value={origin.address1 || ""}
                onChange={(e) =>
                  props.updateField("shipping.origin.address1", e.target.value)
                }
                placeholder={tSafe(
                  "admin.settings.shipping.origin.address1Placeholder",
                  "123 Market St",
                )}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="shippingOriginAddress2">
                {tSafe(
                  "admin.settings.shipping.origin.address2",
                  "Address line 2",
                )}
              </Label>
              <Input
                id="shippingOriginAddress2"
                value={origin.address2 || ""}
                onChange={(e) =>
                  props.updateField("shipping.origin.address2", e.target.value)
                }
                placeholder={tSafe(
                  "admin.settings.shipping.origin.address2Placeholder",
                  "Suite 100 (optional)",
                )}
              />
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <div>
            <p className="font-medium">
              {tSafe(
                "admin.settings.shipping.delivery.title",
                "Delivery estimates",
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {tSafe(
                "admin.settings.shipping.delivery.description",
                "Set processing time that will be added to rate delivery times when displayed.",
              )}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="processingDaysMin">
                {tSafe(
                  "admin.settings.shipping.delivery.processingMin",
                  "Processing days (min)",
                )}
              </Label>
              <NumberInput
                id="processingDaysMin"
                min={0}
                step={1}
                value={delivery.processingDaysMin ?? 0}
                whenEmpty={0}
                normalize={Math.trunc}
                onValueChange={(next) => props.updateField("shipping.delivery.processingDaysMin", next ?? 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="processingDaysMax">
                {tSafe(
                  "admin.settings.shipping.delivery.processingMax",
                  "Processing days (max)",
                )}
              </Label>
              <NumberInput
                id="processingDaysMax"
                min={0}
                step={1}
                value={delivery.processingDaysMax ?? 0}
                whenEmpty={0}
                normalize={Math.trunc}
                onValueChange={(next) => props.updateField("shipping.delivery.processingDaysMax", next ?? 0)}
              />
            </div>
            <div className="flex items-center justify-between md:col-span-1">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {tSafe(
                    "admin.settings.shipping.delivery.showEstimated",
                    "Show estimates in checkout",
                  )}
                </p>
              </div>
              <Switch
                checked={delivery.showEstimatedDelivery ?? true}
                onCheckedChange={(v) =>
                  props.updateField(
                    "shipping.delivery.showEstimatedDelivery",
                    v,
                  )
                }
              />
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">
                {tSafe("admin.settings.shipping.zones.title", "Shipping zones")}
              </p>
              <p className="text-sm text-muted-foreground">
                {tSafe(
                  "admin.settings.shipping.zones.description",
                  "Create zones and define rates. Select countries from the list, then optionally narrow a zone to specific regions — leave regions empty to cover the whole country.",
                )}
              </p>
            </div>
            <Button type="button" variant="outline" onClick={addZone}>
              <Plus className="h-4 w-4 mr-2" />
              {tSafe("admin.settings.shipping.zones.add", "Add zone")}
            </Button>
          </div>

          <div className="space-y-6">
            {zones.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                {tSafe(
                  "admin.settings.shipping.zones.empty",
                  "No zones yet. Add a zone to start configuring shipping rates.",
                )}
              </div>
            ) : null}

            {zones.map((zone) => (
              <div key={zone.id} className="rounded-lg border p-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor={`zoneName-${zone.id}`}>
                      {tSafe("admin.settings.shipping.zone.name", "Zone name")}
                    </Label>
                    <Input
                      id={`zoneName-${zone.id}`}
                      value={zone.name}
                      onChange={(e) =>
                        updateZone(zone.id, { name: e.target.value })
                      }
                      placeholder={tSafe(
                        "admin.settings.shipping.zone.namePlaceholder",
                        "Domestic",
                      )}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => removeZone(zone.id)}
                    className="w-full sm:w-auto"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {tSafe("admin.settings.shipping.zone.remove", "Remove")}
                  </Button>
                </div>

                <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {tSafe(
                        "admin.settings.shipping.zone.isFallback",
                        "Rest of the world",
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {tSafe(
                        "admin.settings.shipping.zone.isFallbackHint",
                        "Prices any address no other zone covers. Its countries and regions are ignored, and it replaces the single fallback rate below.",
                      )}
                    </p>
                  </div>
                  <Switch
                    checked={Boolean(zone.isFallback)}
                    onCheckedChange={(v) => setFallbackZone(zone.id, v)}
                  />
                </div>

                {zone.isFallback ? null : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`zoneCountries-${zone.id}`}>
                      {tSafe(
                        "admin.settings.shipping.zone.countries",
                        "Countries",
                      )}
                    </Label>
                    <CountryMultiSelect
                      id={`zoneCountries-${zone.id}`}
                      value={zone.countries || []}
                      onChange={(countries) =>
                        updateZone(zone.id, {
                          countries,
                        })
                      }
                      placeholder={tSafe(
                        "admin.settings.shipping.zone.countriesPlaceholder",
                        "Select countries",
                      )}
                      searchPlaceholder={tSafe(
                        "admin.settings.shipping.zone.searchCountries",
                        "Search countries...",
                      )}
                      emptyText={tSafe(
                        "admin.settings.shipping.zone.noCountryMatches",
                        "No countries found.",
                      )}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`zoneRegions-${zone.id}`}>
                      {tSafe(
                        "admin.settings.shipping.zone.regions",
                        "Regions (optional)",
                      )}
                    </Label>
                    <RegionMultiSelect
                      id={`zoneRegions-${zone.id}`}
                      countries={zone.countries || []}
                      value={zone.regions || []}
                      onChange={(regions) =>
                        updateZone(zone.id, { regions })
                      }
                      placeholder={tSafe(
                        "admin.settings.shipping.zone.regionsPlaceholder",
                        "All regions",
                      )}
                      searchPlaceholder={tSafe(
                        "admin.settings.shipping.zone.searchRegions",
                        "Search regions...",
                      )}
                      emptyText={tSafe(
                        "admin.settings.shipping.zone.noRegionMatches",
                        "No regions found.",
                      )}
                      freeTextPlaceholder={tSafe(
                        "admin.settings.shipping.zone.regionsFreeTextPlaceholder",
                        "CA, NY, TX",
                      )}
                    />
                  </div>
                </div>
                )}

                {!zone.isFallback &&
                  (!zone.countries || zone.countries.length === 0) && (
                  <div className="rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-700 dark:text-amber-400">
                    {tSafe(
                      "admin.settings.shipping.zone.noCountriesWarning",
                      "⚠️ This zone has no countries configured. It will not match any customer addresses and the fallback rate will be used instead.",
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between gap-4">
                  <p className="font-medium">
                    {tSafe("admin.settings.shipping.rates.title", "Rates")}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => addRate(zone.id)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {tSafe("admin.settings.shipping.rates.add", "Add rate")}
                  </Button>
                </div>

                <div className="space-y-3">
                  {(zone.rates || []).length === 0 ? (
                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      {tSafe(
                        "admin.settings.shipping.rates.empty",
                        "No rates in this zone yet. Add a rate (e.g., Standard or Express).",
                      )}
                    </div>
                  ) : null}

                  {(zone.rates || []).map((rate) => (
                    <div
                      key={rate.id}
                      className="rounded-md border p-4 space-y-4"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor={`rateName-${rate.id}`}>
                              {tSafe(
                                "admin.settings.shipping.rate.name",
                                "Rate name",
                              )}
                            </Label>
                            <Input
                              id={`rateName-${rate.id}`}
                              value={rate.name}
                              onChange={(e) =>
                                updateRate(zone.id, rate.id, {
                                  name: e.target.value,
                                })
                              }
                              placeholder={tSafe(
                                "admin.settings.shipping.rate.namePlaceholder",
                                "Standard",
                              )}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`rateType-${rate.id}`}>
                              {tSafe(
                                "admin.settings.shipping.rate.typeLabel",
                                "Type",
                              )}
                            </Label>
                            <Select
                              value={rate.type}
                              onValueChange={(v) =>
                                updateRate(zone.id, rate.id, {
                                  type: v as ShippingRate["type"],
                                })
                              }
                            >
                              <SelectTrigger id={`rateType-${rate.id}`}>
                                <SelectValue
                                  placeholder={tSafe(
                                    "admin.settings.shipping.rate.typePlaceholder",
                                    "Select type",
                                  )}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="flat">
                                  {tSafe(
                                    "admin.settings.shipping.rate.type.flat",
                                    "Flat rate",
                                  )}
                                </SelectItem>
                                <SelectItem value="free_over">
                                  {tSafe(
                                    "admin.settings.shipping.rate.type.freeOver",
                                    "Free over subtotal",
                                  )}
                                </SelectItem>
                                <SelectItem value="subtotal_range">
                                  {tSafe(
                                    "admin.settings.shipping.rate.type.subtotalRange",
                                    "Subtotal range",
                                  )}
                                </SelectItem>
                                <SelectItem value="weight_range">
                                  {tSafe(
                                    "admin.settings.shipping.rate.type.weightRange",
                                    "Weight range",
                                  )}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => removeRate(zone.id, rate.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid gap-4 md:grid-cols-4">
                        <div className="space-y-2">
                          <Label htmlFor={`ratePrice-${rate.id}`}>
                            {tSafe(
                              "admin.settings.shipping.rate.price",
                              "Price",
                            )}
                          </Label>
                          <NumberInput
                            id={`ratePrice-${rate.id}`}
                            min={0}
                            value={rate.price ?? 0}
                            whenEmpty={0}
                            onValueChange={(next) =>
                              updateRate(zone.id, rate.id, { price: next ?? 0 })
                            }
                            disabled={rate.type === "free_over"}
                          />
                        </div>

                        {rate.type === "free_over" ? (
                          <div className="space-y-2">
                            <Label htmlFor={`rateFreeOver-${rate.id}`}>
                              {tSafe(
                                "admin.settings.shipping.rate.freeOver",
                                "Free over",
                              )}
                            </Label>
                            <NumberInput
                              id={`rateFreeOver-${rate.id}`}
                              min={0}
                              value={rate.freeOver ?? 0}
                              whenEmpty={0}
                              onValueChange={(next) =>
                                updateRate(zone.id, rate.id, { freeOver: next ?? 0 })
                              }
                            />
                          </div>
                        ) : null}

                        {rate.type === "subtotal_range" ? (
                          <>
                            <div className="space-y-2">
                              <Label htmlFor={`rateMinSubtotal-${rate.id}`}>
                                {tSafe(
                                  "admin.settings.shipping.rate.minSubtotal",
                                  "Min subtotal",
                                )}
                              </Label>
                              <NumberInput
                                id={`rateMinSubtotal-${rate.id}`}
                                min={0}
                                value={rate.minSubtotal ?? 0}
                                whenEmpty={0}
                                onValueChange={(next) =>
                                  updateRate(zone.id, rate.id, { minSubtotal: next ?? 0 })
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`rateMaxSubtotal-${rate.id}`}>
                                {tSafe(
                                  "admin.settings.shipping.rate.maxSubtotal",
                                  "Max subtotal",
                                )}
                              </Label>
                              <NumberInput
                                id={`rateMaxSubtotal-${rate.id}`}
                                min={0}
                                value={rate.maxSubtotal ?? 0}
                                whenEmpty={0}
                                onValueChange={(next) =>
                                  updateRate(zone.id, rate.id, { maxSubtotal: next ?? 0 })
                                }
                              />
                            </div>
                          </>
                        ) : null}

                        {rate.type === "weight_range" ? (
                          <>
                            <div className="space-y-2">
                              <Label htmlFor={`rateMinWeight-${rate.id}`}>
                                {tSafe(
                                  "admin.settings.shipping.rate.minWeight",
                                  "Min weight",
                                ) + ` (${weightUnit})`}
                              </Label>
                              <NumberInput
                                id={`rateMinWeight-${rate.id}`}
                                min={0}
                                value={rate.minWeight ?? 0}
                                whenEmpty={0}
                                onValueChange={(next) =>
                                  updateRate(zone.id, rate.id, { minWeight: next ?? 0 })
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`rateMaxWeight-${rate.id}`}>
                                {tSafe(
                                  "admin.settings.shipping.rate.maxWeight",
                                  "Max weight",
                                ) + ` (${weightUnit})`}
                              </Label>
                              <NumberInput
                                id={`rateMaxWeight-${rate.id}`}
                                min={0}
                                value={rate.maxWeight ?? 0}
                                whenEmpty={0}
                                onValueChange={(next) =>
                                  updateRate(zone.id, rate.id, { maxWeight: next ?? 0 })
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`ratePerWeight-${rate.id}`}>
                                {tSafe(
                                  "admin.settings.shipping.rate.pricePerWeightUnit",
                                  "Price per",
                                ) + ` ${weightUnit}`}
                              </Label>
                              <NumberInput
                                id={`ratePerWeight-${rate.id}`}
                                min={0}
                                value={rate.pricePerWeightUnit ?? 0}
                                whenEmpty={0}
                                onValueChange={(next) =>
                                  updateRate(zone.id, rate.id, { pricePerWeightUnit: next ?? 0 })
                                }
                              />
                            </div>
                          </>
                        ) : null}

                        <div className="space-y-2">
                          <Label htmlFor={`rateMinDays-${rate.id}`}>
                            {tSafe(
                              "admin.settings.shipping.rate.minDays",
                              "Delivery days (min)",
                            )}
                          </Label>
                          <NumberInput
                            id={`rateMinDays-${rate.id}`}
                            min={0}
                            step={1}
                            value={rate.minDays ?? 0}
                            whenEmpty={0}
                            normalize={Math.trunc}
                            onValueChange={(next) =>
                              updateRate(zone.id, rate.id, { minDays: next ?? 0 })
                            }
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`rateMaxDays-${rate.id}`}>
                            {tSafe(
                              "admin.settings.shipping.rate.maxDays",
                              "Delivery days (max)",
                            )}
                          </Label>
                          <NumberInput
                            id={`rateMaxDays-${rate.id}`}
                            min={0}
                            step={1}
                            value={rate.maxDays ?? 0}
                            whenEmpty={0}
                            normalize={Math.trunc}
                            onValueChange={(next) =>
                              updateRate(zone.id, rate.id, { maxDays: next ?? 0 })
                            }
                          />
                        </div>

                        <div className="flex items-center justify-between md:col-span-2">
                          <div className="space-y-1">
                            <p className="text-sm font-medium">
                              {tSafe(
                                "admin.settings.shipping.rate.active",
                                "Active",
                              )}
                            </p>
                          </div>
                          <Switch
                            checked={rate.active ?? true}
                            onCheckedChange={(v) =>
                              updateRate(zone.id, rate.id, { active: v })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                  {(zone.rates || []).length > 0 &&
                  !(zone.rates || []).some(rateAppliesToEveryCart) ? (
                    <div className="rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-700 dark:text-amber-400">
                      {tSafe(
                        "admin.settings.shipping.zone.conditionalRatesWarning",
                        "⚠️ Every rate in this zone is conditional. A cart that meets none of these conditions gets no rate from this zone — it falls through to the fallback rate, or the customer is told shipping is unavailable. Add a flat rate to cover the rest.",
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <div>
            <p className="font-medium">
              {tSafe("admin.settings.shipping.fallback.title", "Fallback rate")}
            </p>
            <p className="text-sm text-muted-foreground">
              {tSafe(
                "admin.settings.shipping.fallback.description",
                "If no zone matches the address, you can apply a default rate.",
              )}
            </p>
          </div>
          {fallbackZone ? (
            <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              {(() => {
                const zone = fallbackZone.name || "Rest of the world";
                // The fallback text is interpolated here too: tSafe returns it
                // verbatim, so a locale without this key would otherwise render
                // a literal "{zone}".
                return tSafe(
                  "admin.settings.shipping.fallback.supersededByZone",
                  `The "${zone}" zone covers the rest of the world, so this single rate is no longer used. Edit that zone to change what uncovered addresses are charged.`,
                  { zone },
                );
              })()}
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {tSafe(
                "admin.settings.shipping.fallback.enable",
                "Enable fallback rate",
              )}
            </p>
            <Switch
              checked={Boolean(fallbackRate.enabled)}
              disabled={Boolean(fallbackZone)}
              onCheckedChange={(v) =>
                props.updateField("shipping.fallbackRate.enabled", v)
              }
            />
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="fallbackName">
                {tSafe("admin.settings.shipping.fallback.name", "Name")}
              </Label>
              <Input
                id="fallbackName"
                value={fallbackRate.name || ""}
                onChange={(e) =>
                  props.updateField(
                    "shipping.fallbackRate.name",
                    e.target.value,
                  )
                }
                disabled={!fallbackRate.enabled || Boolean(fallbackZone)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fallbackPrice">
                {tSafe("admin.settings.shipping.fallback.price", "Price")}
              </Label>
              <NumberInput
                id="fallbackPrice"
                min={0}
                value={fallbackRate.price ?? 0}
                whenEmpty={0}
                onValueChange={(next) => props.updateField("shipping.fallbackRate.price", next ?? 0)}
                disabled={!fallbackRate.enabled || Boolean(fallbackZone)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fallbackMinDays">
                {tSafe("admin.settings.shipping.fallback.minDays", "Min days")}
              </Label>
              <NumberInput
                id="fallbackMinDays"
                min={0}
                step={1}
                value={fallbackRate.minDays ?? 0}
                whenEmpty={0}
                normalize={Math.trunc}
                onValueChange={(next) => props.updateField("shipping.fallbackRate.minDays", next ?? 0)}
                disabled={!fallbackRate.enabled || Boolean(fallbackZone)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fallbackMaxDays">
                {tSafe("admin.settings.shipping.fallback.maxDays", "Max days")}
              </Label>
              <NumberInput
                id="fallbackMaxDays"
                min={0}
                step={1}
                value={fallbackRate.maxDays ?? 0}
                whenEmpty={0}
                normalize={Math.trunc}
                onValueChange={(next) => props.updateField("shipping.fallbackRate.maxDays", next ?? 0)}
                disabled={!fallbackRate.enabled || Boolean(fallbackZone)}
              />
            </div>
          </div>
        </div>

        <Separator />


          <Separator />

          {/* Multi-vendor shipping */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">
                  {tSafe(
                    "admin.settings.shipping.vendorShipping.title",
                    "Per-vendor shipping",
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {tSafe(
                    "admin.settings.shipping.vendorShipping.description",
                    "When enabled, each vendor's items in a multi-vendor cart are rated against that vendor's own shipping profile (falling back to this platform profile). Shipping is charged and allocated per vendor.",
                  )}
                </p>
              </div>
              <Switch
                checked={Boolean(vendorShipping.enabled)}
                onCheckedChange={(v) =>
                  props.updateField("shipping.vendorShipping.enabled", v)
                }
              />
            </div>

            {/* Which way money moves on a cash sale. Individual vendors can
                override it; the resolved answer is frozen onto each order at
                checkout, so changing this never rewrites past orders. */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">
                  {tSafe(
                    "admin.settings.shipping.codCollectedBy.title",
                    "Who collects cash on delivery",
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {tSafe(
                    "admin.settings.shipping.codCollectedBy.description",
                    "If the vendor delivers with their own fleet they take the cash and owe you commission. If your courier delivers, you take the cash and owe the vendor their earnings — and only an admin can mark those orders paid. Applies to new orders; existing orders keep the answer they were placed under.",
                  )}
                </p>
              </div>
              <Select
                value={String(shipping.codCollectedBy || "vendor")}
                onValueChange={(v) =>
                  props.updateField("shipping.codCollectedBy", v)
                }
              >
                <SelectTrigger className="w-48 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendor">
                    {tSafe(
                      "admin.settings.shipping.codCollectedBy.vendor",
                      "The vendor",
                    )}
                  </SelectItem>
                  <SelectItem value="platform">
                    {tSafe(
                      "admin.settings.shipping.codCollectedBy.platform",
                      "The store",
                    )}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Customs & duties */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">
                  {tSafe(
                    "admin.settings.shipping.customs.title",
                    "Customs & duties",
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {tSafe(
                    "admin.settings.shipping.customs.description",
                    "Handle import duties for cross-border orders. DDP collects an estimated duty at checkout; DDU/DAP leaves duties for the customer to pay on delivery.",
                  )}
                </p>
              </div>
              <Switch
                checked={Boolean(customs.enabled)}
                onCheckedChange={(v) =>
                  props.updateField("shipping.customs.enabled", v)
                }
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(280px,1.15fr)_minmax(0,1fr)] lg:items-end">
              <div className="min-w-0 space-y-2">
                <Label htmlFor="customsDutyMode" className="flex min-h-8 items-end">
                  {tSafe(
                    "admin.settings.shipping.customs.dutyMode",
                    "Duty handling",
                  )}
                </Label>
                <Select
                  value={customs.dutyMode || "DDU"}
                  onValueChange={(v) =>
                    props.updateField("shipping.customs.dutyMode", v)
                  }
                >
                  <SelectTrigger id="customsDutyMode" className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DDU">
                      {tSafe(
                        "admin.settings.shipping.customs.ddu",
                        "DDU — customer pays on delivery",
                      )}
                    </SelectItem>
                    <SelectItem value="DDP">
                      {tSafe(
                        "admin.settings.shipping.customs.ddp",
                        "DDP — collect duties at checkout",
                      )}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid min-w-0 gap-4 sm:grid-cols-2 sm:items-end">
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="customsDutyRate" className="flex min-h-8 items-end">
                    {tSafe(
                      "admin.settings.shipping.customs.dutyRatePercent",
                      "Estimated duty rate (%)",
                    )}
                  </Label>
                  <NumberInput
                    id="customsDutyRate"
                    min={0}
                    max={100}
                    value={customs.dutyRatePercent ?? 0}
                    whenEmpty={0}
                    onValueChange={(next) => props.updateField("shipping.customs.dutyRatePercent", next ?? 0)}
                    disabled={!customs.enabled || customs.dutyMode !== "DDP"}
                  />
                </div>
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="customsDeMinimis" className="flex min-h-8 items-end">
                    {tSafe(
                      "admin.settings.shipping.customs.deMinimis",
                      "De-minimis (duty-free under)",
                    )}
                  </Label>
                  <NumberInput
                    id="customsDeMinimis"
                    min={0}
                    value={customs.deMinimis ?? 0}
                    whenEmpty={0}
                    onValueChange={(next) => props.updateField("shipping.customs.deMinimis", next ?? 0)}
                    disabled={!customs.enabled || customs.dutyMode !== "DDP"}
                  />
                </div>
              </div>
            </div>
          </div>

          <Separator />

          <CarriersCard
            settings={props.settings}
            tSafe={tSafe}
            isBusy={props.isCarrierBusy}
            updateField={props.updateField}
            onTestConnection={props.onTestCarrier}
            onRegisterWebhook={props.onRegisterCarrierWebhook}
            onDisconnect={props.onDisconnectCarrier}
            onLoadPickupLocations={props.onLoadPickupLocations}
          />

          <Separator />

          <PackagesCard
            packages={packages}
            tSafe={tSafe}
            updateField={props.updateField}
          />

          <CourierLinksCard
            links={courierTrackingLinks}
            tSafe={tSafe}
            updateField={props.updateField}
          />

          <AutomationCard
            automation={automation}
            carriersEnabled={Boolean(shipping.carriers?.enabled)}
            tSafe={tSafe}
            updateField={props.updateField}
          />

          <StickySaveFooter
            label={tSafe("admin.settings.general.save", "Save")}
            isSaving={props.isSaving}
            isDirty={props.isDirty}
            onSave={props.onSave}
          />
        </CardContent>
      </Card>
    </div>
  );
}
