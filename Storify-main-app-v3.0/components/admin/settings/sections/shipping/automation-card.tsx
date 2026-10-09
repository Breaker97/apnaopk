"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { CountryMultiSelect } from "@/components/common/country-multi-select";
import { FeatureGroup } from "@/components/admin/settings/fields/feature-row";
import { SettingSwitchItem } from "@/components/admin/settings/fields/setting-row";
import type { Settings } from "@/components/admin/settings/types";
import type { CarrierRateChoice } from "@/lib/shipping/carrier-config";
import {
  EditDialogFooter,
  EditDialogHeader,
  FieldLine,
  Segmented,
  SwitchRow,
  Unit,
  useDraft,
} from "./dialog-fields";

type Automation = NonNullable<Settings["shipping"]["automation"]>;

const DEFAULT_AUTOMATION: Automation = {
  enabled: false,
  includeCod: false,
  rateChoice: "cheapest",
  buyLabel: true,
  markOrderShipped: true,
};

/** A limit that is set: the rules read 0, null and absent as "no limit". */
function limit(value: number | null | undefined): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
}

/** True when a limit keeps some paid orders out of automation. */
export function automationHasLimits(automation: Automation): boolean {
  return (
    limit(automation.minOrderValue) !== undefined ||
    limit(automation.maxOrderValue) !== undefined ||
    limit(automation.maxLabelCost) !== undefined ||
    (automation.restrictToCountries?.length ?? 0) > 0
  );
}

/**
 * When a shipment is created without anyone clicking anything: a switch, what
 * it will do in a sentence or two, and the rest behind Customize.
 *
 * The rule is evaluated per sub-order, not per order: on a split order one
 * vendor may already have shipped while another has not, and the sub-order is
 * the unit a parcel corresponds to.
 */
export function AutomationSection(props: {
  automation?: Automation;
  currency: string;
  updateField: (path: string, value: unknown) => void;
}) {
  const t = useTranslations("admin.settings.shipping.automation");
  // Read as stored, never rebuilt from defaults: the dialog hands this object
  // back, and one whose keys moved would count as an unsaved change.
  const automation = props.automation ?? DEFAULT_AUTOMATION;
  const buysLabel = automation.buyLabel !== false;
  const [customizing, setCustomizing] = useState(false);

  const buys = !buysLabel
    ? t("summary.draft")
    : automation.rateChoice === "fastest"
      ? t("summary.fastest")
      : automation.rateChoice === "fixed_service"
        ? automation.fixedServiceToken
          ? t("summary.fixed", { service: automation.fixedServiceToken })
          : t("summary.fixedUnset")
        : t("summary.cheapest");
  const summary = [
    buys,
    buysLabel && automation.markOrderShipped !== false ? t("summary.marksShipped") : null,
    automation.includeCod ? t("summary.codIncluded") : t("summary.codExcluded"),
    automationHasLimits(automation) ? t("summary.limited") : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <FeatureGroup title={t("title")}>
      <SettingSwitchItem
        title={t("enable")}
        description={t("description")}
        checked={Boolean(automation.enabled)}
        onCheckedChange={(checked) => props.updateField("shipping.automation.enabled", checked)}
      />
      {automation.enabled ? (
        <div className="flex flex-wrap items-center gap-3 p-4">
          <p className="text-muted-foreground min-w-0 flex-1 basis-72 text-sm">{summary}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setCustomizing(true)}
          >
            {t("customize")}
          </Button>
        </div>
      ) : null}

      {customizing ? (
        <AutomationDialog
          initial={automation}
          currency={props.currency}
          onClose={() => setCustomizing(false)}
          onDone={(next) => {
            props.updateField("shipping.automation", next);
            setCustomizing(false);
          }}
        />
      ) : null}
    </FeatureGroup>
  );
}

const LIMIT_KEYS = ["minOrderValue", "maxOrderValue", "maxLabelCost"] as const;

function AutomationDialog(props: {
  initial: Automation;
  currency: string;
  onClose: () => void;
  onDone: (automation: Automation) => void;
}) {
  const t = useTranslations("admin.settings.shipping.automation");
  const tUnits = useTranslations("admin.settings.shipping.units");
  // A stored 0 means "no limit", so its box opens empty like an unset one.
  const [opened] = useState<Automation>(() => ({
    ...props.initial,
    minOrderValue: limit(props.initial.minOrderValue),
    maxOrderValue: limit(props.initial.maxOrderValue),
    maxLabelCost: limit(props.initial.maxLabelCost),
  }));
  const { draft, set, changed } = useDraft<Automation>(opened);
  const rateChoice = draft.rateChoice || "cheapest";

  /**
   * A limit emptied here is written as 0: an absent value is left out of the
   * save, which keeps the old limit, so a limit could never be taken off. One
   * that was already empty goes back as it was.
   */
  const done = () => {
    if (!changed) return props.onClose();
    const next = { ...draft };
    for (const key of LIMIT_KEYS) {
      if (draft[key] !== undefined) continue;
      next[key] = limit(props.initial[key]) === undefined ? props.initial[key] : 0;
    }
    props.onDone(next);
  };

  const choices: { id: CarrierRateChoice; label: string }[] = [
    { id: "cheapest", label: t("rateChoiceCheapest") },
    { id: "fastest", label: t("rateChoiceFastest") },
    { id: "fixed_service", label: t("rateChoiceFixed") },
  ];

  return (
    <Dialog open onOpenChange={(open) => (open ? null : props.onClose())}>
      <DialogContent className="grid-cols-1 gap-0 p-0 sm:max-w-xl">
        <EditDialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("dialogHint")}</DialogDescription>
        </EditDialogHeader>

        <div className="max-h-[70vh] min-w-0 space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <p id="automation-rate-choice" className="text-sm font-medium">
              {t("rateChoice")}
            </p>
            <Segmented
              labelledBy="automation-rate-choice"
              className="grid-cols-3"
              value={rateChoice}
              options={choices}
              onChange={(next) => set({ rateChoice: next })}
            />
          </div>

          {rateChoice === "fixed_service" ? (
            <div className="space-y-1.5">
              <label htmlFor="automation-service" className="text-sm font-medium">
                {t("fixedServiceToken")}
              </label>
              <Input
                id="automation-service"
                value={draft.fixedServiceToken || ""}
                placeholder="usps_priority"
                onChange={(event) => set({ fixedServiceToken: event.target.value })}
              />
              <p className="text-muted-foreground text-xs">{t("fixedServiceHint")}</p>
            </div>
          ) : null}

          <SwitchRow
            title={t("buyLabel")}
            hint={t("buyLabelHint")}
            checked={draft.buyLabel ?? true}
            onCheckedChange={(checked) => set({ buyLabel: checked })}
          />
          {/* Nothing is bought without the label, so there is nothing to mark. */}
          {draft.buyLabel !== false ? (
            <SwitchRow
              title={t("markShipped")}
              hint={t("markShippedHint")}
              checked={draft.markOrderShipped ?? true}
              onCheckedChange={(checked) => set({ markOrderShipped: checked })}
            />
          ) : null}
          <SwitchRow
            title={t("includeCod")}
            hint={t("includeCodHint")}
            checked={draft.includeCod ?? false}
            onCheckedChange={(checked) => set({ includeCod: checked })}
          />

          <div className="space-y-4 border-t pt-5">
            <p className="text-sm font-semibold">{t("limitsHeading")}</p>
            <FieldLine label={t("orderValue")} htmlFor="automation-min">
              <NumberInput
                id="automation-min"
                className="w-24"
                min={0}
                value={draft.minOrderValue}
                placeholder="0"
                onValueChange={(next) => set({ minOrderValue: next })}
              />
              <Unit>{tUnits("to")}</Unit>
              <NumberInput
                className="w-28"
                aria-label={t("maxOrderValue")}
                min={0}
                value={draft.maxOrderValue}
                placeholder={t("noLimit")}
                onValueChange={(next) => set({ maxOrderValue: next })}
              />
              <Unit>{props.currency}</Unit>
            </FieldLine>
            <div className="space-y-1.5">
              <FieldLine label={t("maxLabelCost")} htmlFor="automation-max-cost">
                <NumberInput
                  id="automation-max-cost"
                  className="w-28"
                  min={0}
                  value={draft.maxLabelCost}
                  placeholder={t("noLimit")}
                  onValueChange={(next) => set({ maxLabelCost: next })}
                />
              </FieldLine>
              <p className="text-muted-foreground text-xs">{t("maxLabelCostHint")}</p>
            </div>
            <div className="min-w-0 space-y-1.5">
              <label htmlFor="automation-countries" className="text-sm font-medium">
                {t("restrictCountries")}
              </label>
              <CountryMultiSelect
                id="automation-countries"
                modal
                value={draft.restrictToCountries ?? []}
                onChange={(next) => set({ restrictToCountries: next })}
              />
              <p className="text-muted-foreground text-xs">{t("restrictCountriesHint")}</p>
            </div>
          </div>
        </div>

        <EditDialogFooter onCancel={props.onClose} onDone={done} />
      </DialogContent>
    </Dialog>
  );
}
