"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type {
  VendorShippingProfile,
  VendorShippingRate,
  VendorZoneRates,
} from "@/types";

type Profile = VendorShippingProfile;

/** One of the store's zones, as the vendor settings endpoint reports it. */
export type PlatformShippingZone = {
  id: string;
  name: string;
  countries: string[];
  regions: string[];
  isFallback: boolean;
  rates: VendorShippingRate[];
};

export type PlatformShippingSummary = {
  enabled: boolean;
  weightUnit: "kg" | "lb";
  zones: PlatformShippingZone[];
};

export const EMPTY_PLATFORM_SHIPPING: PlatformShippingSummary = {
  enabled: false,
  weightUnit: "kg",
  zones: [],
};

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const EMPTY_VENDOR_SHIPPING: Profile = {
  enabled: false,
  weightUnit: "kg",
  delivery: {
    processingDaysMin: 0,
    processingDaysMax: 0,
    showEstimatedDelivery: true,
  },
  zones: [],
  zoneRates: [],
  fallbackRate: { enabled: false, name: "Standard", price: 0 },
  localPickup: { enabled: false },
};

function describeZone(zone: PlatformShippingZone): string {
  if (zone.isFallback) return "Anywhere no other zone covers";
  const countries = zone.countries.join(", ");
  if (zone.regions.length > 0) {
    return `${zone.regions.join(", ")} — ${countries}`;
  }
  return countries || "No countries configured";
}

/** The editable fields of a single rate. */
function RateEditor({
  rate,
  weightUnit,
  onChange,
  onRemove,
}: {
  rate: VendorShippingRate;
  weightUnit: string;
  onChange: (patch: Partial<VendorShippingRate>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md border p-4 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Rate name</Label>
            <Input
              value={rate.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select
              value={rate.type}
              onValueChange={(v) =>
                onChange({ type: v as VendorShippingRate["type"] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">Flat rate</SelectItem>
                <SelectItem value="free_over">Free over subtotal</SelectItem>
                <SelectItem value="subtotal_range">Subtotal range</SelectItem>
                <SelectItem value="weight_range">Weight range</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          aria-label={`Remove ${rate.name || "rate"}`}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="space-y-2">
          <Label>Price</Label>
          <NumberInput
            min={0}
            value={rate.price ?? 0}
            disabled={rate.type === "free_over"}
            whenEmpty={0}
            onValueChange={(next) => onChange({ price: next ?? 0 })}
          />
        </div>

        {rate.type === "free_over" ? (
          <div className="space-y-2">
            <Label>Free over</Label>
            <NumberInput
              min={0}
              value={rate.freeOver ?? 0}
              whenEmpty={0}
              onValueChange={(next) => onChange({ freeOver: next ?? 0 })}
            />
          </div>
        ) : null}

        {rate.type === "subtotal_range" ? (
          <>
            <div className="space-y-2">
              <Label>Min subtotal</Label>
              <NumberInput
                min={0}
                value={rate.minSubtotal ?? 0}
                whenEmpty={0}
                onValueChange={(next) => onChange({ minSubtotal: next ?? 0 })}
              />
            </div>
            <div className="space-y-2">
              <Label>Max subtotal</Label>
              <NumberInput
                min={0}
                value={rate.maxSubtotal ?? 0}
                whenEmpty={0}
                onValueChange={(next) => onChange({ maxSubtotal: next ?? 0 })}
              />
            </div>
          </>
        ) : null}

        {rate.type === "weight_range" ? (
          <>
            <div className="space-y-2">
              <Label>{`Min weight (${weightUnit})`}</Label>
              <NumberInput
                min={0}
                value={rate.minWeight ?? 0}
                whenEmpty={0}
                onValueChange={(next) => onChange({ minWeight: next ?? 0 })}
              />
            </div>
            <div className="space-y-2">
              <Label>{`Max weight (${weightUnit})`}</Label>
              <NumberInput
                min={0}
                value={rate.maxWeight ?? 0}
                whenEmpty={0}
                onValueChange={(next) => onChange({ maxWeight: next ?? 0 })}
              />
            </div>
            <div className="space-y-2">
              <Label>{`Price per ${weightUnit}`}</Label>
              <NumberInput
                min={0}
                value={rate.pricePerWeightUnit ?? 0}
                whenEmpty={0}
                onValueChange={(next) =>
                  onChange({ pricePerWeightUnit: next ?? 0 })
                }
              />
            </div>
          </>
        ) : null}

        <div className="space-y-2">
          <Label>Delivery days (min)</Label>
          <NumberInput
            min={0}
            step={1}
            value={rate.minDays ?? 0}
            whenEmpty={0}
            normalize={Math.trunc}
            onValueChange={(next) => onChange({ minDays: next ?? 0 })}
          />
        </div>
        <div className="space-y-2">
          <Label>Delivery days (max)</Label>
          <NumberInput
            min={0}
            step={1}
            value={rate.maxDays ?? 0}
            whenEmpty={0}
            normalize={Math.trunc}
            onValueChange={(next) => onChange({ maxDays: next ?? 0 })}
          />
        </div>
        <div className="flex items-center justify-between md:col-span-2">
          <p className="text-sm font-medium">Active</p>
          <Switch
            checked={rate.active ?? true}
            onCheckedChange={(v) => onChange({ active: v })}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Controlled editor for a vendor's shipping prices. State and persistence are
 * owned by the parent (the Vendor Settings form saves it via its shared "Save
 * changes" button), so this component has no save button of its own.
 *
 * Vendors price the store's zones; they do not draw their own. The geography,
 * the weight unit and the "rest of the world" catch-all all belong to the
 * admin, so a shopper's address resolves to the same zone whichever vendor they
 * are buying from — and a vendor who configures nothing still ships everywhere
 * the store does, at the store's rates, instead of reading as "does not deliver
 * to you". This is the split Dokan, WCFM and Mirakl all settled on.
 */
export function VendorShippingEditor({
  value,
  platformShipping,
  onChange,
}: {
  value: Profile;
  platformShipping: PlatformShippingSummary;
  onChange: (next: Profile) => void;
}) {
  const profile = value;
  // The store's unit, not the vendor's: rate bounds are read against zones the
  // store owns, so two different units in one zone could not both be right.
  const weightUnit = platformShipping.weightUnit || "kg";
  const zoneRates = profile.zoneRates || [];
  const platformZones = platformShipping.zones || [];

  const patch = (p: Partial<Profile>) => onChange({ ...profile, ...p });
  const setZoneRates = (next: VendorZoneRates[]) => patch({ zoneRates: next });

  const ownRatesFor = (zoneId: string) =>
    zoneRates.find((entry) => entry.zoneId === zoneId);

  const overrideZone = (zone: PlatformShippingZone) => {
    // Seeded from the store's rates so the common case is editing prices rather
    // than rebuilding a rate card from nothing. Fresh ids keep the vendor's
    // copies independent of the originals.
    const seeded: VendorShippingRate[] =
      zone.rates.length > 0
        ? zone.rates.map((rate) => ({ ...rate, id: newId() }))
        : [
            {
              id: newId(),
              name: "Standard",
              type: "flat",
              price: 0,
              active: true,
            },
          ];
    setZoneRates([...zoneRates, { zoneId: zone.id, rates: seeded }]);
  };

  const inheritZone = (zoneId: string) =>
    setZoneRates(zoneRates.filter((entry) => entry.zoneId !== zoneId));

  const setRates = (zoneId: string, rates: VendorShippingRate[]) =>
    setZoneRates(
      zoneRates.map((entry) =>
        entry.zoneId === zoneId ? { ...entry, rates } : entry,
      ),
    );

  const addRate = (zoneId: string) => {
    const current = ownRatesFor(zoneId)?.rates || [];
    setRates(zoneId, [
      ...current,
      { id: newId(), name: "Standard", type: "flat", price: 0, active: true },
    ]);
  };

  const updateRate = (
    zoneId: string,
    rateId: string,
    p: Partial<VendorShippingRate>,
  ) => {
    const current = ownRatesFor(zoneId)?.rates || [];
    setRates(
      zoneId,
      current.map((rate) => (rate.id === rateId ? { ...rate, ...p } : rate)),
    );
  };

  const removeRate = (zoneId: string, rateId: string) => {
    const current = ownRatesFor(zoneId)?.rates || [];
    setRates(
      zoneId,
      current.filter((rate) => rate.id !== rateId),
    );
  };

  // Written before vendors priced the store's zones. Left alone here rather
  // than silently discarded — it is still what rates this vendor's items until
  // the migration maps it across, and the notice below says so.
  const hasLegacyZones = (profile.zones || []).length > 0 && zoneRates.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="font-medium">Set my own shipping rates</p>
          <p className="text-sm text-muted-foreground">
            When off, your items are charged the store&apos;s rates everywhere.
            When on, you set your own prices for the store&apos;s zones — any
            zone you leave alone still uses the store&apos;s rates.
          </p>
        </div>
        <Switch
          checked={Boolean(profile.enabled)}
          onCheckedChange={(v) => patch({ enabled: v })}
        />
      </div>

      {hasLegacyZones ? (
        <div
          role="status"
          className="rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950/20 dark:text-amber-400"
        >
          This store now defines the shipping zones and you set your price
          inside each one. Your previous zones are still being used until you
          save prices below, which replaces them.
        </div>
      ) : null}

      <Separator />

      <div className="space-y-4">
        <div>
          <p className="font-medium">Zone prices</p>
          <p className="text-sm text-muted-foreground">
            {platformZones.length === 0
              ? "The store has not created any shipping zones yet."
              : `Weights are in ${weightUnit}, set by the store. The most specific zone matching a customer's address is the one that prices their order.`}
          </p>
        </div>

        {platformZones.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Once the store adds zones they will appear here for you to price.
          </div>
        ) : null}

        {platformZones.map((zone) => {
          const own = ownRatesFor(zone.id);
          const isOverridden = Boolean(own);
          const rates = own?.rates || [];

          return (
            <div key={zone.id} className="rounded-lg border p-4 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">
                    {zone.name || "Unnamed zone"}
                    {zone.isFallback ? " (rest of the world)" : ""}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {describeZone(zone)}
                  </p>
                </div>
                {isOverridden ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => inheritZone(zone.id)}
                  >
                    Use store rates
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!profile.enabled}
                    onClick={() => overrideZone(zone)}
                  >
                    Set my own rates
                  </Button>
                )}
              </div>

              {!isOverridden ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  {zone.rates.length === 0
                    ? "Using the store's rates — the store has none for this zone, so its fallback applies."
                    : `Using the store's rates: ${zone.rates
                        .map((rate) => rate.name)
                        .filter(Boolean)
                        .join(", ")}.`}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-medium">My rates</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => addRate(zone.id)}
                    >
                      <Plus className="h-4 w-4 mr-2" /> Add rate
                    </Button>
                  </div>

                  {rates.length === 0 ? (
                    // An empty override is a real answer — "I do not serve
                    // this zone" — and the shopper is told so at checkout, so
                    // it must not read as an unfinished form.
                    <div className="rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
                      No rates here means your items cannot be delivered to this
                      zone. Add a rate, or choose &quot;Use store rates&quot;.
                    </div>
                  ) : null}

                  {rates.map((rate) => (
                    <RateEditor
                      key={rate.id}
                      rate={rate}
                      weightUnit={weightUnit}
                      onChange={(p) => updateRate(zone.id, rate.id, p)}
                      onRemove={() => removeRate(zone.id, rate.id)}
                    />
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>

      <Separator />

      <div className="space-y-4">
        <div>
          <p className="font-medium">Processing time</p>
          <p className="text-sm text-muted-foreground">
            Days you need before handing an order to the carrier. Added to the
            delivery estimate the customer sees.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Minimum days</Label>
            <NumberInput
              min={0}
              step={1}
              value={profile.delivery?.processingDaysMin ?? 0}
              whenEmpty={0}
              normalize={Math.trunc}
              onValueChange={(next) =>
                patch({
                  delivery: {
                    ...(profile.delivery || {
                      processingDaysMax: 0,
                      showEstimatedDelivery: true,
                    }),
                    processingDaysMin: next ?? 0,
                  } as Profile["delivery"],
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Maximum days</Label>
            <NumberInput
              min={0}
              step={1}
              value={profile.delivery?.processingDaysMax ?? 0}
              whenEmpty={0}
              normalize={Math.trunc}
              onValueChange={(next) =>
                patch({
                  delivery: {
                    ...(profile.delivery || {
                      processingDaysMin: 0,
                      showEstimatedDelivery: true,
                    }),
                    processingDaysMax: next ?? 0,
                  } as Profile["delivery"],
                })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
