"use client";

import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CountryMultiSelect } from "@/components/common/country-multi-select";
import type { Settings } from "@/components/admin/settings/types";

type Automation = NonNullable<Settings["shipping"]["automation"]>;
type TSafe = (key: string, fallback: string) => string;

/**
 * When a shipment is created without anyone clicking anything.
 *
 * The rule is evaluated per sub-order, not per order: on a split order one
 * vendor may already have shipped while another has not, and the sub-order is
 * the unit a parcel corresponds to.
 */
export function AutomationCard(props: {
  automation: Automation;
  carriersEnabled: boolean;
  tSafe: TSafe;
  updateField: (path: string, value: unknown) => void;
}) {
  const { automation, tSafe, updateField } = props;
  const set = (key: keyof Automation, value: unknown) =>
    updateField(`shipping.automation.${key}`, value);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {tSafe(
              "admin.settings.shipping.automation.title",
              "Automatic shipping",
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            {tSafe(
              "admin.settings.shipping.automation.description",
              "Create a shipment as soon as an order is paid and moved to processing. You can always send an order to a courier by hand instead.",
            )}
          </p>
        </div>
        <Switch
          checked={automation.enabled ?? false}
          disabled={!props.carriersEnabled}
          onCheckedChange={(checked) => set("enabled", checked)}
          aria-label={tSafe(
            "admin.settings.shipping.automation.enable",
            "Enable automatic shipping",
          )}
        />
      </div>

      {!props.carriersEnabled ? (
        <p className="text-xs text-muted-foreground">
          {tSafe(
            "admin.settings.shipping.automation.requiresCarrier",
            "Connect a carrier first — automation has nothing to buy a label from.",
          )}
        </p>
      ) : null}

      {automation.enabled && props.carriersEnabled ? (
        <div className="space-y-5 rounded-lg border p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="automation-cod">
                {tSafe(
                  "admin.settings.shipping.automation.includeCod",
                  "Include cash-on-delivery orders",
                )}
              </Label>
              <p className="text-xs text-muted-foreground">
                {tSafe(
                  "admin.settings.shipping.automation.includeCodHint",
                  "A COD order is never marked paid, so it only ships automatically when this is on.",
                )}
              </p>
            </div>
            <Switch
              id="automation-cod"
              checked={automation.includeCod ?? false}
              onCheckedChange={(checked) => set("includeCod", checked)}
            />
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="automation-min">
                {tSafe(
                  "admin.settings.shipping.automation.minOrderValue",
                  "Minimum order value",
                )}
              </Label>
              <NumberInput
                id="automation-min"
                min={0}
                value={automation.minOrderValue}
                placeholder="0"
                onValueChange={(next) => set("minOrderValue", next)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="automation-max">
                {tSafe(
                  "admin.settings.shipping.automation.maxOrderValue",
                  "Maximum order value",
                )}
              </Label>
              <NumberInput
                id="automation-max"
                min={0}
                value={automation.maxOrderValue}
                placeholder={tSafe(
                  "admin.settings.shipping.automation.noLimit",
                  "No limit",
                )}
                onValueChange={(next) => set("maxOrderValue", next)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="automation-max-cost">
                {tSafe(
                  "admin.settings.shipping.automation.maxLabelCost",
                  "Abort above label cost",
                )}
              </Label>
              <NumberInput
                id="automation-max-cost"
                min={0}
                value={automation.maxLabelCost}
                placeholder={tSafe(
                  "admin.settings.shipping.automation.noLimit",
                  "No limit",
                )}
                onValueChange={(next) => set("maxLabelCost", next)}
              />
              <p className="text-xs text-muted-foreground">
                {tSafe(
                  "admin.settings.shipping.automation.maxLabelCostHint",
                  "In your carrier account's currency, not the store's.",
                )}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="automation-rate-choice">
              {tSafe(
                "admin.settings.shipping.automation.rateChoice",
                "Which rate to buy",
              )}
            </Label>
            <Select
              value={automation.rateChoice || "cheapest"}
              onValueChange={(value) => set("rateChoice", value)}
            >
              <SelectTrigger id="automation-rate-choice">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cheapest">
                  {tSafe(
                    "admin.settings.shipping.automation.rateChoiceCheapest",
                    "Cheapest",
                  )}
                </SelectItem>
                <SelectItem value="fastest">
                  {tSafe(
                    "admin.settings.shipping.automation.rateChoiceFastest",
                    "Fastest",
                  )}
                </SelectItem>
                <SelectItem value="fixed_service">
                  {tSafe(
                    "admin.settings.shipping.automation.rateChoiceFixed",
                    "A specific service",
                  )}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {automation.rateChoice === "fixed_service" ? (
            <div className="space-y-2">
              <Label htmlFor="automation-service">
                {tSafe(
                  "admin.settings.shipping.automation.fixedServiceToken",
                  "Service token",
                )}
              </Label>
              <Input
                id="automation-service"
                value={automation.fixedServiceToken || ""}
                placeholder="usps_priority"
                onChange={(e) => set("fixedServiceToken", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {tSafe(
                  "admin.settings.shipping.automation.fixedServiceHint",
                  "The carrier's own service identifier. Send one order to a courier by hand to see the tokens your account returns.",
                )}
              </p>
            </div>
          ) : null}

          <Separator />

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="automation-buy">
                {tSafe(
                  "admin.settings.shipping.automation.buyLabel",
                  "Buy the label automatically",
                )}
              </Label>
              <p className="text-xs text-muted-foreground">
                {tSafe(
                  "admin.settings.shipping.automation.buyLabelHint",
                  "Off creates a rate-shopped draft and stops, leaving the purchase to a human.",
                )}
              </p>
            </div>
            <Switch
              id="automation-buy"
              checked={automation.buyLabel ?? true}
              onCheckedChange={(checked) => set("buyLabel", checked)}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="automation-mark-shipped">
                {tSafe(
                  "admin.settings.shipping.automation.markShipped",
                  "Mark the order shipped once the label is bought",
                )}
              </Label>
              <p className="text-xs text-muted-foreground">
                {tSafe(
                  "admin.settings.shipping.automation.markShippedHint",
                  "Sends the customer their tracking number.",
                )}
              </p>
            </div>
            <Switch
              id="automation-mark-shipped"
              checked={automation.markOrderShipped ?? true}
              onCheckedChange={(checked) => set("markOrderShipped", checked)}
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>
              {tSafe(
                "admin.settings.shipping.automation.restrictCountries",
                "Only automate these destinations",
              )}
            </Label>
            <CountryMultiSelect
              value={automation.restrictToCountries ?? []}
              onChange={(next) => set("restrictToCountries", next)}
            />
            <p className="text-xs text-muted-foreground">
              {tSafe(
                "admin.settings.shipping.automation.restrictCountriesHint",
                "Leave empty to automate every destination.",
              )}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
